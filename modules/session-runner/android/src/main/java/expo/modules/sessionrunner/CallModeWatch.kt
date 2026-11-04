package expo.modules.sessionrunner

/**
 * Call detection for Android 8–11 (review 2026-10-26 F3, DECISIONS D44.3). AudioManager.OnModeChangedListener exists
 * from API 31 only, so below that SessionRunnerCore polls AudioManager.getMode() (no permission) once a second while a
 * session is active and feeds every reading in here. The decision is the listener's: pause when the mode CHANGES to
 * ringing, in a call or in communication (VoIP). Edge-triggered on purpose: the listener fires only on changes, so a
 * user who resumes during a call keeps going; a level check would pause again every second.
 *
 * Pure Kotlin (no Android types), so a JVM unit test covers it (src/test/.../CallModeWatchTest.kt).
 */
class CallModeWatch {
  private var last: Int? = null

  /** Starts watching from the current mode; a call already running at Start does not pause (as with the listener). */
  fun start(mode: Int) {
    last = mode
  }

  fun stop() {
    last = null
  }

  val watching: Boolean
    get() = last != null

  /** One reading of AudioManager.getMode(). True = pause now. Not watching -> never pauses. */
  fun onPoll(mode: Int): Boolean {
    val prev = last ?: return false
    last = mode
    return mode != prev && isCallMode(mode)
  }

  companion object {
    // android.media.AudioManager's public constants (unchanged since API 11); the unit test compares them.
    const val MODE_NORMAL = 0
    const val MODE_RINGTONE = 1
    const val MODE_IN_CALL = 2
    const val MODE_IN_COMMUNICATION = 3

    /** The modes the API 31+ listener and the poller both pause on. */
    fun isCallMode(mode: Int): Boolean = mode == MODE_RINGTONE || mode == MODE_IN_CALL || mode == MODE_IN_COMMUNICATION
  }
}
