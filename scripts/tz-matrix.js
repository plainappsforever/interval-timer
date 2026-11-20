#!/usr/bin/env node
// Runs one Jest test path once per phone zone, each in its own process with TZ set from outside, and fails when a
// run fails or the outputs differ between zones. Why: assigning process.env.TZ inside a running Jest process does
// not change the zone Date and Intl use (measured in trip-kit, 2026-11-19), so such tests prove nothing.
//
//   node scripts/tz-matrix.js <test path> [--zones A,B,C]      (npm run test:zones -- <test path>)
//
// A test that should be zone independent prints (console.log) its result or fingerprint; the tool compares the
// normalised output of every run. Each run also reports the zone it really ran in; a zone that did not take effect
// fails the run, otherwise the comparison would prove nothing.
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const DEFAULT_ZONES = [
  'UTC',
  'Europe/Berlin',
  'America/Los_Angeles',
  'Pacific/Auckland',
  'Asia/Kolkata',
  'America/St_Johns',
  'Australia/Lord_Howe',
  'Pacific/Kiritimati',
];
/** Names ICU may report for a zone it was given under another name. */
const ICU_NAMES = { UTC: ['Etc/UTC', 'UTC'], 'Asia/Kolkata': ['Asia/Calcutta'] };

/** Drops lines and fragments that legitimately differ between runs (timings, paths of the zone probe). */
function normalise(text) {
  return text
    .replace(/\x1b\[[0-9;]*m/g, '')
    .split('\n')
    .filter((l) => !/^\s*(Time|Snapshots|Ran all test suites|Test Suites):?/.test(l) && !/^(PASS|FAIL)\s/.test(l))
    .map((l) => l.replace(/\s*\(\d+(\.\d+)?\s*m?s\)/g, '').replace(/\d+(\.\d+)?\s*m?s\b/g, 'T'))
    .join('\n')
    .trim();
}

function actualZone(zone) {
  const r = spawnSync(process.execPath, ['-e', 'process.stdout.write(Intl.DateTimeFormat().resolvedOptions().timeZone)'], {
    env: { ...process.env, TZ: zone },
    encoding: 'utf8',
  });
  return (r.stdout || '').trim();
}

function runMatrix(testPath, zones = DEFAULT_ZONES) {
  const jestBin = path.join(root, 'node_modules', 'jest', 'bin', 'jest.js');
  const results = zones.map((zone) => {
    const ran = actualZone(zone);
    const zoneOk = [zone, ...(ICU_NAMES[zone] || [])].includes(ran);
    const r = spawnSync(process.execPath, [jestBin, '--runTestsByPath', testPath, '--ci', '--watchman=false', '--testPathIgnorePatterns', '/node_modules/'], {
      cwd: root,
      env: { ...process.env, TZ: zone },
      encoding: 'utf8',
      timeout: 240000,
    });
    return { zone, ran, zoneOk, status: r.status, output: normalise(`${r.stdout || ''}\n${r.stderr || ''}`) };
  });
  const problems = [];
  for (const r of results) {
    if (!r.zoneOk) problems.push(`${r.zone}: process ran in "${r.ran}", the zone did not take effect`);
    if (r.status !== 0) problems.push(`${r.zone}: test run failed (exit ${r.status})\n${r.output.slice(-600)}`);
  }
  const base = results[0];
  for (const r of results.slice(1)) {
    if (r.output !== base.output) problems.push(`${r.zone}: output differs from ${base.zone}`);
  }
  return { ok: problems.length === 0, problems, results };
}

module.exports = { runMatrix, normalise, DEFAULT_ZONES };

if (require.main === module) {
  const args = process.argv.slice(2);
  const zi = args.indexOf('--zones');
  const zones = zi >= 0 ? args.splice(zi, 2)[1].split(',') : DEFAULT_ZONES;
  const testPath = args[0];
  if (!testPath) {
    console.error('usage: node scripts/tz-matrix.js <test path> [--zones A,B,C]');
    process.exit(2);
  }
  const res = runMatrix(path.resolve(testPath), zones);
  for (const r of res.results) console.log(`${r.zone.padEnd(22)} ran as ${r.ran.padEnd(22)} exit ${r.status}`);
  if (!res.ok) {
    console.error(`\nFAILED\n${res.problems.join('\n')}`);
    process.exit(1);
  }
  console.log(`\nOK: ${zones.length} zones, identical output`);
}
