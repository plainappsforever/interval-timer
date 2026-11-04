/**
 * iOS workout Live Activity glue (D40, A14; breathe D56 pattern). Opt-in (settings.liveActivity, default off, D27):
 * the first start makes iOS ask "Allow Live Activities?", so it only ever follows the user's own switch. The layout
 * (`src/widgets/workout-activity.tsx`) loads lazily and only on iOS builds that carry the widget extension
 * (`WIDGETS=0` builds without it), so Android and such builds skip all of this. Serialized; never throws: a Live
 * Activity problem must not touch a workout.
 */
import { requireOptionalNativeModule } from 'expo';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { liveActivityPlan, needsUpdate, type LiveActivityInput, type WorkoutActivityProps } from './live-activity-plan';

type Layouts = typeof import('@/widgets/workout-activity');

let layouts: Layouts | null | undefined;

function loadLayouts(): Layouts | null {
  if (layouts !== undefined) return layouts;
  // A module that throws while loading is a red screen in development, not a catchable error: check first.
  const built = Constants.expoConfig?.extra?.widgetsEnabled === true;
  if (Platform.OS !== 'ios' || !built || !requireOptionalNativeModule('ExpoWidgets')) return (layouts = null);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    layouts = require('@/widgets/workout-activity') as Layouts;
  } catch (e) {
    if (__DEV__) console.warn('[live-activity] unavailable', e);
    layouts = null;
  }
  return layouts;
}

/** Whether this build can show a Live Activity (the running screen and Settings show the switch only then). */
export function liveActivityAvailable(): boolean {
  return loadLayouts() !== null;
}

let queue: Promise<void> = Promise.resolve();
let shown: WorkoutActivityProps | null = null;

function enqueue(work: () => Promise<void> | void): Promise<void> {
  queue = queue.then(work).catch((e) => {
    if (__DEV__) console.warn('[live-activity]', e);
  });
  return queue;
}

/**
 * Brings the activity in line with the running workout: start, update (only when something shown changed) or end.
 * Called from the running screen's tick and after every action; cheap when nothing changed.
 */
export function syncLiveActivity(input: LiveActivityInput): Promise<void> {
  const l = loadLayouts();
  if (!l) return Promise.resolve();
  const plan = liveActivityPlan(input);
  if (plan.action === 'show' && !needsUpdate(shown, plan.props)) return queue;
  if (plan.action === 'end' && shown === null) return queue;
  shown = plan.action === 'show' ? plan.props : null;
  return enqueue(async () => {
    const running = l.WorkoutActivity.getInstances();
    if (plan.action === 'end') {
      await Promise.all(running.map((a) => a.end('immediate')));
      return;
    }
    const staleDate = plan.staleAt != null ? new Date(plan.staleAt) : undefined;
    const [current, ...extra] = running;
    await Promise.all(extra.map((a) => a.end('immediate')));
    if (current) await current.update(plan.props, staleDate);
    // ActivityKit starts one only while the app is in the foreground (workouts start there; the switch is on screen).
    else l.WorkoutActivity.start(plan.props, undefined, staleDate);
  });
}

/** Ends any leftover activity (a workout that was killed): Home calls this when nothing runs. */
export function endLiveActivities(): Promise<void> {
  const l = loadLayouts();
  if (!l) return Promise.resolve();
  shown = null;
  return enqueue(async () => {
    await Promise.all(l.WorkoutActivity.getInstances().map((a) => a.end('immediate')));
  });
}
