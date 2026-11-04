# Blind set B2 — interval timer ("Plain Intervals"), written 2026-10-16

Independent blind set for SPEC §12 A1 and the other engine families, per WORKFLOW L27 (blind-set protocol + the
2026-10-16 amendment: durable home on the SSD, hashes below). To be measured ONCE on the P4b engine snapshot
`b2b66c0` (docs/CURRENT.md); any fix afterwards turns B2 into a tuning set.

**Provenance.** Written by a separate agent that read only `docs/SPEC.md`, `docs/V1_PLAN.md`, `docs/DECISIONS.md`
(D1–D34), `docs/CURRENT.md` and `test/fixtures/timeline/FORMAT.md`. It never opened `src/` (engine, i18n, db), any
other file under `test/`, set B1 (`/Volumes/Zweite/claude/blind-sets/intervals-b1/`, `test/fixtures/timeline/blind-1/`)
or any engine output. Every expected value is computed by `oracle/b2_oracle.py` (Python 3 standard library, run with
`python3 -I -B`); no expected value was typed in by hand.

## Folder
| Path | What |
|---|---|
| `timers/tl-*.json`, `expected/tl-*.json` | 42 timeline cases in exactly the FORMAT.md shape (only documented keys) |
| `cases/<family>.json` | every family: list of `{id, family, adversarial, ambiguous, why, input…, expected}`; `cases/timeline.json` is the index of the timeline files (`timerFile`, `expectedFile`) |
| `oracle/b2_oracle.py` | the independent oracle (timeline, runner, recovery, catch-up, format, validation, stats, CSV guard, backup merge) |
| `oracle/b2_cases.py` | hand-written case INPUTS only |
| `oracle/build_set.py` | regenerates `timers/ expected/ cases/` byte-identically: `python3 -I -B oracle/build_set.py .` |
| `checker.py` | scores a results file (below); imports nothing from `oracle/` |
| `selftest.py` | reproducibility, hand-derived anchors, 40 planted errors, 6 tolerance controls |
| `share_tamper.py` | reference implementation of the share tamper operations |
| `oracle/__pycache__/*.pyc` | bytecode left by the author's first build runs (not part of the set; the deletion guard keeps it; harmless) |

## How to run (builder, P4c)
1. Commit the engine snapshot first (L27 (6)); copy this folder verbatim into the repo (e.g. `test/fixtures/timeline/blind-2/`) and check the hashes below.
2. Write an adapter that runs every case through the engine and writes ONE file `results.json`:
   `{ "<case id>": <actual output in the family's result shape below>, … }`. An engine exception →
   `{"error": "<message>"}` (share family: `{"threw": true, "error": "…"}`). Map only the keys documented here.
3. `python3 -I -B checker.py results.json` → per-family table (scored / ambiguous / adversarial), then one line per
   mismatch with the first difference. Exit code 0 = every non-ambiguous case matched. `--json` for machine output.
4. `python3 -I -B selftest.py` → must print `SELFTEST OK` (proves the checker catches errors and the oracle reproduces).
5. Save the checker output once (`docs/blind-2-first-run.txt`). That figure is the evidence.

## Common input shapes
**Timer** — the FORMAT.md `timer` object: `name, color, notes, blocks[{name, rounds, restBetweenRoundsS,
intervals[{name, seconds, type, color, cueStart, halfwayCue, countdownCue, openTickS}]}], prefs{prepSeconds, endCue,
repeatWhole, vibrate}`. Interval `color: ""` = the type's colour (D28). `type` ∈ prep|work|rest|cooldown|open;
`cueStart`/`endCue` ∈ voice|beep|both|none. **Settings** — `{"countdownFrom": 3|5|10}` only (everything else default).
Strings with emoji/surrogates are JSON `\u` escapes (all files are ASCII); a lone surrogate (`"\ud83d"`) must reach
the engine as a lone UTF-16 unit (plain `JSON.parse` does this).

**Session** (backup, CSV) — `{id, timerId|null, timerName, startedAt, endedAt (epoch ms), plannedS, actualS,
completed, skippedIntervals, pauses, note}`; the adapter sets `interrupted` = 0.

## Families: what to call, result shape, how it is compared
Segment indices everywhere = index into the segments of the CURRENT timeline (prep segment = 0 when present; after a
Next or +30 s the rebuilt timeline, whose indices continue unchanged).

| Family (ids) | Engine call (SPEC/D names) | Result shape | Compared |
|---|---|---|---|
| timeline (tl) | `buildTimeline(timer, prefs, settings)`, then `rebase` at each `nextAt` in order | FORMAT `expected` shape | exact: totalMs, every segment (startMs, endMs, type, label), every cue (atMs, kind, text) in order; `openTick` entries in the actual list are ignored (FORMAT: not listed) |
| format (fm) | `formatDuration(seconds)` in UI language `language` | string | exact |
| validation (va) | `validateTimer(timer)` | `{"valid": bool}` | `valid` only (error keys are i18n, not derivable) |
| clamp (cl) | `clampName(input)` | string | exact |
| runner (rn) | `s = idle(timeline)`; per step `s = apply(s, do, at)` then `view(s, at)`; `do: "view"` = read only | list of `{state, elapsedMs, totalMs, segmentIndex, remainingMs}` (one per step) | state, elapsedMs, totalMs always; segmentIndex, remainingMs only while running/paused; remainingMs null in an open segment; idle elapsed 0. `source` (screen/notification/headset) is informational: all go through `apply` (D33). `addTime` = +30 s |
| recovery (rc) | steps through `apply` with `at` = wall-clock ms, persisting the record after each step as the app does; then `evaluateRecovery(record, relaunchAt)` | object with exactly the expected keys (below) | every expected key |
| cuesBetween (cb) | `cuesBetween(buildTimeline(...), frm, to)` — window `(frm, to]` | list `{atMs, kind, text}`; ticks `kind "openTick"`, `text null` | exact, in order |
| nextCueAfter (nc) | next cue strictly after `after` (D29.7 `nextCueAfter`, ticks included) | `{atMs, kinds[]}` (kinds of every cue at that ms, same-ms order) or null | exact |
| backup (bk) | put `current` in a fresh DB with the given ids; make a backup file from the `backup` library (same ids); restore it with `mode` `keepBoth`/`replace` | `{"timers":[{id,name,color,notes,blocks,prefs}], "sessions":[{id,timerId,…session fields}]}` = the whole DB afterwards | see "Backup comparison" |
| csv (cv) | history CSV export of `sessions` | the CSV text | see "CSV comparison" |
| share (sc) | encoder/decoder of SPEC 5.5, op below | `{"ok":true,"timer":{…}}` / `{"ok":false}` / `{"threw":true,"error":…}` | `ok` → decoded timer equals input on name, color, blocks (all block and interval fields) and prefs prepSeconds/endCue/repeatWhole; `reject` → ok false, no throw; `no-throw` → anything but a throw |
| statsKeys (sk) | `dayKey / isoWeekKey / monthKey` of instant `atMs` with the process in time zone `tz` (IANA, e.g. `TZ=Pacific/Kiritimati`) | `{day, week, month}` | exact (`YYYY-MM-DD`, `YYYY-Www`, `YYYY-MM`) |
| statsTotals (sa) | buckets of `period` over `sessions` (bucketed by `startedAt`), process in `tz` | `{key: {count, actualS}}` | exact; buckets with count 0 ignored |
| streak (ss) | streak of `sessions` at `nowMs`, process in `tz` | integer | exact |
| templates (tp) | seed templates in English into an empty DB; the one whose name contains `keyword` (case-insensitive) | `{"totalMs": buildTimeline(it, its prefs, {countdownFrom:3}).totalMs}` | exact |
| templateRestore (tp-08) | seed; delete the templates matching `deleteKeywords`; append `renameSuffix` to the name of `renameKeyword`'s; set the first interval of the first block of `editKeyword`'s to `editFirstIntervalSeconds`; "Restore templates" | `{"timers":[{name, blocks}]}` | timer count, timers per keyword (substring of name), edited template survives |

**Recovery result keys.** `decision` ∈ resume|finished|partial. resume: `state` (running|paused), `elapsedMs`,
`segmentIndex`, `remainingMs`, `totalMs`, and for running also `nextCue` = `{atMs, kinds}` of the first cue strictly
after `elapsedMs` on the rebuilt timeline (missed cues are not replayed, SPEC §9). finished: `elapsedMs` (= total),
`totalMs`, `completed: true`, `interrupted: true`. partial: `completed: false`, `totalMs`, and `elapsedMs` when it was
paused. Cases die only while running or paused.

**Backup comparison** (id-agnostic where the engine may choose ids). Actual timers are paired one-to-one with the
expected timers by content (color, notes, blocks, prefs equal; name equal OR the expected name plus a suffix, e.g.
"Legs (2)" — a keep-both copy may be renamed). Every timer id that existed before the restore must still exist and carry
the expected content (keep both: unchanged; replace: the backup's). Sessions are paired one-to-one by content; each
must point to the timer the expected data says (or null). Session ids that existed before must keep their content.
Ids of newly inserted timers/sessions are NOT checked (an engine may keep or renumber them).

**CSV comparison.** RFC 4180: every record ends with CRLF (the last may omit it), CR/LF only inside quotes; parsed with
Python `csv` (strict); N data rows plus an optional header; the expected cell (guarded value of `check` field, i.e.
`timerName` or `note`) must appear in a distinct row each; no cell anywhere may start with `=`, `+` or `@`. Column
order, extra columns, quoting style and row order are free.

**Share ops** (`share_tamper.py` implements them; payload P = text after `d=` up to `&`/end, base64url without padding
→ UTF-8 → JSON): `none` decode the engine's link; `file` import the engine's `.json` file text for the timer (the
decoded payload if the file is the same JSON); `addKeyEverywhere` add `"zzUnknownB2": 0` to every JSON object;
`truncateHalf` P[:len/2]; `stringsTo41` every string value → 41 × "x"; `numbersTo6000` every number → 6000;
`repeatArrays25` every non-empty array → 25 copies of its first element; `deepNest` JSON wrapped in 5000 `[`…`]`;
`notJson` payload = "plain intervals"; `emptyD` nothing after `d=`; `badUtf8` bytes FF FE FD; `emptyObject` `{}`;
`encodeInvalid` encode the (invalid) case timer — an encoder that refuses or throws counts as `{"ok": false}`,
otherwise decode its link.

## Rules the oracle implements (SPEC §5 + D29–D34; FORMAT.md)
Segments, cues and same-ms order exactly as FORMAT.md "Rules" and D29/D32. Plus these readings, used in scored cases:
- R1 Natural end at elapsed ≥ total, i.e. AT the total the run is ended (D33 "view() reports ended at the total"); a
  paused run never ends by itself. Every action and read settles first, so End/Pause/Back/+30 s/Skip/Start/toggle after
  the total leave `ended` with elapsed = total.
- R2 `locate`: segment with start ≤ e < end, so an exact boundary belongs to the next segment (skip/back/view there).
- R3 Back: < 2000 ms into segment k > 0 → start of k−1; otherwise (and in segment 0) → start of k. Skip → start of
  k+1. +30 s → current segment end +30 s, later segments shift, halfway stays (D29.8). Next → closes the open segment
  at the current elapsed. Pause/resume accounting: paused time never counts.
- R4 Start only from idle; every other action on idle is a no-op (pause, resume, skip, back, addTime, next).
- R5 A timeline cut at an open interval lists the segments up to and including the open one, no later ones, no end cue.
- R6 Recovery (D29.10): running → wall-clock elapsed with replayed +30 s / Next / skip / back; ≥ total → finished;
  paused → resume paused unless paused for more than 24 h (then partial); running inside an open interval: partial when
  more than 2 h (cases are far from 2 h on both "since start" and "elapsed").
- R7 Catch-up (D29.9): cues of the segment current at `to` with frm < atMs ≤ to, only the latest same-ms batch, ticks
  included; openTick at start + j × openTickS (j ≥ 1) before the segment end, beeps only (text null).
- R8 Format (D30): input in whole seconds; `mm:ss` below 3600 (two-digit minutes), `h:mm:ss` from 3600 (hours unpadded,
  "10:00:00" past 9 h); Western digits for every UI language (SPEC 5.4 "Arabic Western digits").
- R9 Validation (SPEC 5.3, D31): seconds 1–5999, rounds 1–99, ≤ 20 blocks, ≤ 30 intervals per block, timer/block/
  interval names ≤ 40 code points without normalisation (lone surrogate = 1), total incl. prep, repeats and round
  rests ≤ 8 h. Ranges of prep/repeat/rest-between-rounds are not tested (not listed in 5.3).
- R10 Stats (D34): local calendar of the instant in `tz`; ISO year = year of the week's Thursday; sessions bucketed by
  `startedAt`; totals count every session; streak = consecutive local days with ≥ 1 session ending at `nowMs`'s day
  (cases have a session today, so "current" and "longest" agree).
- R11 Backup keep both: a backup item whose id is free is inserted; same id and same content (timers: name, color,
  notes, blocks, prefs; sessions: all fields except the timer link) → kept once; same id, different content → added as
  a copy and the backup's sessions follow the copy; existing timers and sessions are never rewritten or moved.
  Replace: the backup wins on an id clash; current items not in the backup stay (merge, SPEC 5.6).
- R12 CSV guard: a cell starting with `=`, `+`, `-` or `@` gets a leading apostrophe `'` (OWASP); RFC 4180 quoting.
- R13 Share: compared fields as in the table; notes and `vibrate` are not compared (SPEC §10 "only the timer
  definition"); SPEC §10's "(no names…)" is read as "no personal names" because A11 demands names round-trip.
- R14 Templates (SPEC §4 + D28): Tabata [Work 20, Rest 10] × 8; HIIT [30, 15] × 10; Walk/Run [60, 60] × 15; Stretch
  30 s × 10 with 5 s prep; default prep 10; "Restore templates" re-adds every template whose name is missing (a renamed
  one counts as missing; an edited one keeps its edit).

## Ambiguities (cases carrying them are scored separately, never in the headline number)
| Id | Question | My reading (oracle) | Cases |
|---|---|---|---|
| A1 | FORMAT says `text` is null for a cue with no voice part ("none in v1"); is a `beep`-only start cue's text the label or null? | label | tl-45 |
| A2 | Round cue when the round's first interval has start `none` | round cue still given | tl-27 |
| A3 | Zero-length open segment (Next before its start): order of two start cues at one ms | segment order | tl-21, tl-25 |
| A4 | Total exactly 8 h: SPEC 5.3 "≤ 8 h" vs SPEC §9 "≥ 8 h refused" | valid | va-24 |
| A5 | Empty names (label/voice text of an unnamed interval) | not tested | — |
| A6 | Skip/Back/+30 s while paused; Skip in the last segment | act and stay paused; skip in the last segment ends the run | rn-11, rn-16 |
| A7 | Catch-up window reaching the total | end cue only | cb-06 |
| A8 | End or headset toggle on idle | no-op | rn-22 |
| A9 | Next on a non-open segment | no-op | rn-24 |
| A10 | Paused exactly 24 h | resume (partial only after > 24 h) | rc-08 |
| A11 | Guard for leading TAB/CR; is the session note exported | guarded; note exported and guarded | cv-04, cv-06 |
| A12 | Keep both when a timer was deleted after the export (its sessions now have a null timer) | the session is the same session: kept once, not moved; the timer comes back without it | bk-11 |
| A13 | SPEC §10 "Share links carry … (no names…)" | names carried (R13) | (reading only) |
| A14 | Bucket a session crossing midnight by start or end | start | (no case crosses midnight) |
| A15 | Template structures: EMOM fixed 60 s or open (SPEC §4 says "open 60", D28 "60 s … halfway cue"); Boxing rest = interval or rest between rounds; Circuit one 12-interval block or block per station | EMOM 10 × 60 s fixed + halfway = 610 s; Boxing [180 halfway, 60] × 12 = 2890 s; Circuit one block [45, 15] × 6 stations × 3 rounds + 60 s between = 1210 s | tp-03, tp-06, tp-07 |

## Coverage (178 cases: 161 scored, 17 ambiguous; 136 adversarial)
| Family | Cases | Adversarial | Ambiguous | Emphasis |
|---|---|---|---|---|
| timeline | 42 | 30 | 4 | ≥ 40 timer definitions for A1: countdown 3/5/10 vs short intervals (strictly after start), halfway at odd seconds/5999 s and collisions with countdown, D32 typed-prep with its own flags, timer prep 1/2/60 s, round-rest 1/4/15 s, long circuit (3 blocks × 6 stations 45/15 × 3 rounds, 60 s between rounds), repeat whole 3/10, rounds 99, 20 × 30 maximum, open intervals (no Next, Next, Next before start, two opens, open per round, open across repeats, flags ignored), names in Japanese, Arabic, Hindi and German, ZWJ emoji, names that look like cue texts |
| runner | 24 | 19 | 4 | D33: actions after the natural end (pause/back/+30 s/skip/start/headset toggle/notification resume), pause exactly at and 1 ms before the total, double Start, End after the total, Back 1999/2000 ms and in prep, Skip on an exact boundary, +30 s with skip/pause accounting, headset toggles, notification pause/resume/end, idle no-ops, open interval Next and natural end |
| recovery | 13 | 12 | 1 | process death: wall-clock resume, finished at/after total and 1 ms before, earlier pause excluded, paused 23/24/25 h, replayed +30 s, replayed Skip/Back, replayed Next, open-ended 30 min vs 5 h, next cue not replayed |
| cuesBetween + nextCueAfter | 9 | 6 | 1 | no burst, (from, to] edges, openTick batches, end window |
| backup | 11 | 8 | 1 | keep both / replace on a fresh install with 7 templates on ids 1–7 (REVIEW M1), edits and deleted sessions after the export, clashing timer and session ids from another phone, copy ids colliding with later backup ids, rename-only edit, null timer, merge keeps extras |
| validation + clamp | 24 | 18 | 1 | D31 code points: 40/41 emoji, NFD vs NFC (no normalisation), ZWJ families (graphemes ≠ code points), flags, supplementary CJK, lone surrogate; seconds/rounds/blocks/intervals limits; 8 h total incl. prep and via repeats; clamp never splits a pair, may cut a ZWJ sequence |
| format | 11 | 9 | 0 | D30: 00:00, 00:59, 59:59 / 1:00:00 / 1:00:01, 1:39:59 / 1:40:00, 10:00:00, Arabic/Hindi/German digits |
| share | 17 | 15 | 0 | exact round trips (scripts, emoji, typed prep, open + tick, every start mode, prep 60, repeat 10, 20 × 30), unknown keys, truncation, over-limit strings/numbers/arrays, deep nesting, non-JSON, bad UTF-8, empty, invalid timers |
| csv | 5 | 5 | 2 | formula guard = + - @ (incl. inside quoted fields), apostrophe already present, RFC quoting of comma/quote/LF/CRLF/tab, emoji, Arabic, CRLF records |
| stats | 14 | 13 | 0 | D34 ISO weeks at year ends (2026-W53, 2025-W01 in Dec 2024, Monday 2026-12-28), UTC+14 / UTC−12 / Lord Howe, Samoa's skipped 2011-12-30, DST weeks; day totals over a 25 h day; week totals at UTC+14; month totals at UTC−12; streaks across both DST changes |
| templates | 8 | 1 | 3 | seeded totals, Restore templates after delete/rename/edit |

**Not covered (not derivable from the specification without reading the engine):** translated voice texts (the
i18n strings are in `src/i18n/`; only verbatim custom names are tested), validation error keys, settings defaults and
damaged-row fallbacks (no defaults in SPEC/D28 besides timer prefs), the cue scheduler's lead/EMA timing (D29.11, a
fake-clock harness matter), clipIds, pathLabel, vibration patterns, status line.

## SHA-256 of every other file (`shasum -a 256`, run in this folder)

```
cd7e05845c63c2139092f5ac8bae68b1c292222bfe2f12e062332f586300878b  ./cases/backup.json
90f7d9ce1aa50b4dedcca2a6c05448a39dd9cf8bbe44cf2535356f47ae654c17  ./cases/clamp.json
e4c59fa21a26c2ada6325d90968e089a2d0cb602539d177555672f41967a19d0  ./cases/csv.json
3c5a74d637d2639fee3b9816ea7b5e1690c1ba6ff82fd78d02ff79b7e561e582  ./cases/cuesBetween.json
bd8bfab32960ac9f86ab88aaf819f6731917568da9ca720bf1298a32a6590bad  ./cases/format.json
e57ec1c87ced9952bc8790a0b4b4a00378174990f484b20f924603ab132e7652  ./cases/nextCueAfter.json
422cb08783b4dac6c7b23ef65cec0b84ac9846574a4da0eb8069c5935db34414  ./cases/recovery.json
789fa6e47c69cb541b492c0c7238834047108c717ac7973ae3a187d6738cb227  ./cases/runner.json
896749479950e28f415e74452d94a0ca4520c51bf249cbd22553b24b0a9c0c13  ./cases/share.json
afe73e4a2d1a4ba7d1a7ee8b9a0588c1004f28b13150a54139c835115a81935e  ./cases/statsKeys.json
52434e82eaaacff83fb4645023fee838823f66a8f7e70be63af52dab6ec86989  ./cases/statsTotals.json
ab5a7a46047eee5621787fb0c7875347ade9f552273f961fbc99557a37208bc1  ./cases/streak.json
f892c6b7e9a842b45859f4549cd5b7b47fbb05f8f6c1af21266fa1a5e7f41584  ./cases/templateRestore.json
528852aa815ec670f3e5c1765507ab7501d95c505229de74959ad24cddeafc21  ./cases/templates.json
35b20648ca39e2b0129e5e69d31922d3020a6b70e63fe5b9aedf5f621cdcc018  ./cases/timeline.json
442dc7f09126812cd3e3743ceef33f05643edc338d7f3f136128e783324b4794  ./cases/validation.json
38de47d7053febaf75bf19780b6c9fb60e6524a09d2d34aac0d8aad3508d1d8a  ./checker.py
f0c9eae8882f38b0e8d28e848f4c7235498ee6c86666b2beea441660b69d43f0  ./expected/tl-01.json
7808b02edc91e3a1fd5e6c08df54079c376bc05692b0d6def04811541d25d8da  ./expected/tl-02.json
f9400e895546c190ea6caab2ad7d2fdfaa2752bf1fd57821e0603b5220507eae  ./expected/tl-03.json
e30406cd1f9bc415484ce01d5c1b732f6a6021e10c96225ecfcd68235facb146  ./expected/tl-04.json
4c829de71f959a28184b994e114458e9e269992c4a77330dd22abb27982aadb5  ./expected/tl-06.json
0b39aa527edab6ce04c0341325470e8732a18feaa0704953b8a739e66f1ca6e1  ./expected/tl-07.json
d551d8787b1f1804204ef9a202c0b284b4ed00a65db314b7cbbc9dbc67b94dec  ./expected/tl-08.json
dc265cee1512aa92b38c9512a4f6c948693fd011e1f58d472fe0dc249aa53c84  ./expected/tl-09.json
fe58ce64b98e0373c9865e794bbc900d54d3c51c57d170e81240a30b8449dc08  ./expected/tl-10.json
a00df5c5c1e5a5e6573a81a924765c0bdd083bb59da6ec1f2338ef29756c1c51  ./expected/tl-11.json
1324f0cace622e00243397d574c6ae676890b3af16a4d752dec52b6c132aaf69  ./expected/tl-12.json
8c7520c64bc6ed5a6a03956c91332e42a935c520515871b02a55d852ff1fb53c  ./expected/tl-13.json
a0c476ffc07f20d6df5a04329114c36773abe94c5d75af737f7ea5e1d4abc3e0  ./expected/tl-14.json
90982dee24d1cfbf34340ec171b6323f0a29643e60f293f059aa3928073c02b9  ./expected/tl-15.json
f14746890ffa1c2fd4944ac1d09e00ba6caab8f3e2618de16f061b05f3738a80  ./expected/tl-16.json
0b82a882f5447944ae5461e71d810b783fb9ddd158bc1558ca0940f7ed8628df  ./expected/tl-17.json
e6451d9e2ce8752227ec996c9df979baf786608c96e54bdfd16d726be7c30b44  ./expected/tl-18.json
ddce81031a47c80b42dea2d9ba3753e0b324a34b021224edb469ecdba4cebf78  ./expected/tl-19.json
ffcf691bfcbc40b45c745ca4fa7cf959639de72ae7b9d78a57c743694e8ef09e  ./expected/tl-20.json
e062974159a3509427ad27e63c732bc7f1021ba89618140d00332884c2889905  ./expected/tl-21.json
23df946a77f451792e7f88b02959f4cfd421d046de2181ecf7e7684cd50060ac  ./expected/tl-22.json
0398f250cae0b8ad523dc1f777c937b71b66c1221c8fdd762ede7b4ae018d185  ./expected/tl-23.json
6aac4593fadd5fd1c52555d6dbe4dbd94e5c52de42faa49a87a5aa6c15cb44c3  ./expected/tl-24.json
d11e55c391c9e51c76dbccaeef30d2fa84a2f3814f6c2308e5c18f41ec56dda4  ./expected/tl-25.json
4ba8e56573e33bba0683ef53413096bc0ebbb1e68c5223db24d3775a220c253a  ./expected/tl-26.json
38372d2e8b6803633913f28d7eed09a2febec8fc7926a04e652e6cc99a1a6e0b  ./expected/tl-27.json
637cb06c3503ab770c5e508cdc52678001103a36556d0aeefea99f7121afaea3  ./expected/tl-28.json
abef5838d83cf99808df34751e60d586698bd7564d425545952a4d78fbf2e3c3  ./expected/tl-29.json
c8e528edf047416bf037aee82c7e6d236ff09d6fdc78af65baf0de612964e9c4  ./expected/tl-30.json
2d0c85fa9ab75e826e3e86fcae0e2b490c0935b98593604b403683e8a84be318  ./expected/tl-31.json
9466b4f248cbaa406532fb7142e74411dcd446c10752c0d9538aec0863b80f2e  ./expected/tl-32.json
29c682d74197b79a4aa03ca4167215e79eb1e31b94fc970a8b0861f008868818  ./expected/tl-33.json
ed24765de3c219b51347db436c02e235df57decf49b0c43d22e05b3c25813ed1  ./expected/tl-34.json
d1fb813337fd3dd185190334ac28ff305d9adcf670e5e924e36184859430f368  ./expected/tl-36.json
e916ee6efd0c597fee11b6f9b270efb16da8d12a49d880f22d5249e12f6296ac  ./expected/tl-37.json
660e77a54103551c2b93eff0b660c0fce30e01e4245ae1fa6a80af8f32d73e6c  ./expected/tl-38.json
d5f0a9d5414e78bfd11d2b7ee851167b5f6cffa54a08bd7479e469c4ba21ff47  ./expected/tl-39.json
1170ce4ce147d225ad135e381e3e3e2dc1052e9caa9193580082aa17d3956d4e  ./expected/tl-40.json
84d7eb66ee823af55e3d89b839e283a7ef3d22a9ee556a66102c4c7a0f6250ea  ./expected/tl-41.json
57666940f7793d41d01bec265dc362a06b979c4472d7c7ca9e0c88da7ade010f  ./expected/tl-42.json
bd4014184b3258c76e55a23c242d2220657773bedebd91c01843562a93984849  ./expected/tl-44.json
308882af1bb5f64c10d300b7a60cc124361a70f08a60f1e783ec32d925ede91b  ./expected/tl-45.json
1958e9a3b008b136a052987048e97cdb004db4462869c546a839081609d53eeb  ./oracle/__pycache__/b2_cases.cpython-314.pyc
6e5e67a2b47bae75ba93124507bfcd85d2c0b21a128e5444900295842799541d  ./oracle/__pycache__/b2_oracle.cpython-314.pyc
6cf81651dc8f2f21f758acb1e0e3573160775f742aa9484d9b1e9999ed8d2ae1  ./oracle/b2_cases.py
96fc387e8bfad91a2b0ace35ba120092715ad0f76a5b6a8eb7027cc5fbd2fb8b  ./oracle/b2_oracle.py
3c3f99449368fd68b675aa62019134b778570c817236daa85512a3f4420ddcb2  ./oracle/build_set.py
65aed044935bcf3c8feff3f3da7f9e819d0ae522c323f56d54d0d5bf5b4e3a15  ./selftest.py
86a9f9c6d35c961f6917a29b606c20a6362f4669e203768d5264270ddad9fe07  ./share_tamper.py
e65fcbe0a17871e62a889a67c469ad99afdbd310a4d52027ea972296c9fce475  ./timers/tl-01.json
f219dc9aa30d0ff637a9238c6b7215b2dbfe2999c6530889abb079a01b28e010  ./timers/tl-02.json
d70714da346e563f84f0cbe063c700de77172001ee21f97e3e4eae9e93ae1d94  ./timers/tl-03.json
6725b046b00a4f817799044cb7d00bf7dae9e077096b2c3d4eee6fab87e42257  ./timers/tl-04.json
006e9d40db1236fc4e71e8a62a270f031d0b0fd9c58ee3cd989130d839c9dddf  ./timers/tl-06.json
f2bd3a4fd85308118b676471570b30acd0b038270ecd96ccc18f7042064be688  ./timers/tl-07.json
ba678be0b85c469f82a6e6597ef72e8113ffbd6cf58818267dfc1a42767b8d1a  ./timers/tl-08.json
48ecc713705b44b9b0b88be275ca03ce97dc498ea90e1d78969c5b5854de2587  ./timers/tl-09.json
fbe534799a9fca956b46b39acea1662c00f313a241a037b9ea293b1f0906063f  ./timers/tl-10.json
5041a1d0c8a83cef00cf1b789d1a47380c0c3c9a40f953220ccd6193cd7e9986  ./timers/tl-11.json
bd5d59c9b42a6c0c96d546c9c4f3f52598d00cf74dddd2a214481caa5aa6363b  ./timers/tl-12.json
d104d9c2ff5ecca78e57781f73f54566b8cd8a742876c88a4b4ad2de84474790  ./timers/tl-13.json
f3d1b4fc34a1d9fd5c02a8bc1bd1a819e7521b3972391ba8372a4c822b4f7910  ./timers/tl-14.json
959da7f057973030d9664ab0673e38d6b87292349db7a12aeb5cbe2ee88e4744  ./timers/tl-15.json
0f0aec8788a917f8b2439066d7ee2b01e897992b9a0c55e07dabe7b9991668cb  ./timers/tl-16.json
db12698ea2c151d9c7a13ef88109f6a8136d88585701a0d623f63d05df6e4a45  ./timers/tl-17.json
2376ed3d13cd9c53ff65ebaf0778f4a5cbc17836574c0025902dd9677ecdb456  ./timers/tl-18.json
d48d312cd93634352d188cfd36e6322a2cf3fa1a89e0504df32cdf568b09a7a9  ./timers/tl-19.json
c8a24390549e6bf34834b2ee4fd05396302e2a79e14439e76f23f46aad4bde14  ./timers/tl-20.json
3176db2a5d8589cfadda05a51b8ca2c6b499409726ad50d9e8790a69145352c0  ./timers/tl-21.json
95e99efc289245a692a9336ea73bc5b00c2adeacc818be9f156bc2a2320fb373  ./timers/tl-22.json
8fc134e996fe371054cb5e90aabfa411a82efe224ef2b171b5bc68bea64ee01a  ./timers/tl-23.json
57a1ba298bad0731f5461910b184e1c3a08e7a91e9735ed1cb9f411b7d25a0b3  ./timers/tl-24.json
f1cb2d4216f927b05b5abd6eb612e13cb0a5187b988968df212b2e90041a3bc9  ./timers/tl-25.json
9a26a28c6636fd0be3dd84ea1660d667c3f91f9a2170e34184b1ed771df98f21  ./timers/tl-26.json
bd4c271826acd7119afffe97b3c779318ed80012ca28d43a407ca9d03b65fceb  ./timers/tl-27.json
b25c49dfed4628b83e1a8d87a41ae4596aeccf7c47da7d83bb2cea51996b6c2d  ./timers/tl-28.json
d7e68221494a1feac270b0defd68a192db299bbe92507f26d2b89e75ef9c3d04  ./timers/tl-29.json
d08911559616df2e08af9f939356c30383063bb43435b6770ee87353aa012cbc  ./timers/tl-30.json
5a611ee23f7b3693509f9ebe380e86b99f8ce2981acdab01917d085c8881d000  ./timers/tl-31.json
caca0ee9332b3339321e5d443e048c916cd903ae029ca30cabfe13d55a8a9fd3  ./timers/tl-32.json
7c806ebb938f8cae3d7da253f1a938d159fe27b534dd03552d8822af776e7739  ./timers/tl-33.json
8bcd4b2684570dd8a27af772a2ef5283ec6a55dc547b03714312806f8f43806a  ./timers/tl-34.json
e27236b7cc4a7ff9ecc079cebd57ddfc96f73b80cb694f6a042e0e76751e5887  ./timers/tl-36.json
f248cf8f8c48f53f6989e13ceb0fde57dd421e31384f93292bf31257fd5da722  ./timers/tl-37.json
9092ad96bcebde8deeee8b6bb1f595098f2ee9cae99627eca60814cae9859bf4  ./timers/tl-38.json
daab74c2837a9bdb94d1e33b4153d9453c9376fe21e7e686a10398a900ee2ba8  ./timers/tl-39.json
a4ccafdfeda009f4eac8930ed84980d527946b6af55c0f13c3669ec94862d4b8  ./timers/tl-40.json
6201364c82a16f1ae1544c514f97c9a4420ced5e67e885cd696b938dbf0a8bcc  ./timers/tl-41.json
76c75ace83c2cbbb440629dc772126de7f86c07b695c6fa9255859a2b99a94d0  ./timers/tl-42.json
37c051e5004e3b7a5ad0f3ec277fe84fbc14adcac0511cc8a4bb82f4d5af35f9  ./timers/tl-44.json
b637a5d54fb0de624e9f54f3bd9bcc6f91c849834d1209cc047fd98a43631cbb  ./timers/tl-45.json
```

Digest of the list above (the hash lines piped through `shasum -a 256`): `ba13275374b8158dfc076717ce5b7bf8141cf59c79b132ab2c6d92965db233e4`

Re-check: `cd /Volumes/Zweite/claude/blind-sets/intervals-b2 && sed -n '/^[0-9a-f]\{64\}  /p' README.md | shasum -a 256 -c`
