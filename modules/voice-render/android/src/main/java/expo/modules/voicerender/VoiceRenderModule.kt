package expo.modules.voicerender

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.RandomAccessFile
import java.util.Locale

/**
 * SPEC §6.2 / D15: renders a cue text with TextToSpeech.synthesizeToFile into a WAV file, which the session runner
 * then plays with SoundPool like a beep (so voice cues work with the screen off). Network voices are never used
 * (Voice.isNetworkConnectionRequired filtered out). One render at a time; JS queues them.
 */
class VoiceRenderModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private var tts: TextToSpeech? = null
  private var ready: Boolean? = null // null = initialising
  private val waiting = ArrayList<(Boolean) -> Unit>()
  private val pending = HashMap<String, (Boolean, String?) -> Unit>()

  override fun definition() = ModuleDefinition {
    Name("VoiceRender")

    OnDestroy {
      main.post {
        tts?.shutdown()
        tts = null
        ready = null
      }
    }

    AsyncFunction("render") { text: String, language: String, voiceId: String?, outPath: String, promise: Promise ->
      main.post { withEngine { ok -> if (!ok) promise.resolve(fail("no-voice", "no speech engine")) else render(text, language, voiceId, outPath, promise) } }
    }

    AsyncFunction("voices") { language: String, promise: Promise ->
      main.post {
        withEngine { ok ->
          if (!ok) {
            promise.resolve(emptyList<Map<String, Any>>())
          } else {
            val prefix = language.lowercase(Locale.ROOT).replace('_', '-')
            val list = (runCatching { tts?.voices }.getOrNull() ?: emptySet())
              .filter { !it.isNetworkConnectionRequired && it.locale.toLanguageTag().lowercase(Locale.ROOT).startsWith(prefix) }
              .sortedBy { it.name }
              .map { v ->
                mapOf(
                  "id" to v.name,
                  "name" to v.name,
                  "language" to v.locale.toLanguageTag(),
                  "quality" to if (v.quality >= Voice.QUALITY_HIGH) "enhanced" else "default",
                  "offline" to true,
                )
              }
            promise.resolve(list)
          }
        }
      }
    }
  }

  private fun fail(reason: String, message: String? = null): Map<String, Any?> = mapOf("ok" to false, "reason" to reason, "message" to message)

  /** Runs `block` once the engine is initialised (main thread). */
  private fun withEngine(block: (Boolean) -> Unit) {
    when (ready) {
      true -> block(true)
      false -> block(false)
      null -> {
        waiting.add(block)
        if (tts != null) return
        val context = appContext.reactContext
        if (context == null) {
          val all = ArrayList(waiting)
          waiting.clear()
          all.forEach { it(false) }
          return
        }
        tts = TextToSpeech(context.applicationContext) { status ->
          main.post {
            ready = status == TextToSpeech.SUCCESS
            if (ready == true) tts?.setOnUtteranceProgressListener(listener)
            val all = ArrayList(waiting)
            waiting.clear()
            all.forEach { it(ready == true) }
          }
        }
      }
    }
  }

  private val listener = object : UtteranceProgressListener() {
    override fun onStart(utteranceId: String?) {}

    override fun onDone(utteranceId: String?) {
      main.post { utteranceId?.let { pending.remove(it)?.invoke(true, null) } }
    }

    @Deprecated("Deprecated in Java")
    override fun onError(utteranceId: String?) {
      main.post { utteranceId?.let { pending.remove(it)?.invoke(false, "error") } }
    }

    override fun onError(utteranceId: String?, errorCode: Int) {
      main.post { utteranceId?.let { pending.remove(it)?.invoke(false, "error $errorCode") } }
    }
  }

  private fun render(text: String, language: String, voiceId: String?, outPath: String, promise: Promise) {
    val engine = tts ?: return promise.resolve(fail("no-voice"))
    val locale = Locale.forLanguageTag(language)
    val offline = (runCatching { engine.voices }.getOrNull() ?: emptySet()).filter { !it.isNetworkConnectionRequired }
    val chosen = voiceId?.let { id -> offline.firstOrNull { it.name == id } }
      ?: offline.firstOrNull { it.locale == locale && !it.features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) }
      ?: offline.firstOrNull { it.locale.language == locale.language && !it.features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) }
    if (chosen == null) {
      val avail = engine.isLanguageAvailable(locale)
      if (avail < TextToSpeech.LANG_AVAILABLE) return promise.resolve(fail("no-voice", "language $language: $avail"))
      engine.language = locale
    } else {
      engine.voice = chosen
    }
    val file = File(outPath)
    file.parentFile?.mkdirs()
    val id = "vr-" + System.nanoTime()
    val timeout = Runnable { pending.remove(id)?.invoke(false, "timeout") }
    pending[id] = { ok, message ->
      main.removeCallbacks(timeout)
      val durationMs = if (ok) wavDurationMs(file) else null
      when {
        !ok -> promise.resolve(fail("error", message))
        durationMs == null || durationMs <= 0.0 -> promise.resolve(fail("no-voice", "empty file"))
        else -> promise.resolve(mapOf("ok" to true, "path" to file.absolutePath, "durationMs" to durationMs))
      }
    }
    main.postDelayed(timeout, 15_000)
    val result = engine.synthesizeToFile(text, Bundle(), file, id)
    if (result != TextToSpeech.SUCCESS) pending.remove(id)?.invoke(false, "synthesizeToFile $result")
  }

  /** PCM WAV length from the header: data bytes / byte rate. null when the file is not a WAV we understand. */
  private fun wavDurationMs(file: File): Double? = runCatching {
    RandomAccessFile(file, "r").use { f ->
      val header = ByteArray(12)
      f.readFully(header)
      if (String(header, 0, 4) != "RIFF" || String(header, 8, 4) != "WAVE") return null
      var byteRate = 0L
      while (f.filePointer + 8 <= f.length()) {
        val idBytes = ByteArray(4)
        f.readFully(idBytes)
        val size = Integer.reverseBytes(f.readInt()).toLong() and 0xffffffffL
        val chunk = String(idBytes)
        if (chunk == "fmt ") {
          val fmt = ByteArray(size.toInt())
          f.readFully(fmt)
          byteRate = (fmt[8].toLong() and 0xff) or ((fmt[9].toLong() and 0xff) shl 8) or ((fmt[10].toLong() and 0xff) shl 16) or ((fmt[11].toLong() and 0xff) shl 24)
        } else if (chunk == "data") {
          // Some engines leave the data size at 0 or 0xFFFFFFFF while streaming: fall back to the file length.
          val bytes = if (size == 0L || size == 0xffffffffL) f.length() - f.filePointer else size
          return if (byteRate > 0) bytes * 1000.0 / byteRate else null
        } else {
          f.seek(f.filePointer + size + (size and 1))
        }
      }
      null
    }
  }.getOrNull()
}
