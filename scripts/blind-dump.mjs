#!/usr/bin/env node
// Writes the README dump of a blind set (every family) for its own checker (P3b, L27). Device-free, plain Node.
// Usage: node --import ./scripts/node/ts-hooks.mjs scripts/blind-dump.mjs <set folder> <dump.json> [engine label]
// Then:  python3 -I <set folder>/tools/check.py <set folder> <dump.json>
import fs from 'node:fs';
import path from 'node:path';

import { dumpBlind } from '../test/blind-format.ts';

const [setDir, out, label] = process.argv.slice(2);
if (!setDir || !out) {
  console.error('usage: blind-dump.mjs <set folder> <dump.json> [engine label]');
  process.exit(2);
}
const dump = await dumpBlind(path.resolve(setDir), (p) => fs.readFileSync(p, 'utf8'), path.join, label ?? 'unlabelled');
fs.writeFileSync(out, JSON.stringify(dump, null, 1) + '\n');
const errors = Object.entries(dump.results).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v) && 'error' in v);
console.log(`dump: ${Object.keys(dump.results).length} cases -> ${out}; ${errors.length} cases threw in the engine or adapter`);
for (const [id, v] of errors) console.log(`  ${id}: ${v.error}`);
