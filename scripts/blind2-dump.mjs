#!/usr/bin/env node
// Writes the ONE results file of blind set B2 (P4c, L27) for its own checker. Device-free, plain Node.
// Usage: node --import ./scripts/node/ts-hooks.mjs scripts/blind2-dump.mjs <set folder> <results.json>
// Then:  python3 -I -B <set folder>/checker.py <results.json>
import fs from 'node:fs';
import path from 'node:path';

import { runBlind2 } from '../test/blind2-format.ts';
import { resolveZoneCases } from '../test/zone-child.ts';

const [setDir, out] = process.argv.slice(2);
if (!setDir || !out) {
  console.error('usage: blind2-dump.mjs <set folder> <results.json>');
  process.exit(2);
}
const results = await runBlind2(path.resolve(setDir), (p) => fs.readFileSync(p, 'utf8'), (d) => fs.readdirSync(d), path.join);
resolveZoneCases(results, (o) => [import.meta.filename, setDir, o], (w) => w);
fs.writeFileSync(out, JSON.stringify(results, null, 1) + '\n');
const errors = Object.entries(results).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v) && ('error' in v));
console.log(`results: ${Object.keys(results).length} cases -> ${out}; ${errors.length} cases threw in the engine or adapter`);
for (const [id, v] of errors) console.log(`  ${id}: ${v.error}`);
