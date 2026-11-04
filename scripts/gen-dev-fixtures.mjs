#!/usr/bin/env node
// Writes the DEVELOPMENT timeline fixture timers (test/fixtures/timeline/dev/timers/*.json): ≥ 30 timers covering
// SPEC §9 edge cases. Expected files come from the Python oracle: `python3 referee/python/timeline_oracle.py --dir
// test/fixtures/timeline/dev`. Same author as the engine → tuning material, never evidence (L27).
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(import.meta.dirname, '../test/fixtures/timeline/dev/timers');
fs.mkdirSync(dir, { recursive: true });

const iv = (name, seconds, type = 'work', extra = {}) => ({ name, seconds, type, color: '', cueStart: 'both', halfwayCue: false, countdownCue: true, openTickS: 0, ...extra });
const block = (intervals, extra = {}) => ({ name: '', rounds: 1, restBetweenRoundsS: 0, ...extra, intervals });
const prefs = (extra = {}) => ({ prepSeconds: 10, endCue: 'both', repeatWhole: 1, vibrate: true, ...extra });
const timer = (name, blocks, p = {}, extra = {}) => ({ name, color: '', notes: '', blocks, prefs: prefs(p), ...extra });
const fx = (timer, settings = { countdownFrom: 3 }, nextAt) => ({ timer, settings, ...(nextAt ? { nextAt } : {}) });

const fixtures = {
  'tabata': fx(timer('Tabata', [block([iv('Work', 20), iv('Rest', 10, 'rest')], { rounds: 8 })])),
  'hiit-30-15': fx(timer('HIIT', [block([iv('Work', 30), iv('Rest', 15, 'rest')], { rounds: 10 })])),
  'emom-halfway': fx(timer('EMOM', [block([iv('Minute', 60, 'work', { halfwayCue: true })], { rounds: 10 })])),
  'boxing-rounds': fx(timer('Boxing', [block([iv('Round', 180, 'work', { halfwayCue: true }), iv('Rest', 60, 'rest')], { rounds: 12 })])),
  'walk-run': fx(timer('Walk/Run', [block([iv('Walk', 60, 'rest'), iv('Run', 60, 'work')], { rounds: 15 })])),
  'circuit-rest-between-rounds': fx(timer('Circuit', [block(Array.from({ length: 6 }, (_, i) => [iv(`Station ${i + 1}`, 45), iv('Rest', 15, 'rest')]).flat(), { rounds: 3, restBetweenRoundsS: 60 })])),
  'stretch-no-countdown': fx(timer('Stretch', [block([iv('Stretch', 30, 'cooldown', { countdownCue: false })], { rounds: 10 })], { prepSeconds: 5 })),
  'no-prep': fx(timer('No prep', [block([iv('Work', 20), iv('Rest', 10, 'rest')], { rounds: 2 })], { prepSeconds: 0 })),
  'prep-3-equals-countdown': fx(timer('Prep 3', [block([iv('Work', 20)])], { prepSeconds: 3 })),
  'prep-1': fx(timer('Prep 1', [block([iv('Work', 5)])], { prepSeconds: 1 })),
  // D32: an interval TYPED prep inside a block follows its own flags; only the timer-level prep segment is fixed (D29).
  'typed-prep-interval-own-flags': fx(timer('Typed prep', [block([iv('Breathe in', 20, 'prep', { halfwayCue: true, countdownCue: false }), iv('Set up', 12, 'prep', { cueStart: 'beep' }), iv('Work', 10)], { rounds: 2 })], { prepSeconds: 5 })),
  'prep-60-countdown-10': fx(timer('Prep 60', [block([iv('Work', 20)])], { prepSeconds: 60 }), { countdownFrom: 10 }),
  'countdown-5': fx(timer('CD5', [block([iv('Work', 20), iv('Rest', 10, 'rest')], { rounds: 3 })], { prepSeconds: 0 }), { countdownFrom: 5 }),
  'countdown-10-short-intervals': fx(timer('CD10', [block([iv('A', 10), iv('B', 11), iv('C', 9), iv('D', 1)])], { prepSeconds: 0 }), { countdownFrom: 10 }),
  'intervals-1-2-3-4s': fx(timer('Tiny', [block([iv('One', 1), iv('Two', 2), iv('Three', 3), iv('Four', 4)], { rounds: 2 })], { prepSeconds: 0 })),
  'halfway-9-10-11': fx(timer('Halfway edge', [block([iv('Nine', 9, 'work', { halfwayCue: true }), iv('Ten', 10, 'work', { halfwayCue: true }), iv('Eleven', 11, 'work', { halfwayCue: true })])], { prepSeconds: 0 })),
  'halfway-collides-with-countdown-5': fx(timer('Collide', [block([iv('Ten', 10, 'work', { halfwayCue: true })], { rounds: 2 })], { prepSeconds: 0 }), { countdownFrom: 5 }),
  'odd-durations': fx(timer('Odd', [block([iv('Seven', 7), iv('Thirteen', 13, 'rest', { halfwayCue: true }), iv('Max', 5999, 'work', { halfwayCue: true })])], { prepSeconds: 7 })),
  'cue-modes': fx(timer('Modes', [block([iv('Voice', 15, 'work', { cueStart: 'voice' }), iv('Beep', 15, 'rest', { cueStart: 'beep' }), iv('Silent', 15, 'work', { cueStart: 'none', halfwayCue: true }), iv('Both', 15, 'cooldown')])])),
  'end-cue-none': fx(timer('No end', [block([iv('Work', 20)], { rounds: 2 })], { endCue: 'none', prepSeconds: 0 })),
  'end-cue-voice-vibrate-off': fx(timer('Voice end', [block([iv('Work', 20)])], { endCue: 'voice', vibrate: false, prepSeconds: 0 })),
  'repeat-2-with-prep': fx(timer('Repeat', [block([iv('Work', 20), iv('Rest', 10, 'rest')], { rounds: 2 })], { repeatWhole: 2 })),
  'repeat-10': fx(timer('Repeat 10', [block([iv('A', 5), iv('B', 6, 'rest')])], { repeatWhole: 10, prepSeconds: 0 })),
  'repeat-3-rest-between-rounds': fx(timer('Repeat rest', [block([iv('Work', 30)], { rounds: 3, restBetweenRoundsS: 20 })], { repeatWhole: 3, prepSeconds: 0 })),
  'two-blocks-one-round-each': fx(timer('Blocks', [block([iv('Squat', 30), iv('Rest', 10, 'rest')], { name: 'Legs' }), block([iv('Plank', 45), iv('Rest', 15, 'rest')], { name: 'Core' })])),
  'rest-between-rounds-ignored-for-one-round': fx(timer('Rest ignored', [block([iv('Work', 30)], { rounds: 1, restBetweenRoundsS: 60 })], { prepSeconds: 0 })),
  'rounds-99': fx(timer('99', [block([iv('W', 2), iv('R', 1, 'rest')], { rounds: 99 })], { prepSeconds: 0 })),
  'max-blocks-and-intervals': fx(timer('Max', Array.from({ length: 20 }, (_, b) => block(Array.from({ length: 30 }, (_, i) => iv(`B${b + 1}I${i + 1}`, 3)), { name: `Block ${b + 1}` })), { prepSeconds: 0 })),
  'eight-hours-exact': fx(timer('8h', [block([iv('Hour', 3600, 'work', { halfwayCue: true })], { rounds: 8 })], { prepSeconds: 0 })),
  'open-single-no-next': fx(timer('Open', [block([iv('Hold', 30, 'open', { openTickS: 10 })])], { prepSeconds: 0 })),
  'open-with-next': fx(timer('Open next', [block([iv('Work', 20), iv('Plank', 60, 'open', { openTickS: 15 }), iv('Rest', 10, 'rest')], { rounds: 2 })], { prepSeconds: 0 }), { countdownFrom: 3 }, [47300, 120000]),
  'open-next-before-start': fx(timer('Open early', [block([iv('Work', 20), iv('Plank', 60, 'open')])], { prepSeconds: 0 }), { countdownFrom: 3 }, [5]),
  'open-ends-timer': fx(timer('Open end', [block([iv('Work', 20), iv('Hold', 30, 'open')])], { prepSeconds: 5 }), { countdownFrom: 3 }, [42000]),
  'open-rest-open': fx(timer('Open rest open', [block([iv('Left', 40, 'open'), iv('Rest', 10, 'rest'), iv('Right', 40, 'open')], { rounds: 2, restBetweenRoundsS: 30 })], { prepSeconds: 0 }), { countdownFrom: 5 }, [30000, 45000, 100000]),
  'open-partially-closed': fx(timer('Open partial', [block([iv('Left', 40, 'open'), iv('Right', 40, 'open')])], { prepSeconds: 0 }), { countdownFrom: 3 }, [25000]),
  'unicode-names': fx(timer('Тренировка 🏋️', [block([iv('運動', 20), iv('استراحة', 10, 'rest'), iv('Übung', 15, 'cooldown')], { rounds: 2 })])),
  'all-types': fx(timer('Types', [block([iv('Prep step', 5, 'prep'), iv('Work', 20), iv('Rest', 10, 'rest'), iv('Cool', 30, 'cooldown', { halfwayCue: true })])])),
  'prep-with-countdown-5-and-repeat': fx(timer('Prep CD5', [block([iv('Work', 12)], { rounds: 2 })], { prepSeconds: 4, repeatWhole: 2 }), { countdownFrom: 5 }),
};

for (const [name, f] of Object.entries(fixtures)) fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(f, null, 1) + '\n');
console.log(`${Object.keys(fixtures).length} dev fixture timers written to ${dir}`);
