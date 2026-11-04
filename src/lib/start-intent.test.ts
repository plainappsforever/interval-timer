import { armStart, clearStartIntent, hasStartIntent, START_INTENT_TTL_MS } from './start-intent';

beforeEach(() => clearStartIntent());

test('a link (nothing armed) never starts by itself', () => {
  expect(hasStartIntent('2')).toBe(false);
  expect(hasStartIntent(undefined)).toBe(false);
});

test('the app arms one id; numbers and route strings match; other ids do not', () => {
  armStart(5, 1000);
  expect(hasStartIntent('5', 1000)).toBe(true);
  expect(hasStartIntent(5, 1000)).toBe(true);
  expect(hasStartIntent('2', 1000)).toBe(false);
});

test('not consumed by a check (a cancelled first attempt of the screen effect keeps it), cleared when the run begins', () => {
  armStart(5, 1000);
  expect(hasStartIntent('5', 1001)).toBe(true);
  expect(hasStartIntent('5', 1002)).toBe(true);
  clearStartIntent();
  expect(hasStartIntent('5', 1003)).toBe(false);
});

test('expires: a stale intent does not let a later link start', () => {
  armStart(5, 1000);
  expect(hasStartIntent('5', 1000 + START_INTENT_TTL_MS)).toBe(true);
  expect(hasStartIntent('5', 1000 + START_INTENT_TTL_MS + 1)).toBe(false);
  expect(hasStartIntent('5', 999)).toBe(false);
});

test('a newer start replaces the older one', () => {
  armStart(5, 1000);
  armStart(7, 1001);
  expect(hasStartIntent('5', 1002)).toBe(false);
  expect(hasStartIntent('7', 1002)).toBe(true);
});
