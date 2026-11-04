package expo.modules.sessionrunner

import android.media.AudioManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * F3 (review 2026-10-26, D44.3): the Android 8–11 call watch. SessionRunnerCore feeds one AudioManager.getMode()
 * reading per second; true = pause the workout (same path as the API 31+ listener).
 */
class CallModeWatchTest {
  private fun polls(start: Int, vararg modes: Int): List<Boolean> {
    val w = CallModeWatch()
    w.start(start)
    return modes.map { w.onPoll(it) }
  }

  @Test
  fun constantsMatchAudioManager() {
    // Kotlin inlines android.jar's compile-time constants, so this needs no Android runtime.
    assertEquals(AudioManager.MODE_NORMAL, CallModeWatch.MODE_NORMAL)
    assertEquals(AudioManager.MODE_RINGTONE, CallModeWatch.MODE_RINGTONE)
    assertEquals(AudioManager.MODE_IN_CALL, CallModeWatch.MODE_IN_CALL)
    assertEquals(AudioManager.MODE_IN_COMMUNICATION, CallModeWatch.MODE_IN_COMMUNICATION)
  }

  @Test
  fun quietPhoneNeverPauses() {
    assertEquals(listOf(false, false, false), polls(0, 0, 0, 0))
  }

  @Test
  fun incomingCallPausesOnceWhenItStartsRinging() {
    // ringing -> answered -> still in the call -> hung up
    assertEquals(listOf(true, true, false, false), polls(0, 1, 2, 2, 0))
  }

  @Test
  fun voipCallPauses() {
    assertEquals(listOf(true, false), polls(0, 3, 3))
  }

  @Test
  fun resumingDuringACallIsNotUndone() {
    // the user resumed while the call goes on: the mode stays IN_CALL, so no new pause every second
    assertEquals(listOf(true, false, false, false), polls(0, 2, 2, 2, 2))
  }

  @Test
  fun aCallAlreadyRunningAtStartDoesNotPauseButTheNextOneDoes() {
    assertEquals(listOf(false, false, true), polls(2, 2, 0, 2))
  }

  @Test
  fun stoppedWatchNeverPauses() {
    val w = CallModeWatch()
    assertFalse(w.watching)
    assertFalse(w.onPoll(2))
    w.start(0)
    assertTrue(w.watching)
    w.stop()
    assertFalse(w.onPoll(2))
  }

  @Test
  fun otherModesDoNotPause() {
    // MODE_CALL_SCREENING (4, API 30) and the redirect modes are not calls the user hears
    assertEquals(listOf(false, false, false), polls(0, 4, 5, 6))
  }
}
