import { RATING_AFTER_COMPLETED, shouldAskForRating } from './rating';

const base = { completedWorkouts: 5, askedVersion: null, currentVersion: '1.1.0', running: false };

describe('rating prompt trigger', () => {
  test('asks on the fifth completed workout, not before', () => {
    expect(RATING_AFTER_COMPLETED).toBe(5);
    expect(shouldAskForRating({ ...base, completedWorkouts: 0 })).toBe(false);
    expect(shouldAskForRating({ ...base, completedWorkouts: 4 })).toBe(false);
    expect(shouldAskForRating(base)).toBe(true);
    expect(shouldAskForRating({ ...base, completedWorkouts: 40 })).toBe(true);
  });

  test('never while a timer runs', () => {
    expect(shouldAskForRating({ ...base, running: true })).toBe(false);
  });

  test('at most once per app version, again after an update', () => {
    expect(shouldAskForRating({ ...base, askedVersion: '1.1.0' })).toBe(false);
    expect(shouldAskForRating({ ...base, askedVersion: '1.0.0' })).toBe(true);
  });
});
