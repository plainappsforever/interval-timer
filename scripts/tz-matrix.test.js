/**
 * @jest-environment node
 */
const fs = require('node:fs');
const path = require('node:path');
const { runMatrix, normalise } = require('./tz-matrix');

const fixtures = path.join(__dirname, 'fixtures', 'tz');
const zones = ['UTC', 'Pacific/Auckland', 'Asia/Kolkata'];

describe('tz-matrix tool', () => {
  it('passes a zone independent test', () => {
    const res = runMatrix(path.join(fixtures, 'stable.fixture.test.js'), zones);
    expect(res.problems).toEqual([]);
  }, 120000);

  it('fails a zone dependent test', () => {
    const res = runMatrix(path.join(fixtures, 'leaky.fixture.test.js'), zones);
    expect(res.ok).toBe(false);
    expect(res.problems.some((p) => p.includes('output differs'))).toBe(true);
  }, 120000);

  it('ignores timings when comparing', () => {
    expect(normalise('Time: 1.2 s\nok (12 ms)')).toBe(normalise('Time: 3.4 s\nok (99 ms)'));
  });
});

// Lint-style guard: assigning process.env.TZ inside a running Jest process does not change the zone, so a test that
// does it proves nothing. Use scripts/tz-matrix.js. A line may opt out with the allow comment (the tool itself).
describe('no test assigns process.env.TZ', () => {
  const root = path.resolve(__dirname, '..');
  const skip = new Set(['node_modules', 'ios', 'android', '.git', 'artifacts', '.claude']);
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(test|spec)\.[jt]sx?$/.test(e.name)) files.push(p);
    }
  })(root);

  it('finds no assignment', () => {
    const bad = [];
    for (const f of files) {
      fs.readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/process\.env\.TZ\s*=(?!=)/.test(line) && !line.includes('tz-matrix-allow')) bad.push(`${path.relative(root, f)}:${i + 1}`);
        });
    }
    expect(bad).toEqual([]);
  });
});
