// The workout that is running in this process (SPEC §9 "two sessions", D41). The running screen registers its
// RunSession; a second running screen (a deep link such as `<scheme>://run/5`, a Shortcut) and the Import screen
// (a share link that arrives mid-workout) ask it first instead of replacing it. No React here.
export type ActiveRun = {
  /** Unique per running screen instance. */
  token: string;
  timerName: string;
  /** Ends the workout (saved to history as ended early) without opening its Done screen. */
  end: () => Promise<void>;
};

let active: ActiveRun | null = null;

export function setActiveRun(run: ActiveRun): void {
  active = run;
}

/** Clears the registration only if it still belongs to `token` (a newer screen may have taken over). */
export function clearActiveRun(token: string): void {
  if (active?.token === token) active = null;
}

/** The running workout other than the caller's own (`token`), or null. */
export function otherActiveRun(token?: string): ActiveRun | null {
  return active && active.token !== token ? active : null;
}
