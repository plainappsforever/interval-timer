#!/usr/bin/env node
// Fails when a UI language file differs from src/i18n/en.ts: a missing or extra key, an empty text, a {placeholder} that is
// missing or added, or the app name "Plain Intervals" translated (German compounds may hyphenate it). Also checks that every file is registered in src/i18n/index.ts.
// Part of `npm run verify` (D23, print-cost D90 pattern). Usage: node scripts/check-i18n.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'src', 'i18n');
const LINE = /^\s*'([^']+)':\s*'((?:[^'\\]|\\.)*)',?\s*(\/\/.*)?$/;

function load(file) {
  const entries = new Map();
  const odd = [];
  readFileSync(join(dir, file), 'utf8')
    .split('\n')
    .forEach((line, i) => {
      const m = LINE.exec(line);
      if (m) {
        if (entries.has(m[1])) odd.push(`line ${i + 1}: key "${m[1]}" twice`);
        entries.set(m[1], m[2].replace(/\\'/g, "'"));
      } else if (/^\s*'[^']+':/.test(line)) odd.push(`line ${i + 1}: not a one-line single-quoted entry`);
    });
  return { entries, odd };
}

const placeholders = (text) => (text.match(/\{\w+\}/g) ?? []).sort().join(' ');
// Language files only: en.ts and every file typed `Record<MessageKey, string>` (helpers such as apply.ts are skipped).
const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'index.ts' && !f.endsWith('.test.ts') && (f === 'en.ts' || readFileSync(join(dir, f), 'utf8').includes('Record<MessageKey, string>')));
const index = readFileSync(join(dir, 'index.ts'), 'utf8');
const en = load('en.ts').entries;
const errors = [];

for (const file of files) {
  const { entries, odd } = load(file);
  odd.forEach((o) => errors.push(`${file}: ${o}`));
  if (!index.includes(`from './${file.replace(/\.ts$/, '')}'`)) errors.push(`${file}: not imported in src/i18n/index.ts`);
  if (file === 'en.ts') continue;
  for (const [key, text] of en) {
    if (!entries.has(key)) {
      errors.push(`${file}: missing key "${key}"`);
      continue;
    }
    const value = entries.get(key);
    if (value.trim() === '') errors.push(`${file}: "${key}" is empty`);
    if (placeholders(value) !== placeholders(text)) errors.push(`${file}: "${key}" placeholders ${placeholders(value) || '(none)'} instead of ${placeholders(text) || '(none)'}`);
    if (text.includes('Plain Intervals') && !/Plain[ -]Intervals/.test(value)) errors.push(`${file}: "${key}" must keep the name "Plain Intervals"`);
  }
  for (const key of entries.keys()) if (!en.has(key)) errors.push(`${file}: extra key "${key}" (not in en.ts)`);
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  console.error(`check-i18n: ${errors.length} problem(s)`);
  process.exit(1);
}
console.log(`check-i18n: ${files.length} language files OK (${en.size} keys each)`);
