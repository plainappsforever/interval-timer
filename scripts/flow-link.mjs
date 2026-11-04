#!/usr/bin/env node
// Prints the share links the Maestro flows open (import-link.yaml, start-two-taps.yaml), made by the real share codec
// so the flows test what the app's Share button sends. Usage: node --import ./scripts/node/ts-hooks.mjs scripts/flow-link.mjs
import { block, DEFAULT_PREFS, interval } from '../src/engine/model.ts';
import { encodeTimerLink } from '../src/engine/share-codec.ts';

const quick = {
  name: 'Quick test',
  color: '#1565C0',
  notes: '',
  // 3 s get ready + 2 × (Work 5 s, Rest 3 s) = 19 s, with an end cue: a whole run inside one Maestro flow
  blocks: [block([interval('Work', 5, 'work'), interval('Rest', 3, 'rest')], { rounds: 2 })],
  prefs: { ...DEFAULT_PREFS, prepSeconds: 3 },
};
const shared = {
  name: 'Shared circuit',
  color: '',
  notes: '',
  blocks: [
    block([interval('Squats', 40, 'work'), interval('Rest', 20, 'rest'), interval('Push-ups', 40, 'work'), interval('Rest', 20, 'rest')], { rounds: 3, restBetweenRoundsS: 60, name: 'Legs' }),
    block([interval('Plank', 60, 'work', { halfwayCue: true })], { rounds: 2, restBetweenRoundsS: 30 }),
  ],
  prefs: { ...DEFAULT_PREFS },
};
for (const def of [quick, shared]) console.log(`${def.name}: ${encodeTimerLink(def).replace(/^plainintervals:\/\//, '')}`);
