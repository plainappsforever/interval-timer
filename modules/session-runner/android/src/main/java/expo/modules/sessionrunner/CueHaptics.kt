package expo.modules.sessionrunner

import android.content.Context
import android.media.AudioAttributes
import android.os.Build
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/**
 * Vibration for runner cues (D17). Copied from Breathe's CueHaptics and generalised: the JS timeline gives every cue
 * its own waveform ([off, on, off, on, ...] ms, src/engine/schedule.ts VIBRATION), so nothing here knows cue kinds.
 */
class CueHaptics(context: Context) {
  private val vibrator: Vibrator? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
    } else {
      @Suppress("DEPRECATION")
      context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
    }

  fun play(pattern: LongArray?) {
    if (pattern == null || pattern.isEmpty() || pattern.none { it > 0 }) return
    val v = vibrator ?: return
    if (!v.hasVibrator()) return
    val effect = VibrationEffect.createWaveform(pattern, -1)
    v.cancel()
    // Media usage: allowed from a mediaPlayback foreground service with the screen off (touch usage is not).
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      v.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_MEDIA))
    } else {
      @Suppress("DEPRECATION")
      v.vibrate(effect, AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).build())
    }
  }

  fun cancel() {
    vibrator?.cancel()
  }
}
