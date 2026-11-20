// Rating prompt (redesign R1): the system's own review sheet, asked rarely and only after real use. The rule is a pure
// function (rating.test.ts); `maybeAskForRating` wraps it with the stored version, the finished-workout count and the
// store-review module. Called once from the Done screen of a completed workout, so never at first launch and never while a
// timer runs. iOS and Android decide on their own whether the sheet appears at all; the app only records that it asked.
import Constants from 'expo-constants';
import * as StoreReview from 'expo-store-review';

import { countCompletedSessions } from '@/db/sessions';
import { getSetting, setSetting } from '@/db/settings';
import type { Db } from '@/db/types';
import { otherActiveRun } from '@/lib/active-run';

/** Completed workouts needed before the first ask (the fifth finished one triggers it). */
export const RATING_AFTER_COMPLETED = 5;

export function shouldAskForRating(input: {
  completedWorkouts: number;
  /** The app version the prompt was last requested in, or null. */
  askedVersion: string | null;
  currentVersion: string;
  /** A timer is running right now. */
  running: boolean;
}): boolean {
  if (input.running) return false;
  if (input.completedWorkouts < RATING_AFTER_COMPLETED) return false;
  return input.askedVersion !== input.currentVersion;
}

/** Returns true when the review sheet was requested. Never throws. */
export async function maybeAskForRating(db: Db): Promise<boolean> {
  try {
    const currentVersion = Constants.expoConfig?.version;
    if (!currentVersion) return false;
    const ask = shouldAskForRating({
      completedWorkouts: await countCompletedSessions(db),
      askedVersion: await getSetting(db, 'ratingAskedVersion'),
      currentVersion,
      running: otherActiveRun() !== null,
    });
    if (!ask || !(await StoreReview.isAvailableAsync())) return false;
    // recorded first: a crash or a refusal by the system must not turn into a second ask in the same version
    await setSetting(db, 'ratingAskedVersion', currentVersion);
    await StoreReview.requestReview();
    return true;
  } catch {
    return false;
  }
}
