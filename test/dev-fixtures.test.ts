/**
 * @jest-environment node
 */
import fs from 'node:fs';
import path from 'node:path';

import { formatSet, loadDevSet, scoreSet } from './timeline-score';

describe('development timeline fixtures (tuning set, not evidence — L27)', () => {
  it('every dev fixture matches the Python oracle exactly', () => {
    const dir = path.join(__dirname, 'fixtures/timeline/dev');
    const fixtures = loadDevSet(dir, (p) => fs.readFileSync(p, 'utf8'), (d) => fs.readdirSync(d), path.join);
    expect(fixtures.length).toBeGreaterThanOrEqual(30);
    const result = scoreSet(fixtures);
    expect(formatSet('dev', result)).toBe(`dev: ${result.fixtures} fixtures, ${result.fixtures} exact, 0 segment mismatches, 0 cue mismatches, 0 total mismatches`);
  });
});
