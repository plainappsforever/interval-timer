package expo.modules.sessionrunner

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.SoundPool
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import java.io.File
import java.util.concurrent.Executor

/**
 * One cue of the JS timeline (src/lib/runner-cues.ts): ms since session start (paused time excluded), the clips to
 * play together ("sr_classic_tick" = a res/raw beep, "/data/…/v-1a2b3c4d.wav" = a voice clip rendered by
 * modules/voice-render), an optional vibration waveform and, at a segment start, the label for the notification.
 */
data class Cue(val atMs: Long, val kind: String, val clips: List<String>, val vibration: LongArray?, val label: String?)

data class RunnerSettings(
  val title: String,
  /** Session end shown in the media controls; null while the timeline is cut by an open interval. */
  val displayEndMs: Long?,
  val sound: Boolean,
  /** Cue volume 0.0-1.0. */
  val volume: Float,
)

data class RunnerSnapshot(
  val active: Boolean,
  val paused: Boolean,
  val title: String,
  val label: String,
  val displayEndMs: Long?,
  val elapsedMs: Long,
)

/**
 * Owns every cue (beep, voice clip, vibration) of a running interval timer on Android (D12/D14). Copied from Breathe's
 * session runner (breathe 9bb123a, D39 there: 1–10 ms while locked and under forced idle) and generalised from breath
 * kinds to clip lists. React Native's Android timers stop while the screen is off, so JS only draws; this object plays
 * the cue list JS built from the timeline (one source of truth, D13) from a HandlerThread, timed against
 * SystemClock.elapsedRealtime(), with a PARTIAL_WAKE_LOCK held while running. SessionService hosts the media
 * session/notification (Pause/Resume, Skip, End); both live in the app's process. Skip and Back are decided by the JS
 * engine: the runner reports them (onAction) and JS answers with update(…, elapsedMs).
 *
 * Threading: all session state is written on the runner thread only; other threads read the @Volatile fields
 * (snapshot()) or post work to the runner thread.
 */
object SessionRunnerCore {
  const val TAG = "SessionRunner"
  private const val END_SHUTDOWN_DELAY_MS = 3000L // the end chime rings ~1.2 s, a voice "Done" ~1 s
  private const val WAKE_LOCK_SLACK_MS = 60_000L
  /** An open interval has no end: the CPU is kept for this long past the last listed cue (JS extends it on Next). */
  private const val OPEN_WAKE_LOCK_MS = 2 * 60 * 60 * 1000L
  private const val SERVICE_STOP_DELAY_MS = 500L
  private const val START_TOLERANCE_MS = 250L
  private const val CLIP_RETRY_MS = 50L
  private const val CLIP_RETRIES = 10
  private val CUE_TOKEN = Any()
  /** Android 8–11 call watch (F3): one AudioManager.getMode() read per second while a session is active. */
  private const val CALL_POLL_MS = 1000L
  private val CALL_POLL_TOKEN = Any()
  private val callWatch = CallModeWatch()
  private val BEEPS = listOf(
    "sr_classic_start", "sr_classic_halfway", "sr_classic_tick", "sr_classic_end",
    "sr_soft_start", "sr_soft_halfway", "sr_soft_tick", "sr_soft_end",
    "sr_bright_start", "sr_bright_halfway", "sr_bright_tick", "sr_bright_end",
  )

  fun interface ActionListener {
    fun onAction(action: String, elapsedMs: Long)
  }

  /** Set by the Expo module: forwards pause/resume/skip/end that did not come from the app itself. */
  @Volatile var actionListener: ActionListener? = null

  private var thread: HandlerThread? = null
  private var handler: Handler? = null
  private val mainHandler = Handler(Looper.getMainLooper())
  private var appContext: Context? = null

  private var soundPool: SoundPool? = null
  private val soundIds = HashMap<String, Int>()
  private val loadedIds = HashSet<Int>()
  private var ambientPlayer: MediaPlayer? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var haptics: CueHaptics? = null
  private var modeListener: Any? = null
  private var noisyReceiver: BroadcastReceiver? = null

  @Volatile private var service: SessionService? = null
  @Volatile private var player: SessionPlayer? = null

  // Session state (runner thread writes).
  private var cues: List<Cue> = emptyList()
  private var nextIndex = 0
  private var generation = 0
  private var settings = RunnerSettings("", null, true, 1f)
  private var endPlayed = false
  private var cueCount = 0
  @Volatile private var baseRealtime = 0L
  @Volatile private var pausedElapsed = 0L
  @Volatile var active = false
    private set
  @Volatile private var paused = false
  @Volatile private var title = ""
  @Volatile private var label = ""
  @Volatile private var displayEndMs: Long? = null

  private fun now() = SystemClock.elapsedRealtime()

  private fun elapsed(): Long = if (paused) pausedElapsed else now() - baseRealtime

  fun snapshot(): RunnerSnapshot =
    RunnerSnapshot(active, paused, title, label, displayEndMs, if (active) maxOf(0L, elapsed()) else 0L)

  @Synchronized
  private fun runner(context: Context): Handler {
    appContext = context.applicationContext
    handler?.let { return it }
    val t = HandlerThread("SessionRunner", android.os.Process.THREAD_PRIORITY_URGENT_AUDIO)
    t.start()
    thread = t
    return Handler(t.looper).also { handler = it }
  }

  private fun post(context: Context?, block: () -> Unit) {
    val h = if (context != null) runner(context) else handler
    h?.post(block)
  }

  /** Loads the beeps (and the given voice clips) ahead of Start, so the first cue has no load latency. */
  fun prepare(context: Context, clips: List<String>) = post(context) {
    ensureSounds()
    loadClips(clips)
  }

  fun start(context: Context, newCues: List<Cue>, newSettings: RunnerSettings, elapsedMs: Long) = post(context) {
    ensureSounds()
    loadClips(newCues.flatMap { it.clips })
    // A new session replaces any running one; the service and notification stay.
    handler?.removeCallbacksAndMessages(CUE_TOKEN)
    haptics?.cancel()
    stopAmbient()
    generation++
    cues = newCues
    settings = newSettings
    title = newSettings.title
    label = labelAt(newCues, elapsedMs)
    displayEndMs = newSettings.displayEndMs
    baseRealtime = now() - elapsedMs
    // The JS clock has moved on by a few ms between the tap and this thread: a cue at the start position still plays.
    nextIndex = firstAtOrAfter(newCues, elapsedMs - START_TOLERANCE_MS)
    endPlayed = false
    cueCount = 0
    paused = false
    active = true
    acquireWakeLock()
    startAmbient()
    registerCallListener()
    registerNoisyReceiver()
    ensureService()
    Log.i(TAG, "start cues=${newCues.size} elapsedMs=$elapsedMs endMs=$displayEndMs sound=${newSettings.sound} volume=${newSettings.volume}")
    notifyPlayer()
    scheduleNext()
  }

  /**
   * New cue list for the running session (Skip, Back, +30 s, Next in an open interval). elapsedMs: where the session
   * is now by the JS engine (a jump), or null to keep the runner's own clock.
   */
  fun update(newCues: List<Cue>, newDisplayEndMs: Long?, elapsedMs: Long?) = post(null) {
    if (!active) return@post
    loadClips(newCues.flatMap { it.clips })
    cues = newCues
    displayEndMs = newDisplayEndMs
    if (elapsedMs != null) {
      if (paused) pausedElapsed = elapsedMs else baseRealtime = now() - elapsedMs
    }
    val e = elapsed()
    // A jump replays the cues at the new position (the engine's Back replays the restarted segment's start, D29.9).
    nextIndex = firstAtOrAfter(newCues, e)
    label = labelAt(newCues, e)
    Log.i(TAG, "update cues=${newCues.size} elapsedMs=$e jump=${elapsedMs != null} endMs=$newDisplayEndMs")
    if (!paused) {
      acquireWakeLock()
      scheduleNext()
    }
    notifyPlayer()
  }

  fun pause(source: String) = post(null) {
    if (!active || paused) return@post
    pausedElapsed = now() - baseRealtime
    paused = true
    handler?.removeCallbacksAndMessages(CUE_TOKEN)
    haptics?.cancel()
    soundPool?.autoPause()
    stopAmbient()
    releaseWakeLock()
    Log.i(TAG, "pause source=$source elapsedMs=$pausedElapsed")
    notifyPlayer()
    if (source != "app") actionListener?.onAction("pause", pausedElapsed)
  }

  /** elapsedMs: the app's own clock, so both schedulers agree after every resume; null keeps ours. */
  fun resume(source: String, elapsedMs: Long?) = post(null) {
    if (!active || !paused) return@post
    val e = elapsedMs ?: pausedElapsed
    baseRealtime = now() - e
    paused = false
    while (nextIndex < cues.size && cues[nextIndex].atMs < e) nextIndex++
    acquireWakeLock()
    startAmbient()
    ensureService()
    Log.i(TAG, "resume source=$source elapsedMs=$e")
    notifyPlayer()
    scheduleNext()
    if (source != "app") actionListener?.onAction("resume", e)
  }

  /** Notification Skip / headset next: the JS engine decides where that goes and answers with update(). */
  fun skip(source: String) = post(null) {
    if (!active) return@post
    val e = elapsed()
    Log.i(TAG, "skip source=$source elapsedMs=$e")
    actionListener?.onAction("skip", e)
  }

  /**
   * Ends the session. playCue: play the list's end cue now (the app decides; a notification End passes false). Sources
   * other than "app" are reported to JS so it records the session.
   */
  fun end(source: String, playCue: Boolean) = post(null) {
    if (!active) return@post
    val e = elapsed()
    val endCue = cues.lastOrNull { it.kind == "end" }
    val cue = playCue && !endPlayed && source != "task" && endCue != null
    if (cue && endCue != null) play(endCue)
    Log.i(TAG, "end source=$source elapsedMs=$e endCue=$cue")
    stopEverything(immediate = !cue && !endPlayed)
    // A swipe-away is not the user's End: JS keeps its recovery record so the next launch offers Resume (A8).
    if (source != "app") actionListener?.onAction(if (source == "task") "taskRemoved" else "end", e)
  }

  // --- scheduling -------------------------------------------------------------------------------

  private fun firstAtOrAfter(list: List<Cue>, e: Long): Int = list.indexOfFirst { it.atMs >= e }.let { if (it < 0) list.size else it }

  private fun labelAt(list: List<Cue>, e: Long): String = list.lastOrNull { it.label != null && it.atMs <= e }?.label ?: list.firstOrNull { it.label != null }?.label ?: ""

  private fun scheduleNext() {
    val h = handler ?: return
    h.removeCallbacksAndMessages(CUE_TOKEN)
    if (!active || paused || nextIndex >= cues.size) return
    val gen = generation
    val delay = baseRealtime + cues[nextIndex].atMs - now()
    h.postAtTime({ fireDue(gen) }, CUE_TOKEN, SystemClock.uptimeMillis() + maxOf(0L, delay))
  }

  private fun fireDue(gen: Int) {
    if (gen != generation || !active || paused || nextIndex >= cues.size) return
    val t = now()
    // Handler delays count uptime, which stops in deep sleep; re-check against the real clock.
    if (t < baseRealtime + cues[nextIndex].atMs - 1) {
      scheduleNext()
      return
    }
    // If the thread was held up past the following cue too, play only the latest due one (never a burst, D29.9).
    while (nextIndex + 1 < cues.size && baseRealtime + cues[nextIndex + 1].atMs <= t) {
      val skipped = cues[nextIndex]
      if (skipped.label != null) label = skipped.label
      Log.w(TAG, "skip kind=${skipped.kind} nominalMs=${skipped.atMs} lateMs=${t - baseRealtime - skipped.atMs}")
      nextIndex++
    }
    val cue = cues[nextIndex]
    nextIndex++
    if (cue.label != null && cue.label != label) {
      label = cue.label
      notifyPlayer()
    }
    play(cue)
    cueCount++
    val late = t - baseRealtime - cue.atMs
    // The A3/A4 timing log (SPEC §13 O3): one line per cue, read with `adb logcat -s SessionRunner`.
    Log.i(TAG, "cue n=$cueCount kind=${cue.kind} nominalMs=${cue.atMs} lateMs=$late clips=${cue.clips.joinToString("+") { File(it).name }} screenOn=${screenOn()}")
    if (cue.kind == "end") {
      Log.i(TAG, "finished elapsedMs=${cue.atMs}")
      stopEverything(immediate = false)
      actionListener?.onAction("finished", cue.atMs)
      return
    }
    if (nextIndex >= cues.size) {
      // Cut by an open interval: nothing more to play until Next (JS sends a new list). The session stays.
      Log.i(TAG, "list exhausted at ${cue.atMs}: waiting for update")
      return
    }
    scheduleNext()
  }

  private fun play(cue: Cue) {
    if (cue.kind == "end") endPlayed = true
    if (settings.sound) for (clip in cue.clips) playClip(clip, generation, 0)
    haptics?.play(cue.vibration)
  }

  /**
   * A clip still loading (the first cue right after a cold start: SoundPool loads asynchronously) is retried every 50 ms
   * for up to 0.5 s and logged as late, instead of being silently lost.
   */
  private fun playClip(clip: String, gen: Int, attempt: Int) {
    if (gen != generation) return
    val id = soundIds[clip]
    if (id != null && loadedIds.contains(id)) {
      soundPool?.play(id, settings.volume, settings.volume, 1, 0, 1f)
      if (attempt > 0) Log.w(TAG, "clip played late by ${attempt * CLIP_RETRY_MS} ms (still loading) clip=${File(clip).name}")
    } else if (id != null && attempt < CLIP_RETRIES) {
      handler?.postDelayed({ playClip(clip, gen, attempt + 1) }, CLIP_RETRY_MS)
    } else {
      Log.w(TAG, "sound not ready clip=${File(clip).name}")
    }
  }

  private fun stopEverything(immediate: Boolean) {
    val gen = ++generation
    handler?.removeCallbacksAndMessages(CUE_TOKEN)
    if (immediate) haptics?.cancel()
    stopAmbient()
    unregisterCallListener()
    unregisterNoisyReceiver()
    active = false
    paused = false
    notifyPlayer()
    val finish = {
      if (gen == generation) {
        releaseWakeLock()
        // Give media3 a moment to process the ended state first: stopping mid-update let it restart
        // the service with startForegroundService and crash (ForegroundServiceDidNotStartInTime, breathe D39).
        mainHandler.postDelayed({ if (!active) service?.stopSession() }, SERVICE_STOP_DELAY_MS)
      }
    }
    // Let the end chime / voice finish (the wake lock still holds) before letting go.
    if (immediate) finish() else handler?.postDelayed(finish, END_SHUTDOWN_DELAY_MS)
  }

  // --- audio, wake lock, calls --------------------------------------------------------------------

  private fun ensureSounds() {
    val context = appContext ?: return
    if (haptics == null) haptics = CueHaptics(context)
    if (soundPool != null) return
    val pool = SoundPool.Builder()
      .setMaxStreams(4)
      .setAudioAttributes(
        AudioAttributes.Builder()
          // USAGE_MEDIA and no audio-focus request: cues mix with the user's music (D16).
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build()
      )
      .build()
    pool.setOnLoadCompleteListener { _, sampleId, status ->
      // Called on the runner thread's looper (the pool was created there).
      if (status == 0) loadedIds.add(sampleId)
    }
    soundPool = pool
    loadClips(BEEPS)
  }

  /** Loads clips not loaded yet: res/raw names (sr_…) or absolute file paths (voice clips). */
  private fun loadClips(clips: Collection<String>) {
    val context = appContext ?: return
    val pool = soundPool ?: return
    for (clip in clips.toSet()) {
      if (soundIds.containsKey(clip)) continue
      val id = if (clip.startsWith("/")) {
        if (File(clip).isFile) pool.load(clip, 1) else 0
      } else {
        val res = context.resources.getIdentifier(clip, "raw", context.packageName)
        if (res != 0) pool.load(context, res, 1) else 0
      }
      if (id == 0) Log.w(TAG, "clip missing ${File(clip).name}") else soundIds[clip] = id
    }
  }

  /**
   * Near-silent loop: real media playback keeps the mediaPlayback service honest and the CPU awake. A MediaPlayer, not a
   * SoundPool stream: the system lists SoundPool as "idle", so without a started media player the session never became
   * Android's media-button session and headset play/pause went nowhere (P5; Breathe got one from its JS player). No
   * audio-focus request (D16: the user's music keeps playing).
   */
  private fun startAmbient() {
    if (ambientPlayer != null) return
    val context = appContext ?: return
    val res = context.resources.getIdentifier("sr_ambient", "raw", context.packageName)
    if (res == 0) return
    try {
      val mp = MediaPlayer()
      mp.setAudioAttributes(
        AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build()
      )
      context.resources.openRawResourceFd(res).use { afd -> mp.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length) }
      mp.isLooping = true
      mp.prepare()
      mp.start()
      ambientPlayer = mp
    } catch (e: Exception) {
      Log.w(TAG, "ambient bed failed: ${e.message}")
    }
  }

  private fun stopAmbient() {
    val mp = ambientPlayer ?: return
    ambientPlayer = null
    runCatching { mp.stop() }
    mp.release()
  }

  private fun acquireWakeLock() {
    val context = appContext ?: return
    if (wakeLock == null) {
      val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "PlainIntervals:SessionRunner").apply {
        setReferenceCounted(false)
      }
    }
    // Timeout = what is left of the cue list + slack, so a lost session can never pin the CPU (open: 2 h).
    val left = maxOf(0L, (cues.lastOrNull()?.atMs ?: 0L) - elapsed())
    wakeLock?.acquire(left + if (displayEndMs == null) OPEN_WAKE_LOCK_MS else WAKE_LOCK_SLACK_MS)
  }

  private fun releaseWakeLock() {
    wakeLock?.let { if (it.isHeld) it.release() }
  }

  private fun screenOn(): Boolean {
    val pm = appContext?.getSystemService(Context.POWER_SERVICE) as? PowerManager
    return pm?.isInteractive ?: true
  }

  /**
   * Incoming or ongoing call -> pause; the user resumes (no auto-resume). No permission on any version. API 31+: the
   * mode-changed listener. Android 8–11 (F3, D44.3): AudioManager.getMode() polled every CALL_POLL_MS on the runner
   * thread while the session is active (paused too, so a change is seen as a change); the same CallModeWatch rule
   * decides and the same pause path runs.
   */
  private fun registerCallListener() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
      startCallPolling()
      return
    }
    if (modeListener != null) return
    val am = appContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
    val h = handler ?: return
    val listener = AudioManager.OnModeChangedListener { mode ->
      if (CallModeWatch.isCallMode(mode)) pause("interruption")
    }
    am.addOnModeChangedListener(Executor { h.post(it) }, listener)
    modeListener = listener
  }

  private fun unregisterCallListener() {
    stopCallPolling()
    val listener = modeListener ?: return
    modeListener = null
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
    val am = appContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
    am.removeOnModeChangedListener(listener as AudioManager.OnModeChangedListener)
  }

  private fun startCallPolling() {
    if (callWatch.watching) return
    val am = appContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
    callWatch.start(am.mode)
    Log.i(TAG, "call watch: polling AudioManager mode every ${CALL_POLL_MS} ms (API ${Build.VERSION.SDK_INT}) mode=${am.mode}")
    scheduleCallPoll()
  }

  private fun scheduleCallPoll() {
    handler?.postAtTime({ pollCallMode() }, CALL_POLL_TOKEN, SystemClock.uptimeMillis() + CALL_POLL_MS)
  }

  private fun pollCallMode() {
    if (!active || !callWatch.watching) return
    val am = appContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
    val mode = am.mode
    if (callWatch.onPoll(mode)) {
      Log.i(TAG, "call watch: mode=$mode -> pause")
      pause("interruption")
    }
    scheduleCallPoll()
  }

  private fun stopCallPolling() {
    handler?.removeCallbacksAndMessages(CALL_POLL_TOKEN)
    callWatch.stop()
  }

  /**
   * Earbuds or Bluetooth headphones disconnect -> pause (breathe D67): cues must not move to the phone speaker at media
   * volume. Reported to JS as a pause; the user resumes. ACTION_AUDIO_BECOMING_NOISY is a system broadcast, so a
   * not-exported receiver still gets it.
   */
  private fun registerNoisyReceiver() {
    if (noisyReceiver != null) return
    val context = appContext ?: return
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(c: Context?, intent: Intent?) {
        if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) pause("noisy")
      }
    }
    val filter = IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        context.registerReceiver(receiver, filter, null, handler, Context.RECEIVER_NOT_EXPORTED)
      } else {
        context.registerReceiver(receiver, filter, null, handler)
      }
      noisyReceiver = receiver
    } catch (e: Exception) {
      Log.w(TAG, "could not watch for headphones unplugged: ${e.message}")
    }
  }

  private fun unregisterNoisyReceiver() {
    val receiver = noisyReceiver ?: return
    noisyReceiver = null
    runCatching { appContext?.unregisterReceiver(receiver) }
  }

  // --- service / media session -------------------------------------------------------------------

  private fun ensureService() {
    val context = appContext ?: return
    if (service != null) return
    try {
      // Started while the app is visible (Android 17 background-audio rules); media3 moves it to the
      // foreground itself once the session player reports playing.
      context.startService(Intent(context, SessionService::class.java))
    } catch (e: Exception) {
      Log.w(TAG, "could not start SessionService: ${e.message}")
    }
  }

  fun attachService(s: SessionService, p: SessionPlayer) {
    service = s
    player = p
    Log.i(TAG, "service attached active=$active")
    if (!active) mainHandler.postDelayed({ if (!active) s.stopSession() }, SERVICE_STOP_DELAY_MS)
  }

  fun detachService(s: SessionService) {
    if (service === s) {
      service = null
      player = null
    }
  }

  private fun notifyPlayer() {
    mainHandler.post { player?.refresh() }
  }
}
