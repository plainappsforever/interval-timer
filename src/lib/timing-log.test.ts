import { summarize, TIMING_LOG_SIZE, TimingLog } from './timing-log';

describe('timing log (A3/A4 measurements)', () => {
  it('summarises min/mean/max of the deltas, per filter, and keeps a bounded ring', () => {
    const sink = jest.fn();
    const log = new TimingLog(sink);
    log.add({ cueAtMs: 1000, firedAtMs: 1003, kind: 'start', mode: 'active', played: 'beep', wallMs: 0 });
    log.add({ cueAtMs: 2000, firedAtMs: 2011, kind: 'countdown', mode: 'background', played: 'beep+voice', wallMs: 0 });
    log.add({ cueAtMs: 3000, firedAtMs: 2998, kind: 'end', mode: 'background', played: 'voice', wallMs: 0 });
    expect(summarize(log.all())).toEqual({ n: 3, min: -2, mean: 4, max: 11, absMax: 11 });
    expect(summarize(log.all(), (e) => e.mode === 'background')).toMatchObject({ n: 2, max: 11 });
    expect(summarize([], () => true)).toBeNull();
    log.annotate(2000, 'voice-not-playing');
    expect(log.all()[1].played).toBe('voice-not-playing');
    for (let i = 0; i < TIMING_LOG_SIZE + 5; i++) log.add({ cueAtMs: i, firedAtMs: i, kind: 'x', mode: 'active', played: '', wallMs: 0 });
    expect(log.all()).toHaveLength(TIMING_LOG_SIZE);
    expect(sink).toHaveBeenCalled();
  });
});
