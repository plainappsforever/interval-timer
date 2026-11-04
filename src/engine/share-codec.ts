// Share codec (SPEC §5.5, D19): timer ↔ compact JSON ↔ base64url in `plainintervals://t?d=…`, and a readable `.json`
// file. Versioned; round-trip exact; unknown fields ignored; every limit enforced on import; never throws (A11 fuzz).
import { decodeText, encodeText } from './base64url';
import type { CueMode, IntervalDef, IntervalType, TimerDef, TimerPrefs } from './model';
import { DEFAULT_PREFS } from './model';
import { validateTimer, type ValidationIssue } from './validation';

export const SHARE_VERSION = 1;
export const SHARE_SCHEME = 'plainintervals';
export const SHARE_HOST = 't';
export const FILE_FORMAT = 'plainintervals-timer';

const TYPES: readonly IntervalType[] = ['prep', 'work', 'rest', 'cooldown', 'open'];
const MODES: readonly CueMode[] = ['voice', 'beep', 'both', 'none'];

/** Compact wire form (short keys keep links short). */
type WireInterval = { n: string; s: number; t: IntervalType; c?: string; cs?: CueMode; h?: 0 | 1; cd?: 0 | 1; ot?: number };
type WireBlock = { n?: string; r: number; rr?: number; i: WireInterval[] };
type Wire = { v: number; n: string; c?: string; o?: string; p?: { ps?: number; ec?: CueMode; rw?: number; vb?: 0 | 1 }; b: WireBlock[] };

export function toWire(def: TimerDef): Wire {
  const p: Wire['p'] = {};
  if (def.prefs.prepSeconds !== DEFAULT_PREFS.prepSeconds) p.ps = def.prefs.prepSeconds;
  if (def.prefs.endCue !== DEFAULT_PREFS.endCue) p.ec = def.prefs.endCue;
  if (def.prefs.repeatWhole !== DEFAULT_PREFS.repeatWhole) p.rw = def.prefs.repeatWhole;
  if (def.prefs.vibrate !== DEFAULT_PREFS.vibrate) p.vb = def.prefs.vibrate ? 1 : 0;
  const wire: Wire = {
    v: SHARE_VERSION,
    n: def.name,
    b: def.blocks.map((b) => {
      const wb: WireBlock = { r: b.rounds, i: b.intervals.map(wireInterval) };
      if (b.name) wb.n = b.name;
      if (b.restBetweenRoundsS) wb.rr = b.restBetweenRoundsS;
      return wb;
    }),
  };
  if (def.color) wire.c = def.color;
  if (def.notes) wire.o = def.notes;
  if (Object.keys(p).length) wire.p = p;
  return wire;
}

function wireInterval(iv: IntervalDef): WireInterval {
  const w: WireInterval = { n: iv.name, s: iv.seconds, t: iv.type };
  if (iv.color) w.c = iv.color;
  if (iv.cueStart !== 'both') w.cs = iv.cueStart;
  if (iv.halfwayCue) w.h = 1;
  if (!iv.countdownCue) w.cd = 0;
  if (iv.openTickS) w.ot = iv.openTickS;
  return w;
}

export type DecodeResult = { ok: true; def: TimerDef } | { ok: false; reason: 'format' | 'version' | 'invalid'; issues?: ValidationIssue[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const int = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isInteger(v) ? v : typeof v === 'string' && /^-?\d{1,9}$/.test(v) ? Number(v) : fallback);
const flag = (v: unknown, fallback: boolean): boolean => (v === 1 || v === true ? true : v === 0 || v === false ? false : fallback);
const oneOf = <T extends string>(v: unknown, values: readonly T[], fallback: T): T => (values.includes(v as T) ? (v as T) : fallback);

/** Strict reader of the wire form: wrong shapes become defaults or NaN-like sentinels that validation then rejects. */
export function fromWire(raw: unknown): DecodeResult {
  if (!isObj(raw)) return { ok: false, reason: 'format' };
  if (int(raw.v, 0) !== SHARE_VERSION) return { ok: false, reason: 'version' };
  if (!Array.isArray(raw.b)) return { ok: false, reason: 'format' };
  const p = isObj(raw.p) ? raw.p : {};
  const prefs: TimerPrefs = {
    prepSeconds: int(p.ps, DEFAULT_PREFS.prepSeconds),
    endCue: oneOf(p.ec, MODES, DEFAULT_PREFS.endCue),
    repeatWhole: int(p.rw, DEFAULT_PREFS.repeatWhole),
    vibrate: flag(p.vb, DEFAULT_PREFS.vibrate),
  };
  const def: TimerDef = {
    name: str(raw.n).trim().slice(0, 200),
    color: /^#[0-9a-fA-F]{6}$/.test(str(raw.c)) ? str(raw.c) : '',
    notes: str(raw.o).slice(0, 2000),
    prefs,
    blocks: raw.b.slice(0, 50).map((b): TimerDef['blocks'][number] => {
      const wb = isObj(b) ? b : {};
      const ivs = Array.isArray(wb.i) ? wb.i.slice(0, 50) : [];
      return {
        name: str(wb.n).slice(0, 200),
        rounds: int(wb.r, 1),
        restBetweenRoundsS: int(wb.rr, 0),
        intervals: ivs.map((x): IntervalDef => {
          const w = isObj(x) ? x : {};
          return {
            name: str(w.n).trim().slice(0, 200),
            seconds: int(w.s, 0),
            type: oneOf(w.t, TYPES, 'work'),
            color: /^#[0-9a-fA-F]{6}$/.test(str(w.c)) ? str(w.c) : '',
            cueStart: oneOf(w.cs, MODES, 'both'),
            halfwayCue: flag(w.h, false),
            countdownCue: flag(w.cd, true),
            openTickS: int(w.ot, 0),
          };
        }),
      };
    }),
  };
  const issues = validateTimer(def);
  if (issues.length) return { ok: false, reason: 'invalid', issues };
  return { ok: true, def };
}

/** `plainintervals://t?d=<base64url(compact JSON)>` */
export function encodeTimerLink(def: TimerDef): string {
  return `${SHARE_SCHEME}://${SHARE_HOST}?d=${encodeText(JSON.stringify(toWire(def)))}`;
}

/** Accepts any scheme (dev/preview variants use their own), host `t`, query `d`. Never throws. */
export function decodeTimerLink(url: string): DecodeResult {
  try {
    const m = /^[a-z][a-z0-9+.-]*:\/\/t(?:\/)?\?(.*)$/i.exec(url.trim());
    if (!m) return { ok: false, reason: 'format' };
    const params = new Map(m[1].split('&').map((kv) => kv.split('=') as [string, string | undefined]));
    const d = params.get('d');
    if (!d) return { ok: false, reason: 'format' };
    return fromWire(JSON.parse(decodeText(decodeURIComponent(d))));
  } catch {
    return { ok: false, reason: 'format' };
  }
}

/** The `.json` file: readable, with the full timer under `timer` in the same wire form. */
export function encodeTimerFile(def: TimerDef): string {
  return JSON.stringify({ format: FILE_FORMAT, version: SHARE_VERSION, timer: toWire(def) }, null, 2);
}

/** Reads a `.json` file (ours), a bare wire object, or a link pasted as text. Never throws. */
export function decodeTimerText(text: string): DecodeResult {
  const trimmed = text.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return decodeTimerLink(trimmed);
  try {
    const raw: unknown = JSON.parse(trimmed);
    if (isObj(raw) && raw.format === FILE_FORMAT) {
      if (int(raw.version, 0) !== SHARE_VERSION) return { ok: false, reason: 'version' };
      return fromWire(raw.timer);
    }
    return fromWire(raw);
  } catch {
    return { ok: false, reason: 'format' };
  }
}

/** The plain-words message next to the link (D19: "the message text carries the timer in words too"). */
export function describeTimer(def: TimerDef, formatDuration: (s: number) => string, plannedS: number): string {
  const parts = def.blocks.map((b) => {
    const ivs = b.intervals.map((iv) => `${iv.name} ${formatDuration(iv.seconds)}`).join(' / ');
    return b.rounds > 1 ? `${ivs} × ${b.rounds}` : ivs;
  });
  const repeat = def.prefs.repeatWhole > 1 ? ` × ${def.prefs.repeatWhole}` : '';
  return `${def.name}: ${parts.join(' · ')}${repeat} (${formatDuration(plannedS)})`;
}
