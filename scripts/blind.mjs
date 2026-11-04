#!/usr/bin/env node
// Timeline exactness on a fixture folder (SPEC §13 O1, A1): compares buildTimeline (+ rebase for Next) with each
// fixture's expected segments and cues, exactly in ms. Device-free (plain Node, scripts/node/ts-hooks.mjs).
// Usage: npm run blind -- <folder|dev>
//   dev = test/fixtures/timeline/dev (the builder's DEVELOPMENT set — tuning material, never evidence)
//   a folder with timers/ + expected/ (FORMAT.md layout), or a blind set with its own README (adapter: test/blind-format.ts)
import fs from 'node:fs';
import path from 'node:path';

import { formatSet, loadDevSet, scoreSet } from '../test/timeline-score.ts';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
let failed = false;
for (const set of args.length ? args : ['dev']) {
  const dir = set === 'dev' ? path.join(root, 'test/fixtures/timeline/dev') : path.resolve(set);
  let fixtures;
  if (fs.existsSync(path.join(dir, 'timers')) && fs.existsSync(path.join(dir, 'expected'))) {
    fixtures = loadDevSet(dir, (p) => fs.readFileSync(p, 'utf8'), (d) => fs.readdirSync(d), path.join);
  } else {
    const { loadBlind } = await import('../test/blind-format.ts');
    fixtures = loadBlind(dir, (p) => fs.readFileSync(p, 'utf8'), (d) => fs.readdirSync(d), path.join);
  }
  const t0 = performance.now();
  const result = scoreSet(fixtures);
  const ms = performance.now() - t0;
  console.log(formatSet(`${set}${set === 'dev' ? ' (DEVELOPMENT SET, not evidence)' : ''}, ${ms.toFixed(0)} ms`, result));
  if (result.clean !== result.fixtures) failed = true;
}
process.exit(failed ? 1 : 0);
