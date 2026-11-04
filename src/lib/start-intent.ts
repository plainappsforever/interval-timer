// Review F11 (P9): a workout starts by itself only when the app's own UI asked for it (Start on the home screen, Start in
// the editor, Start again, Resume, "End it and start"). A link (`<scheme>://run/<id>` from another app, a web page, a
// Shortcut) opens the running screen in a "Start <name>?" state that needs one tap. The intent lives only in this
// process's memory, so no link can forge it (a `?start=1` parameter could be). No React here.

/** How long an armed start waits for its running screen (voice clips are prepared after the check, not before). */
export const START_INTENT_TTL_MS = 30_000;

let armed: { id: string; at: number } | null = null;

/** Call right before navigating to the running screen from the app's own UI. */
export function armStart(id: number | string, now = Date.now()): void {
  armed = { id: String(id), at: now };
}

/** True when the app itself asked to start `id` within the last START_INTENT_TTL_MS. Does not consume it. */
export function hasStartIntent(id: number | string | undefined, now = Date.now()): boolean {
  return !!armed && id !== undefined && armed.id === String(id) && now - armed.at >= 0 && now - armed.at <= START_INTENT_TTL_MS;
}

/** The running screen took it (the run began, or the timer was missing): a later link to the same id asks again. */
export function clearStartIntent(): void {
  armed = null;
}
