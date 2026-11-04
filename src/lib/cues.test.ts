// P8 (breathe D62, App Review 2.5.4): the iOS JS cue driver releases the near-silent bed and the audio session after a
// pause longer than PAUSE_RELEASE_MS and starts the bed again on Resume. F5 (review 2026-10-26): the bed starts only
// after the background audio mode is set, and audio-mode changes never overtake each other. Players and the audio
// session are mocked; each audio-mode call can be held open (`hold`) to model a slow native round trip.
import { block, DEFAULT_PREFS, interval, type TimerDef } from '@/engine/model';
import { idle, pause, resume, start, addTime, end } from '@/engine/runner';
import { buildTimeline } from '@/engine/schedule';

import { createCueDriver, PAUSE_RELEASE_MS } from './cues';
import { TimingLog } from './timing-log';

jest.mock('../../modules/session-runner/src/SessionRunnerModule', () => ({ __esModule: true, default: null }));

const calls: string[] = [];
/** When set, the next audio-mode call stays pending until `release()`; the call is logged at start and at finish. */
const gate = { hold: false, pending: [] as (() => void)[] };
function mockAudioCall(name: string): Promise<void> {
  calls.push(name);
  if (!gate.hold) {
    calls.push(`${name}:done`);
    return Promise.resolve();
  }
  return new Promise((resolve) =>
    gate.pending.push(() => {
      calls.push(`${name}:done`);
      resolve();
    })
  );
}
jest.mock('./audio', () => ({
  CuePlayers: class {
    preload() {}
    play() {
      return Promise.resolve(true);
    }
    startAmbient() {
      calls.push('startAmbient');
    }
    stopAmbient() {
      calls.push('stopAmbient');
    }
    release() {}
  },
  endBackgroundAudio: () => mockAudioCall('endBackgroundAudio'),
  setSessionAudioMode: () => mockAudioCall('setSessionAudioMode'),
}));

/** Lets queued promise steps run (fake timers do not touch promises). */
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
function releaseAll() {
  const p = gate.pending.splice(0);
  for (const r of p) r();
}

const DEF: TimerDef = {
  name: 'Tabata',
  color: '',
  notes: '',
  blocks: [block([interval('Work', 20, 'work'), interval('Rest', 10, 'rest')], { rounds: 8 })],
  prefs: { ...DEFAULT_PREFS, prepSeconds: 0 },
};

function driver() {
  return createCueDriver({
    title: 'Tabata',
    beepSet: 'classic',
    volume: 1,
    sound: true,
    respectSilent: false,
    voice: new Map(),
    log: new TimingLog(),
    labels: { skip: 'Skip', end: 'End' },
  });
}
const timeline = () => buildTimeline(DEF, { countdownFrom: 3, language: 'en', voiceId: null });
const bed = () => calls.filter((c) => c === 'startAmbient' || c === 'stopAmbient');

beforeEach(async () => {
  calls.length = 0;
  gate.hold = false;
  gate.pending.length = 0;
  jest.useFakeTimers();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(async () => {
  releaseAll();
  await flush();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('a pause releases the bed and the audio session after PAUSE_RELEASE_MS; Resume starts the bed again', async () => {
  const d = driver();
  expect(d.native).toBe(false);
  const now = performance.now();
  let s = start(idle(timeline()), now);
  d.sync(s, 'start');
  await flush();
  expect(calls).toEqual(['setSessionAudioMode', 'setSessionAudioMode:done', 'startAmbient']);
  s = pause(s, now + 5_000);
  d.sync(s, 'pause');
  jest.advanceTimersByTime(PAUSE_RELEASE_MS - 1);
  expect(bed()).toEqual(['startAmbient']);
  // +30 s while paused keeps the release timer
  d.sync(addTime(s, now + 6_000), 'extend');
  jest.advanceTimersByTime(1);
  await flush();
  expect(calls.slice(3)).toEqual(['stopAmbient', 'endBackgroundAudio', 'endBackgroundAudio:done']);
  s = resume(s, now + 5_000 + PAUSE_RELEASE_MS + 10);
  d.sync(s, 'resume');
  await flush();
  expect(calls.slice(-3)).toEqual(['setSessionAudioMode', 'setSessionAudioMode:done', 'startAmbient']);
  d.dispose();
});

test('a short pause keeps the bed (Resume within the minute)', async () => {
  const d = driver();
  const now = performance.now();
  let s = start(idle(timeline()), now);
  d.sync(s, 'start');
  await flush();
  s = pause(s, now + 1_000);
  d.sync(s, 'pause');
  jest.advanceTimersByTime(30_000);
  s = resume(s, now + 31_000);
  d.sync(s, 'resume');
  jest.advanceTimersByTime(PAUSE_RELEASE_MS);
  await flush();
  expect(calls).not.toContain('stopAmbient');
  expect(calls).not.toContain('endBackgroundAudio');
  d.dispose();
});

test('F5: the bed waits for the background audio mode (Start)', async () => {
  gate.hold = true;
  const d = driver();
  d.sync(start(idle(timeline()), performance.now()), 'start');
  await flush();
  expect(calls).toEqual(['setSessionAudioMode']);
  releaseAll();
  await flush();
  expect(calls).toEqual(['setSessionAudioMode', 'setSessionAudioMode:done', 'startAmbient']);
  d.dispose();
});

test('F5: Resume after the release waits until the release has finished, then sets the mode, then starts the bed', async () => {
  const d = driver();
  const now = performance.now();
  let s = start(idle(timeline()), now);
  d.sync(s, 'start');
  await flush();
  gate.hold = true;
  s = pause(s, now + 1_000);
  d.sync(s, 'pause');
  jest.advanceTimersByTime(PAUSE_RELEASE_MS);
  // the release is still in flight when the user taps Resume
  s = resume(s, now + 1_000 + PAUSE_RELEASE_MS + 5);
  d.sync(s, 'resume');
  await flush();
  expect(calls.slice(3)).toEqual(['stopAmbient', 'endBackgroundAudio']);
  releaseAll();
  await flush();
  releaseAll();
  await flush();
  expect(calls.slice(3)).toEqual(['stopAmbient', 'endBackgroundAudio', 'endBackgroundAudio:done', 'setSessionAudioMode', 'setSessionAudioMode:done', 'startAmbient']);
  d.dispose();
});

test('F5: a Pause or End that arrives while the mode change is in flight keeps the bed off', async () => {
  gate.hold = true;
  const now = performance.now();
  const d1 = driver();
  let s = start(idle(timeline()), now);
  d1.sync(s, 'start');
  s = pause(s, now + 200);
  d1.sync(s, 'pause');
  releaseAll();
  await flush();
  expect(bed()).toEqual([]);
  d1.dispose();
  releaseAll();
  await flush();

  calls.length = 0;
  const d2 = driver();
  let s2 = start(idle(timeline()), now);
  d2.sync(s2, 'start');
  s2 = end(s2, now + 300);
  d2.sync(s2, 'end');
  for (let i = 0; i < 3; i++) {
    releaseAll();
    await flush();
  }
  expect(calls).not.toContain('startAmbient');
  d2.dispose();
});

test('F5: dispose before the mode change lands never starts the bed of a closed run', async () => {
  gate.hold = true;
  const d = driver();
  d.sync(start(idle(timeline()), performance.now()), 'start');
  d.dispose();
  for (let i = 0; i < 3; i++) {
    releaseAll();
    await flush();
  }
  expect(calls).not.toContain('startAmbient');
  // the release ran after the mode change, not before it
  expect(calls.indexOf('endBackgroundAudio')).toBeGreaterThan(calls.indexOf('setSessionAudioMode:done'));
});
