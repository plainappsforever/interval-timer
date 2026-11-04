package expo.modules.sessionrunner

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class CueRecord : Record {
  @Field var atMs: Double = 0.0
  @Field var kind: String = ""
  @Field var clips: List<String> = emptyList()
  @Field var vibration: List<Double>? = null
  @Field var label: String? = null
}

class RunnerOptionsRecord : Record {
  @Field var title: String = ""
  @Field var elapsedMs: Double = 0.0
  @Field var displayEndMs: Double? = null
  @Field var sound: Boolean = true
  @Field var volume: Double = 1.0
  @Field var skipLabel: String = "Skip"
  @Field var endLabel: String = "End"
}

private fun CueRecord.toCue() = Cue(atMs.toLong(), kind, clips, vibration?.map { it.toLong() }?.toLongArray(), label)

/** JS face of SessionRunnerCore (see modules/session-runner/src). Android only; iOS plays cues from JS (D14). */
class SessionRunnerModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("SessionRunner")
    Events("onAction")

    OnCreate {
      SessionRunnerCore.actionListener = SessionRunnerCore.ActionListener { action, elapsedMs ->
        sendEvent("onAction", mapOf("action" to action, "elapsedMs" to elapsedMs.toDouble()))
      }
    }

    OnDestroy {
      // JS went away (reload, app closed): never leave cues running without their screen.
      SessionRunnerCore.actionListener = null
      SessionRunnerCore.end("app", false)
    }

    Function("prepare") { clips: List<String> -> SessionRunnerCore.prepare(context, clips) }

    Function("start") { cues: List<CueRecord>, options: RunnerOptionsRecord ->
      SessionService.labels = SessionService.ButtonLabels(options.skipLabel, options.endLabel)
      SessionRunnerCore.start(
        context,
        cues.map { it.toCue() },
        RunnerSettings(
          title = options.title,
          displayEndMs = options.displayEndMs?.toLong(),
          sound = options.sound,
          volume = options.volume.toFloat().coerceIn(0f, 1f),
        ),
        options.elapsedMs.toLong(),
      )
    }

    Function("update") { cues: List<CueRecord>, displayEndMs: Double?, elapsedMs: Double? ->
      SessionRunnerCore.update(cues.map { it.toCue() }, displayEndMs?.toLong(), elapsedMs?.toLong())
    }

    Function("pause") { SessionRunnerCore.pause("app") }

    Function("resume") { elapsedMs: Double -> SessionRunnerCore.resume("app", elapsedMs.toLong()) }

    Function("end") { playCue: Boolean -> SessionRunnerCore.end("app", playCue) }

    Function("stop") { SessionRunnerCore.end("app", false) }

    Function("isRunning") { SessionRunnerCore.active }
  }
}
