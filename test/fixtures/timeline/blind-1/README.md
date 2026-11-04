# intervals-b1 — blind set B1 for the interval timer ("Plain Intervals")

Frozen 2026-10-16 by the separate P3a blind-set agent (WORKFLOW L27 rules 5–7 and the L27 amendment: durable home
on the external SSD, hashes below). **150 cases: 133 non-ambiguous (the headline), 17 ambiguous (scored separately),
84 adversarial.** 40 timeline cases are timer definitions in the FORMAT.md shape (SPEC A1/O1 asks for >= 40).

**Sources read:** `interval-timer/docs/SPEC.md`, `docs/V1_PLAN.md`, `docs/DECISIONS.md` (incl. D27–D29; D29 is
treated as part of the spec), `test/fixtures/timeline/FORMAT.md`, `~/Developer/WORKFLOW.md` (L27 + amendment).
**Never opened:** anything under `interval-timer/src/` and every other file under `interval-timer/test/`.
An earlier blind-set agent (cut off by a usage limit) had left `tools/oracle.py` and `tools/cases.py` here. Both were
read, checked against the SPEC and then **overwritten** with this author's own code; nothing of the draft is used.
Every expected value is produced by `tools/oracle.py` (Python 3 standard library, `python3 -I`); none is typed by hand.

## Folder
| Path | Content |
|---|---|
| `timers/<id>.json`, `expected/<id>.json` | 40 timeline cases, exactly the FORMAT.md shape (what `npm run blind <folder>` reads) |
| `cases/<id>.json`, `answers/<id>.json` | 110 cases of the 9 other families: `{id, family, title, adversarial, ambiguous, readings, readingsNoted, input}`; answers = expected output |
| `index.json` | every case: family, title, flags, readings, input and expected path |
| `tools/oracle.py` | the independent oracle (all rules, with the reading ids below) |
| `tools/cases.py` | case INPUTS only |
| `tools/generate.py` | writes the set from cases + oracle (`python3 -I tools/generate.py <folder>` regenerates byte-identical files) |
| `tools/check.py` | scores an engine dump |
| `tools/selftest.py` | oracle sanity values, reference dump, tolerated variations, planted errors |
| `tools/__pycache__/` | Python bytecode written when the tools run; not part of the set, not hashed (varies by Python version) |
| `excluded-drafts/` | 40 files this agent generated before trimming 165 → 150 cases. **Not part of the set**, not in `index.json`, not read by the checker or by a `timers/`-reading scorer. Removing them was refused by the guard hook (owner's deletion rule), so they were moved here; the owner may delete them. |

## Run
```
python3 -I tools/selftest.py .                     # expect: 150/150, 5/5 variations, 62/62 planted errors, SELF-TEST PASSED
python3 -I tools/check.py . dump.json              # score an engine dump; --json report.json, --all-mismatches
python3 -I tools/generate.py <empty folder>        # optional: reproduce every file (diff = proof)
```
`check.py` prints a table per family (non-ambiguous / ambiguous / adversarial / n/a), the **A1 line** (timeline,
non-ambiguous) and every non-passing case with its first mismatches. Exit 0 = every non-ambiguous case passes.

## Protocol for the builder (P3b, L27)
1. Commit the engine snapshot first. 2. Copy this folder verbatim; check the hashes below. 3. Write a harness that
calls the engine for every case in `index.json` and writes `dump.json` (interface below), mapping only the keys
documented here. 4. Run `check.py` **once** with the engine untouched; that output is the evidence. Never change an
expected value; a disagreement about a reading is settled by a D-entry and a fresh set (B2) by another agent.

## Input schemas (the documented keys)
**Timer** = FORMAT.md: `{name, color, notes, blocks:[{name, rounds, restBetweenRoundsS, intervals:[{name, seconds,
type, color, cueStart, halfwayCue, countdownCue, openTickS}]}], prefs:{prepSeconds, endCue, repeatWhole, vibrate}}`.
**Settings** = `{countdownFrom: 3|5|10}`. **Session** = `{timerName, startedAt, endedAt (epoch ms), plannedS (int or
null), actualS, completed (bool), skippedIntervals, pauses, note}` (= SPEC §4 `sessions` columns).

| Family | `input` |
|---|---|
| timeline | `{timer, settings, nextAt?}` — FORMAT.md (`nextAt`: elapsed ms of the user's Next in each open interval, in order) |
| cuesBetween | `{timer, settings, windows: [[fromMs, toMs], ...]}` — `cuesBetween(buildTimeline(timer, settings), from, to)` per window |
| runner | `{timer, settings, script: [{t, op}]}` — `t` = monotonic ms passed as `now`; `op` ∈ `start pause resume skip back addTime end next probe`. `addTime` = +30 s; `next` = the user's Next on an open interval (SPEC 5.1 rebase at the current elapsed); `probe` = no transition, read the state at `t`. One runner per case, steps in order. |
| recovery | `{timer, settings, record: {state, startedAtWallMs, savedAtWallMs, elapsedMs, baseWallMs (running only: wall time at elapsed 0), events: [{op: next\|addTime, atElapsedMs}]}, nowWallMs}` — D13/D29.10; map onto the engine's recovery record and call `evaluateRecovery(record, now)` |
| validation | `{timer}` (deliberately invalid values inside) |
| format | `{op: "duration", seconds, lang}` · `{op: "blockTotal", block}` · `{op: "timerTotal", timer}` |
| share | `{op: "roundtrip", timer, compareNotes?}` · `{op: "unknownField", timer}` · `{op: "tamper", timer, find, replace}` · `{op: "import", links: [...]}` |
| stats | `{zone (IANA), nowMs, sessions}` — evaluate in that zone (e.g. `TZ=<zone>` for that call, or the engine's zone parameter) |
| csv | `{sessions}` — history CSV export of exactly these sessions |
| backup | `{initial: {timers, sessions}, mutations?: [...], mode: "replace"\|"keepBoth", fresh?, settings?, hostile?}` (procedure below) |

## Dump interface
`dump.json = {"engine": "<free text, e.g. commit hash>", "results": {"<case id>": <output>}}`. Integers as JSON
integers, booleans as `true/false` (map 0/1 columns), `null` where stated, strings byte-exact (no Unicode
normalisation, no trimming). Extra keys anywhere are ignored.

| Family | Output | Compared |
|---|---|---|
| timeline | `{totalMs, segments: [{startMs, endMs, type, label}], cues: [{atMs, kind, text}]}` (FORMAT.md) | everything, exact order and length |
| cuesBetween | `{windows: [[{atMs, kind, text}], ...]}` | every window, exact order |
| runner | `{steps: [{state, elapsedMs, segmentIndex, remainingMs, totalMs}], timeline: <timeline after the script>}` | per step: `state, elapsedMs, totalMs`; `segmentIndex, remainingMs` only while running/paused (`remainingMs` null in an open interval); `timeline` only for scripts with `addTime`/`next` (or skip on an open interval) |
| recovery | `{decision: resume\|finished\|partial\|none, elapsedMs, segmentIndex, completed}` | `decision`; resume: `elapsedMs, segmentIndex`; finished: `elapsedMs` (= total), `completed: true`; partial: `completed: false`; none (ended/idle record): nothing else |
| validation | `{valid, rules: [...]}` with rule ids `seconds rounds blocks intervals name total` (map the engine's i18n error keys onto these) | `valid`; `rules` as a set |
| format | duration `{text}`; blockTotal `{seconds, text}`; timerTotal `{totalMs, text}` | all listed keys |
| share roundtrip | `{link, linkTimer, fileTimer}` = the share link, `decode(link)`, and the timer read back from the `.json` share file | link starts with `plainintervals://t?d=`, payload (up to `&`/`#`) is base64url (RFC 4648 §5, padding tolerated) of UTF-8 JSON; both timers equal the input on `name, color, blocks (all keys), prefs (all keys)` (+ `notes` when `compareNotes`) |
| share unknownField | `{ok, timer}`: encode → base64url-decode the payload → JSON-parse → add top-level key `"zz_b1_unknown": {"a": [1, 2, 3]}` (if the payload is an object) → re-encode → import | `ok: true`, timer as above |
| share tamper | `{ok, markerCount}`: encode → decode payload to JSON text → count `find` → replace it with `replace` → re-encode → import | `ok` (all `false`); `markerCount ≠ 1` → case is **n/a** (encoding hides the marker), reported, not scored |
| share import | `{ok: [bool per link]}`, importing each link; must never throw | every entry `false` |
| stats | `{sessions, completedSessions, actualS, plannedS, perDay, perWeek, perMonth, streakCurrent, streakLongest, mostUsed, topTimer}`; per* = `{"<key>": {sessions, actualS}}` with keys `YYYY-MM-DD`, ISO `YYYY-Www`, `YYYY-MM`; `mostUsed` = `{timerName: count}` | all keys; the four maps must have no extra keys |
| csv | `{csv: "<file text>"}` | parses with Python `csv` (strict); every record ends in CRLF (last may end at EOF); all rows same width; data rows = sessions (+ at most one header); for every session a distinct row holds its timerName cell and note cell: verbatim, or — when the value starts with `= + - @ TAB CR` — the value with exactly one leading guard character that is not itself one of those; column order and row order free |
| backup | `{ok, timers: [timer], sessions: [session], settings?}` = all rows in the database after the restore attempt | see procedure |

**Backup procedure** (works with any id scheme): fresh empty database (migrations applied, **no template seeding**) →
create `initial.timers` and `initial.sessions` in order (remember the engine ids by position) → export a backup →
apply `mutations` in order (`editTimer {ref, timer}`, `deleteTimer {ref}`, `addTimer {timer}`, `addSession {session}`,
`deleteSession {ref}`; `ref` = position in `initial`) → if `fresh`: open another empty database → restore the backup
with `mode` → dump. `hostile`: restore `{"kind": "truncate-half"}` = the first `floor(len/2)` characters of the
exported text, or `{"kind": "raw", "text": ...}` instead of the backup. `settings` (bk-02): write those settings keys
(SPEC §4 names) before the export, dump the same keys after the restore. Compared: replace → `ok`, timers and
sessions as multisets (ids ignored); keepBoth → `ok`, timer count, the multiset of timer definitions without names,
the listed names present (the restored copy's name is free), sessions as a multiset; hostile → `ok: false` and the
database unchanged.

## Coverage
| Family | Cases | Adv. | Amb. | Covered |
|---|---|---|---|---|
| timeline | 40 | 25 | 1 | templates (Tabata, HIIT, EMOM, Boxing, Circuit, Stretch), prep 0/1/3/60, repeat 2/3/10, 1–3 blocks, 20 blocks, 30 intervals, 99 rounds, 5999 s, exactly 8 h, round-rest only between rounds (never on 1-round blocks or between repeats), open intervals (Next, no Next, Next before/at start, two opens, open first/last in a round, open + repeat), countdown 3/5/10 incl. 1–3 s and 10 s segments, halfway threshold and whole-ms halves, halfway/countdown collisions, cue modes incl. none, end cue none, typed prep interval, openTick never listed, Unicode/NFD/emoji/quotes, 40-character names |
| cuesBetween | 7 | 4 | 1 | exclusive/inclusive bounds, latest same-ms batch only, long gaps (no burst), window ending on a boundary, end window, open timeline, halfway+countdown batch, round+start batch |
| runner | 19 | 7 | 5 | pause/resume accounting, odd ms, back < 2 s / = 2000 / 1999 ms, +30 s (single, double at one ms, on round-rest, then back), boundary pause, end early / while paused, double start/pause/resume, everything after end, double skip at one ms, skip while paused, skip to the end, run reaching the total, open interval + Next, +30 s/skip on open, back into a closed open interval; timeline after +30 s (countdown moves, halfway stays) |
| recovery | 14 | 7 | 2 | running mid-session (wall-clock elapsed), past the end, exactly at the end, paused 10 min / 25 h / exactly 24 h, ended record, clock set backwards, DST spring-forward (Berlin) and fall-back (New York), replayed +30 s, open-ended run resumed / stale > 2 h, replayed Nexts then finished |
| validation | 20 | 11 | 3 | seconds 0/1/5999/6000/2.5, rounds 0/100, blocks 20/21, intervals 30 (x2 blocks)/31, names 41 (block, Japanese), 40 emoji, NFD, total exactly 8 h incl. prep, 8 h + 1 s, prep / repeat / round-rest pushing over 8 h |
| format | 12 | 5 | 0 | 0, 59, 599, 3600, 5999, 28800 s, Arabic/Hindi/German digits, block totals (round-rest, 1-round block), timer totals with prep, repeats, round-rests |
| share | 11 | 8 | 1 | round trips (Tabata, Unicode inside base64url, every enum and non-default prefs, 20 blocks x 40-char names, notes), unknown field ignored, tampered seconds/name/rounds/total refused, 10 hostile links (empty, bad alphabet, non-JSON, array, null, `{}`, `__proto__`, 200 kB, 5000-deep nesting, truncated JSON) |
| stats | 13 | 8 | 5 | per day/week/month, totals, planned vs actual (null planned), most used, current/longest streak, DST 23 h and 25 h days, Lord Howe 30-min DST, ISO week 53 and ISO-year edges, UTC+14, UTC−11, UTC+5:45, gap streaks, yesterday-only streak, midnight-crossing session |
| csv | 6 | 4 | 0 | plain, formula guard `= + - @ TAB CR`, quoting of commas/quotes/CRLF/LF/CR, Unicode/NFD/RTL mark, guard + quoting together, no false guard |
| backup | 8 | 5 | 2 | U10 fresh-install round trip, settings, replace (edit reverted, deleted re-added, later additions kept), keep both (changed timers twice), keep both with an unchanged timer, truncated / non-JSON / null backups refused with the database unchanged |
| **total** | **150** | **84** | **17** | |

## SPEC ambiguities and the reading chosen
The oracle computes the alternative wherever that is cheap; a case is **ambiguous** only when the alternative
would change its expected value (`readings` in `index.json`). Ids marked "no case" are documented readings the set
avoids by design.

| Id | Where SPEC/D29 is silent | Reading chosen | Alternative | Cases |
|---|---|---|---|---|
| T1 | same-ms cues of different segments (only zero-length open segments) | segment order, then the D29.8 kind order | kind order across segments | computed for all; no case differs |
| T2 | an interval whose *type* is `prep` inside a block | treated like the prep segment (always countdown, never halfway): D29.3 "not for prep", FORMAT "always prep" | follow its own flags | tl-40 |
| C1 | `cuesBetween` window reaching the total | no segment is current at/after the total → only the end cue | also the last segment's latest batch | cb-04 |
| R2 | elapsed passes the total without `end()` | state `ended`, elapsed = total | stays `running` | rn-15 |
| R3 | skip on the last segment | ends the run at the total | no-op | rn-14 |
| R4 | skip/back/+30 s while paused | applied, stays paused | resume / refuse | rn-13 |
| R5 | skip on an open interval | acts as Next | no-op | rn-17 |
| R6 | +30 s on an open interval | no-op | — | rn-17 |
| R8 | back < 2 s after Next into the open interval | returns to its start; it stays closed at the Next time | reopen it | rn-18 |
| REC1 | wall clock set backwards after the save | resume at the recorded elapsed (never earlier) | negative/clamped-to-0 elapsed | rc-08 |
| REC2 | "after 24 h" / "older than 2 h" at exactly the limit | strictly more than the limit | inclusive | rc-06 |
| REC3, REC4 | paused + open-ended beyond 2 h; "older" measured since the save or since the start | 24 h paused rule wins; since the save | — | no case (cases agree under both) |
| V1 | "names ≤ 40 chars" | Unicode code points | UTF-16 units (JS `length`) / grapheme clusters | va-19, va-21 |
| V4 | non-integer seconds | invalid (`seconds`) | rounded | va-22 |
| V2, V3, V5 | 0 blocks/intervals; SS4 ranges prep/repeat/rest as validation rules; several errors at once | invalid; yes; all rules reported | — | no case (trimmed) |
| SH1 | do `notes` travel in a share link (§10 "no names, no history")? | yes (A11: names round-trip; "no names" read as no personal data) | notes dropped | sh-05; other share cases do not compare notes |
| S1 | day of a session crossing midnight | local date of its start | date of its end | st-13 |
| S2 | current streak when today has no session yet | counts on from yesterday | 0 | st-12 |
| S3 | do ended-early sessions count for a streak? | yes, every saved session | completed only | st-13 |
| BK1 | keep both with a timer unchanged since the backup | duplicated anyway | skipped as identical | bk-05 |
| BK2 | same session id on both sides under keep both | both kept | deduplicated | no case |
| BK3 | settings on a fresh-install restore | restored from the backup | defaults kept | bk-02 |

**Literal readings NOT flagged** (the reviewer may disagree; each is the plain reading of the cited text):
`mm:ss` = two-digit minutes (`00:00`, `09:59`), `h:mm:ss` from 3600 s with unpadded hours, Western digits in every
language (SPEC 5.4; Arabic explicit, hi/de default to Latin digits in CLDR). Displayed timer totals include prep,
repeats and round-rests (A15: equal `buildTimeline().totalMs`); block total = rounds × Σ seconds + (rounds − 1) ×
rest. The 8 h limit applies to that total; exactly 8 h is valid. `locate` is half-open (a boundary belongs to the
next segment: its start cue plays there). Runner: transitions that are not valid in the current state are no-ops
(R7: start while running, pause while paused, resume while running, everything except probe after end, next outside
an open interval); two skips at the same ms move two segments (the pure machine has no debounce); +30 s is permanent
(back restarts the extended segment); end while paused keeps the paused elapsed; idle elapsed is 0. Recovery runs on
epoch ms, so DST never changes an elapsed time. Stats count every session (A10), weeks are ISO-8601. CSV guard =
one neutral leading character, nothing else altered, no guard on values that do not start with a formula character.
Backup restore merges by id (replace: the backup wins for its ids; ids only in the database stay).

## Not covered
openTick cues (D29.7: runtime only), clip ids (engine-internal hashes), voice texts in the 14 other languages, the
"per-timer best completion" stat (SPEC gives no definition), the status-line selector, palette contrast, future codec
versions (the payload format is the engine's own), the drift harness (A2 needs fake timers), CSV columns other than
timer name and note (their names and formats are the engine's).

## SHA-256 of every other file in this folder

Aggregate: SHA-256 of the list below (the lines exactly as printed, LF-terminated) = `ba930a7cecdcd6b43e14ca112f7929418c4a9fc32637f5a06aacbe60382234d6`;
of the same list without the `excluded-drafts/` lines = `55ea4a1764b13f0eb94032235d4b11d8eb6de78400729fc77441a53ddb42fee3`.
Verify: `cd <folder> && shasum -a 256 -c <(sed -n '/^```hashes/,/^```$/p' README.md | sed '1d;$d')`.

```hashes
5e420da577a40abeb76ebf6acc440c5fbdb4b0302ee647f3636312bd108ec4c1  answers/bk-01-fresh-roundtrip.json
d4307ae6ed0f162ebb0708f861c5bc9bb89ea50486a04785092ce75e607aa61a  answers/bk-02-fresh-settings.json
4ac484c65da0d9e6895649c1dcbb993bae29fef335342844488bc0cf2d2e106d  answers/bk-03-replace.json
4163b1aca770c9c86f4f0974e14d91d7fe65c5c498ccb0df8c595614f04b6aae  answers/bk-04-keep-both.json
3f2b692343003aea1869d631500b835c4ac44c9462ef87b0c26a01eef066f5a3  answers/bk-05-keep-both-unchanged.json
91e2fe1d243b47c775b45ba5c29c88a6745ef4f21290e4ef11128dba0fce5aa4  answers/bk-06-truncated.json
f842b6da6aff5d8a888430481bcfa8fde022199a130ab31d80d85ba0b08502f8  answers/bk-07-not-json.json
3474ab383c0753a959c3848de68d86402c81c521ed88441b661aca6ebefc754b  answers/bk-08-null.json
986d5df126c9ba618650f4ac53acef66454099203d0835db5c3a7f90d8b55076  answers/cb-01-basic-windows.json
62498b0824ee5addb0c7400482db84ec6222cf9446f7a234d0061b7b32e958fb  answers/cb-02-long-gap.json
f34939127f408c1d23acc0303892b16c7b7b48b80ccd045c48ee5c6024bca0c3  answers/cb-03-boundary.json
bdc4859547de8ac5595454ff9b7373016f7d68767cff04efdd58dccccd23a915  answers/cb-04-into-end.json
95edc3a527890b1e71e0593753dc63791566821e9308ad17f810432e20856034  answers/cb-05-open.json
4cf2c2cbf73e537d4058cc0cad7bedb61e029b56afbee826d3db37068924226e  answers/cb-06-halfway-batch.json
5a37c93e33eb6467a00cb992087806ecebc3ba978741ee8543248d9c3bf63061  answers/cb-07-round-batch.json
3f5930774a754a21d1929216cc15e5e0681586245cddb69b5320e68354ded997  answers/cv-01-plain.json
6510edfd287dd8833660d88f7180c3bd9713fe0fb2b3a2b55336c914698f6068  answers/cv-02-guard.json
d0fb1d51ce227aea8e0855f7992515e4feb9de4bad431dd47ac593e27eb66b10  answers/cv-03-quoting.json
393aba136761c4aba7e1d37f535d46caaafe87bee9b0d8f93808673f20d3707b  answers/cv-04-unicode.json
ddc5d73ebb2ecc3936c3242ff01b12407afa6800f1bce1512608bce640c6a54a  answers/cv-05-guard-and-quote.json
a0d4ca82dbee48c6664f3d9ffc119adf2c5badfda96abf6e33105bb1f77fe164  answers/cv-06-no-false-guard.json
e637c0fcb6119399c9df4c4d1a9980e66773355299de282309198904ace74233  answers/fm-01-duration-0-en.json
b5ba32d314ac6e196588027bbcf575304a2e4d93fb59ff68b4a2f1d658c04ebb  answers/fm-02-duration-59-en.json
dea5ab8a199e9079eed9c829459c6f23ac24085a16fe100616f66c62131bb0aa  answers/fm-03-duration-599-en.json
75e5ac90f24be325f5b48df0f412ac83df2efb41b0281468fe58c0d7de77d1cc  answers/fm-04-duration-3600-en.json
f4a80e39911851aa522910d2bea6f91a042bff93407b80a5e175258d24e4d57c  answers/fm-05-duration-5999-en.json
46da7faaea21b97727323c5ec060ab1b45fb6ecef0d946a7d650ec809e91ce34  answers/fm-06-duration-28800-de.json
639c360f796db7606f0872357b144c382d27fc8cc12674dfc425dc09de2a6eea  answers/fm-07-duration-754-ar.json
9040093ab76054f9fd89c98a5967469e9f4d943e34e47a97cc2728e84a56a5a3  answers/fm-08-duration-3725-hi.json
681053dda6f9eecda99bed75dfa42dac03ab053ef6554c5c95c1755c5718cc6f  answers/fm-11-block-circuit.json
519ac92799137d33e1e022d87b75d8b4099b3bfbea3c9129dda3598feca43b6a  answers/fm-12-block-one-round-rest.json
732ff68bc6ca493e3f9fdb4397ea50013d27253817cda7a9542e363b43e3723a  answers/fm-13-timer-tabata.json
27d96fa510cc2d8fc42e8f7a8357c4901fd6110ec4b31d2a6e6ba4795a0016ba  answers/fm-14-timer-repeat.json
3a32c254b334bcfb8efc7d66b15a4d4138d4581e0d6add5e5905fb3e66423986  answers/rc-01-running-mid.json
719b18560e76f6b3b0f23786b2136849d6c959f9b729716cc2e2c9645a2b4d04  answers/rc-02-running-past-end.json
719b18560e76f6b3b0f23786b2136849d6c959f9b729716cc2e2c9645a2b4d04  answers/rc-03-running-exact-end.json
e90ceba5fe6ddfcfca6ee47afd6285b0c648ae9311a7cccf2670868352483a1b  answers/rc-04-paused-10min.json
8c03cb3d19af2ffdfa009788a49e22b19286d410f573d751c5f8b801f4ba0aba  answers/rc-05-paused-25h.json
e90ceba5fe6ddfcfca6ee47afd6285b0c648ae9311a7cccf2670868352483a1b  answers/rc-06-paused-24h-exact.json
845db1edc59ebf38c2989cf5dd7442a2ad6e296504000f8115a1e95af281f5af  answers/rc-07-ended.json
4e12d081758d8c0c1897a65bb8fc4d0aa6cdf746e81822706d8b97bd77d32e6b  answers/rc-08-clock-back.json
97edf03115b98b08a3d4dedb62ae885a26af550ff60cf7c42b4f43f724ff2101  answers/rc-09-dst-spring.json
084bdabe636628493c085ebdb04a85e1347e8653465aaf5f9740b736eab07129  answers/rc-10-dst-fall.json
f4833263311d3111ce2088ffe5f52666b071fe4dce2efcf52b0e9808ac229912  answers/rc-11-replay-add.json
0f97a62a4b1bb61482ae368bed34cd5e3952496588daf678836de7219b617f8d  answers/rc-12-open-resume.json
8c03cb3d19af2ffdfa009788a49e22b19286d410f573d751c5f8b801f4ba0aba  answers/rc-13-open-stale.json
d611b374f27394f8555bdf2cf8ddcc5487bd0de54aa3022beaf581b94b47e7e7  answers/rc-14-open-closed-finished.json
d11ed06522d39ba373eceb5d33def7c04959ca53ffb005493ddedea7329c1138  answers/rn-01-basic.json
40aa5692987965142e253492ef886d1cc53b48f54b772063b24a28cbcb99aa4e  answers/rn-02-pause-accounting.json
9345a71d1fda12f3f96869eea4f6fc134a37c468b4adeed877508f3153c77cec  answers/rn-04-back-rule.json
ee1920a65eec4334940d821a8730b541674ce2888650c15701bf45b33e025865  answers/rn-05-back-2000-exact.json
f210d9b4082274cd5a7eadc6b341886da42763e6183c2589d31316fc2cad92c4  answers/rn-07-add-time.json
dd3723fb07396e4c8c974b30995318744afb9cdc59937173cb14c5a56a2785df  answers/rn-08-add-then-back.json
208013865fc86154b19ca0a57cc88c76d514a5c841d4fb899a0d5a114311c352  answers/rn-09-double-actions.json
31d092d2efc34bd362b782c8a0545e17e5f94fd012dcfec9bbffb569dfe6c157  answers/rn-10-after-end.json
e1ca761f8cba719bd4ab0dc8befdcea61b1f127505295dab880ca440be041301  answers/rn-11-boundary-pause.json
1559eb06da50dcaee5b25f0378091865913f11885da9fa385dc5b3f95d762655  answers/rn-12-end-while-paused.json
5e2e0577d01ee8089135d503be8481a4da2a9ca1d92895d9a63202e9ab53baf4  answers/rn-13-skip-paused.json
2bb7685c26248e55659182bfaf8b3eb7f15ad80f0610df38a721920678eb4a26  answers/rn-14-skip-to-end.json
4d989b56a383e9e805f5c43b6723bd7c086af0a228334df9b2aad2e35d715efe  answers/rn-15-runs-out.json
d59047af49fa27f217f3def14e724d1dd1f415957b71b8e6120760991ef1867c  answers/rn-16-open-next.json
5cb0e48ec7252bd53b87a7dd672b3cf37e987a1784d71459930dc6e93750a763  answers/rn-17-open-add-skip.json
b46a7a0d347542075e79c72409e569b55cc9ef8789cb9c3b4f645efc70104e36  answers/rn-18-back-into-closed-open.json
d37357fbf03aad8e6045f187b9703ee1f4ddbc9fdf9296d7b297c39651e60526  answers/rn-20-odd-ms.json
5f6ac164e03c47d143501a1c244c667f00bc8180a14167abb79723c1b9f886ff  answers/rn-21-round-rest.json
2814349b4bcd14fe91cba5e0227d35c75fdaebb2a48405c803a1dbe0bd382257  answers/rn-22-double-skip.json
e344cc1ff3df1769a777e06ad6477ae3a2f5153b22f88cc88ac0c8873e5874d6  answers/sh-01-tabata.json
8b704bcb2235b25a4b4a2d6049f3b1a17a65cee163b1942a92f4aadb425bf29d  answers/sh-02-unicode.json
3a3faa5a263a7071f90c882117e3a3decebb77522ea32a455e597103fc9e2dea  answers/sh-03-every-field.json
3425defd11bac4b1863a47820347908c9b28283e0fd92975f6bf2145398fdfb3  answers/sh-04-big.json
822eff3cbf4e0f26764daa7c97a6ebd683b635eda07a70b0f27a58e7e0b1a586  answers/sh-05-notes.json
3067cd8bfbb1fad75d60bc52cb9b358ecd310134dc851b6da2e4c1559987f705  answers/sh-06-unknown-field.json
71de6010d64c8acf84e2191967fa8be45f875a471b12d9117fef85c1c31d828a  answers/sh-07-tamper-seconds.json
71de6010d64c8acf84e2191967fa8be45f875a471b12d9117fef85c1c31d828a  answers/sh-08-tamper-name.json
71de6010d64c8acf84e2191967fa8be45f875a471b12d9117fef85c1c31d828a  answers/sh-09-tamper-total.json
71de6010d64c8acf84e2191967fa8be45f875a471b12d9117fef85c1c31d828a  answers/sh-10-tamper-rounds.json
812b08c7ead779330184e2ca70983c16a2da834884cf6a3a4f152b95cbb061de  answers/sh-11-hostile-links.json
820592e37810bebf31185e648544c9fc42b3ed53c216d69080f90a0ed3d8dba7  answers/st-01-basic.json
77b4f4be62c1ddea4107c068e69c5fb302767e0778eed72122a8a1912fa8109e  answers/st-02-dst-spring.json
0954695b77e62b09c03afefd452fa4e444d19118e50ae6435f0186675869d05f  answers/st-03-dst-fall.json
fdbdf49d630e480d2519c88dcbf48ee7e54aad383b983313153ff48e6fb21411  answers/st-04-iso-week-53.json
89e39f5f7238274bd5ae441f0b4e63f60122520e676e7aa5d52897a75beb6d38  answers/st-05-iso-week-years.json
677917d2501a8a3142523af04ec12d226ca4bb1741a685c91f3165050c52eea8  answers/st-06-kiritimati.json
3aae2cd56ad39cbc3e00f93039c753d32e196041f80d66e8a21c7f7c3e19e232  answers/st-07-pago-pago.json
c5f7d0158f5fd0a6d5987df13b924711072662ad84afa6436e332cad1dd78671  answers/st-08-kathmandu.json
62a507b8b0f75da2e764d706d42bf251a21fd98b7b3ab61c79f8e31a4c8368f4  answers/st-09-lord-howe.json
7909a538608d30a42af37e3dbfd9109199f43955ef675856baefcc900b15783f  answers/st-10-gap-streaks.json
d3adbe2662d939bdf4e378daa20a8759548b9d64f3220465dc5ea7d3f2c66faa  answers/st-11-planned-null.json
663ce65f5c684ae3109457b36ead7387f061b6484be401cb0bcc6fee807eb3df  answers/st-12-yesterday-only.json
cbc2c8575cc85a0a0b48b1f9412c4c464bdf4dc1e93ee3edaba6ad0fc66d795d  answers/st-13-midnight-crossing.json
4595c88eda441215a67437b5b5294a87933219f217c001eb60d83a11ee9ab716  answers/va-01-tabata.json
e3a301e1e862fb705e06da7109de4d6b8128b9635729d443b4ba56f1c1ef14e8  answers/va-02-seconds-0.json
e3a301e1e862fb705e06da7109de4d6b8128b9635729d443b4ba56f1c1ef14e8  answers/va-03-seconds-6000.json
4595c88eda441215a67437b5b5294a87933219f217c001eb60d83a11ee9ab716  answers/va-04-seconds-edges.json
d75137f314f1801c69e506641d824e729bdfe2dbdc03a0d5ae32e1ff28014260  answers/va-05-rounds-0.json
d75137f314f1801c69e506641d824e729bdfe2dbdc03a0d5ae32e1ff28014260  answers/va-06-rounds-100.json
d2d0a0e25ec762b65907759d46f6f90be1316f7bb8e80439a35a92038399cc82  answers/va-08-21-blocks.json
4595c88eda441215a67437b5b5294a87933219f217c001eb60d83a11ee9ab716  answers/va-09-20-blocks.json
215cac3283b80fbb6105743be7a9cbe7bfc46cd88813395df33fd5ebee983949  answers/va-10-31-intervals.json
4595c88eda441215a67437b5b5294a87933219f217c001eb60d83a11ee9ab716  answers/va-11-30-intervals.json
6014b0c12551f8b6e3c729e427f58e2232ff82466ec2802f2237b9b562a551d9  answers/va-13-block-name-41.json
4595c88eda441215a67437b5b5294a87933219f217c001eb60d83a11ee9ab716  answers/va-14-total-8h.json
09068855e122bfc641168b9c2ebcb644b9032108f46b7bceefda455b3451dce8  answers/va-15-total-8h-1s.json
09068855e122bfc641168b9c2ebcb644b9032108f46b7bceefda455b3451dce8  answers/va-16-prep-pushes-over.json
09068855e122bfc641168b9c2ebcb644b9032108f46b7bceefda455b3451dce8  answers/va-17-repeat-pushes-over.json
09068855e122bfc641168b9c2ebcb644b9032108f46b7bceefda455b3451dce8  answers/va-18-round-rest-pushes-over.json
4595c88eda441215a67437b5b5294a87933219f217c001eb60d83a11ee9ab716  answers/va-19-emoji-40.json
6014b0c12551f8b6e3c729e427f58e2232ff82466ec2802f2237b9b562a551d9  answers/va-20-japanese-41.json
6014b0c12551f8b6e3c729e427f58e2232ff82466ec2802f2237b9b562a551d9  answers/va-21-combining.json
e3a301e1e862fb705e06da7109de4d6b8128b9635729d443b4ba56f1c1ef14e8  answers/va-22-fraction.json
650fd1d45bd9e3b9278606ad0b28e14b5e24fe14f6830f91c5417c4e988a3a51  cases/bk-01-fresh-roundtrip.json
4d86e24d61cada35e561593367a1af87ed392b0b1eb08251a04508506a370c37  cases/bk-02-fresh-settings.json
4627c4f3bc3f00d12e3d5574e4c110f80cdbcdb87a92658e6216d219c4e34af3  cases/bk-03-replace.json
0b8db4166ccfc2d308596131679971c7ab7426c2988e6803d700dc76deee5078  cases/bk-04-keep-both.json
d6bad1db9395d2401a4c5e969acf9d32d2aff9579fda50b9aae647bc95525ee3  cases/bk-05-keep-both-unchanged.json
00ba313f67a5d214aafcac13b7849c7539859eaa5090f8e24a8627917e610597  cases/bk-06-truncated.json
0d274266b5868fd6ba8bc6f62ae584213fa81bd0f474dda70ff783a40452f3be  cases/bk-07-not-json.json
3bf055c850a9c80a662f78c813216a791f0e912b3344b873d3901742cd00feb8  cases/bk-08-null.json
0d0456730813c829bf52e4bceca178bb9cae75217eee83acec453c0af011f22e  cases/cb-01-basic-windows.json
06f12ddf97bfc2e05c63b55d0edd735423e3daf766b55698d5f0e8f4dbcaee61  cases/cb-02-long-gap.json
473cb0e6c3132386a8a36c6911d7d3a57ca640a0fefab4c5925a3dad575a647b  cases/cb-03-boundary.json
030d4549add9ea70f0fbf619dc30cf023ccf92c46e71e4744e738804cf86a03a  cases/cb-04-into-end.json
8779e7e22e0c100b9752e78f6e9c32aa082d0958f63f797bf24082ec5db734fa  cases/cb-05-open.json
ac54619d1e4fc8ae5489b52d62d6d268376f5fdc3e496945aa3c549cf05ec5e1  cases/cb-06-halfway-batch.json
775e6006d6a8c3bf8ab9c6c77e64d3993d3a550ff434ce6af8542daa64d633ac  cases/cb-07-round-batch.json
97ca2e4e1fe0a5db9144bc8122474b89cfac9256a4daf4378a7a6efaf8329dd9  cases/cv-01-plain.json
ff274d157c6c1f22f115986acad14365b600b7da5790fcfad37c23d9f6e501cd  cases/cv-02-guard.json
f738d374be10c4d704eb774eb93dbd32fb19d584a8a1c1d83792b2464f83e6bf  cases/cv-03-quoting.json
7ece680c7e84d77c0bdc28cf1a3143b51df895752c7e55b3fd880e66e5ab3eaa  cases/cv-04-unicode.json
783f780be7ade4bac13d81cd180e8df9761b91d4af37da1e2e48a29eed12475d  cases/cv-05-guard-and-quote.json
133f9995bba5f69da5976b3012992000f49e075c2fc0b9c5e805e857b1978ddb  cases/cv-06-no-false-guard.json
14f5347fefbdd150f07b1c88087a8f01d028b06202980c3e342003ced5e68187  cases/fm-01-duration-0-en.json
f9ae01b6ee5326c9c57a3291382565b37ecb581a50f0aadc95b94255d56e0105  cases/fm-02-duration-59-en.json
91d9323257f3d8f134f32c90395a4db80d0ef074807676e8e9972dc05471f24a  cases/fm-03-duration-599-en.json
d51698c69b0c5608b3987b4c3eeec2fd80a1bc40bdd34a18d476a85868bdf3c4  cases/fm-04-duration-3600-en.json
eefb068392fd21867a82757037f9ac319daa09c645e2c12c8595c704a8161364  cases/fm-05-duration-5999-en.json
922f8cc2522ef4eb986590dbdc37609148d797fd8fb3ad73c9c5f970f1d5433b  cases/fm-06-duration-28800-de.json
1c2db4ee31567d75b81a64592c5042c9a2eef45b8d1a02d18717df7c12858cf5  cases/fm-07-duration-754-ar.json
8b403827382e8f753ca2d595ff7dc0acfe867866b90fa1fe8af687d5c6e6609b  cases/fm-08-duration-3725-hi.json
ff3f7f22458a4b971ac7f7113496bd73f904e22ee5a2706bb6e0b89ec9d9fecf  cases/fm-11-block-circuit.json
8cd1bf8e3d96a72f7bb7eef99ff1678f0e584724c03e49095345760d225792b9  cases/fm-12-block-one-round-rest.json
5cfa5632954711faa7ca399f325f39b0094337827ba2492ef998bb21fc2aa797  cases/fm-13-timer-tabata.json
ae571dde646582de5c61c457141bee7d73a51ab412d72caed3e862912cfe75b6  cases/fm-14-timer-repeat.json
74b978752a740f2993b8381b2c49b0617ed2868c93ba3bb596d1d2aff926bb09  cases/rc-01-running-mid.json
6234076da84aba40431fc64ccbeed7cfac38727fa7ab28e492fb75b67c8832f1  cases/rc-02-running-past-end.json
4ba3bfd5b622a7ca1e522547a7036eacc88f33f24895d8477416719490c9124b  cases/rc-03-running-exact-end.json
c7aa379213f165c28198b7947ecfee7a4d82344348aeb3cc4236223920f0f218  cases/rc-04-paused-10min.json
a2b4c2b7b14a2d29e3cac44e230688d0dd6df5d4ebf9ff903af5feb67c21fc06  cases/rc-05-paused-25h.json
d0eb4af336449849c76eb09fd744a8e82c125ceeffd1d30754a2f1c70d8f4f69  cases/rc-06-paused-24h-exact.json
76354125a36064ae56d03540f87c975ac665d78a1b307878e59a85d91a5486b8  cases/rc-07-ended.json
49c22d3c1701b85fa9f405d18812315907fb21342cca8d84ad1f7f795f5ff80c  cases/rc-08-clock-back.json
10c3783d03a748794ba0942590c9a01f37100449c3782b64f13f87a932e783f6  cases/rc-09-dst-spring.json
c51236fb538acb5b3817b2239a17bc1aee7bf55348c5d3479c8fca83babffea8  cases/rc-10-dst-fall.json
cef574d3e532bcfb3f69e2c714e6bf4cbe48bb8216574529c050d588b2e54545  cases/rc-11-replay-add.json
1fd6de9683eb3330a0a4778523c63f10d5fa921fc64300a18848d528a792eb3f  cases/rc-12-open-resume.json
f07022cebca4d65ced54b7a99bf834dbff4fd060d0ecb65de03f39305f9422bc  cases/rc-13-open-stale.json
f320f3c30db48f99dcc215422c16c252d3476190a2557181deea0fe422fb9d9b  cases/rc-14-open-closed-finished.json
94fb9bf44b58a78d6ff15c1accfd3f1a4132e3f6e854f71e2dd0c46ac8afdd5c  cases/rn-01-basic.json
ff85c74642098574555bc85c76e9790352ecf48421a3455047c72e7ea6a590c9  cases/rn-02-pause-accounting.json
095bae5f237042f1428ec01015e4ed869d192c39fe0b934b548ab3649a8fd549  cases/rn-04-back-rule.json
a351a098fd2e711f8aa28d5410c3a05ee7d4ece09ade67c9eebb00b63d1d1eb7  cases/rn-05-back-2000-exact.json
7d231df0402e1a1a87ec7ad8da0fa8d47919a12b35642b3fdbc603b59a3c0d76  cases/rn-07-add-time.json
29df02984ee0a776bbfb974627d4aaefd5e1e2f7251ee31ce2649b095df0ff54  cases/rn-08-add-then-back.json
42186e2568f21d831e16cc70d1f326d1e6db3647c915e03ea06fda248b7df052  cases/rn-09-double-actions.json
f3bda3b951d99d62b6dce86305d454cf5010fd0e7606ff8a55a218ddbae680e6  cases/rn-10-after-end.json
74039382fdb2c8150b94966253fb60b8da76685434931bc7e797469c83e5e604  cases/rn-11-boundary-pause.json
a97bf88805816ea21ff8db1f759f3e539b76881224ca49522a1e26e7634e584e  cases/rn-12-end-while-paused.json
4c19b00ba1e3ae05e82f8f83f26ed4096e4678e66e9fbdb1e153268b8debd64a  cases/rn-13-skip-paused.json
26174bee1d3a04932df549a179d5cfabb1d40d2d3c91cbecbd7f355c5678e683  cases/rn-14-skip-to-end.json
10eee37618f9ceac88b14634c4659fc86d03ca59407091ffb5c5f693edfc2908  cases/rn-15-runs-out.json
65f84ca2ae6df047b54a0531bb3d9b7caf137a83b9affb39076a890887feec4e  cases/rn-16-open-next.json
9813d26a891496b4c941595dd8fff9ac6bc63ffda22ae5a6bfc24f8a4c5f19f4  cases/rn-17-open-add-skip.json
8473500bb8af9b3d25ab15d39501d734e1f02749faa4ed019cd7eaae2419c72b  cases/rn-18-back-into-closed-open.json
a0594bedc7ed90bbe692758b6ef0e043e1a2a39ac372d57571182347591c2464  cases/rn-20-odd-ms.json
318ef7126445be5e10a38960aa9d0be017e99dcf17b2be844a44eaaec217cd66  cases/rn-21-round-rest.json
81f51a7df450bc3151fd46085e8b992dda2027980734bb6a3e140b4f64bf8246  cases/rn-22-double-skip.json
8b62cb36b7353c79bb8deac293e9d889caac1f695292572bcbebaa7d1d867aa8  cases/sh-01-tabata.json
2dd47b2c7435875a05ba9e3d882908c50fc5a3bb9d3cb0150edd09b6188e24e0  cases/sh-02-unicode.json
7c1efdbfe7c4b331a5ab322ad190a86b851e60417e29460fabb1308b207e4317  cases/sh-03-every-field.json
8beba44b7a15f14e58fc3b6397fdcacdff1c6ee031ccf7436c6aacf331e6e561  cases/sh-04-big.json
1d6f93634c47c3162399be366b99c7697f5f30d3efcb0cde1878b0be407f06f4  cases/sh-05-notes.json
a0bcf2326fc43eaa32fea4e1deea487a222c24dba36e450cacdb66a117d7845c  cases/sh-06-unknown-field.json
7a6108e548f2dbb85dbf469658ec324eb2450220185b5c0869f45a998b7f8d3f  cases/sh-07-tamper-seconds.json
063f1142b23e39d66257ee10ecdb1db0f4cb874ef63609a9cc2fad133ca483e6  cases/sh-08-tamper-name.json
961126868ef395086b121b6b07ec60b131d27251f6b68fd171612af838b0c63a  cases/sh-09-tamper-total.json
4efb5a5c5f7c7a6f5a4227cc942e64c3b294663fe4019974b44620b256bf1795  cases/sh-10-tamper-rounds.json
0cfe0f6b901ea94b672b623d24ee2c2a98872c167cac2ec1f18847fdf897568a  cases/sh-11-hostile-links.json
5bf835f56dace0fb6c658fce1ad586a8609ad4f7323d1e59aa95342ce7179c06  cases/st-01-basic.json
1c8753e1f77879d8c20dd9814524d3e0751b62854d2d40bbe1e38d93f0e3c103  cases/st-02-dst-spring.json
6964e7f3db6c3893d37e380ed2ba853c06cab2691ad0abb91d167366985c7a19  cases/st-03-dst-fall.json
a6fff8fdbece5ec112e17be2c1ccd17259aae4265787bbbedff1cee7a3e21348  cases/st-04-iso-week-53.json
966c452729461b1048d1417490a590435e6ed1c8c292ad17c5fec186ebbfd4d7  cases/st-05-iso-week-years.json
4bb3aac59466d2768ce0a8d7e914a5b4350416395cf310e127fcdf3cb3670ada  cases/st-06-kiritimati.json
b4a5e9b80fc72d8ec1df174da84c02a4f952132b42b6f5c141f5dfe1f7fd6bfd  cases/st-07-pago-pago.json
2cdca17e2477637c4e19f0975cb0ad451b83a357f3ce844caefd088a59eb4580  cases/st-08-kathmandu.json
de1047001efacd7d1a0bcdc457e531bc6fe66ddb4616462c20bad3cd46d9ecf3  cases/st-09-lord-howe.json
648fa857582c8265ec57281c0075ed84f8fb4cbf06bcbce963e5d9e830dfe5ec  cases/st-10-gap-streaks.json
03de50dadfe5cd35553c28185580f1dcdba8b617f4f3aef11e4b32d2d4a68363  cases/st-11-planned-null.json
e7efc867136c2ef023bd7a4e87ac19109154ed6a00287c092d202b558c0324bf  cases/st-12-yesterday-only.json
ba97ff39a25d136436685d6ec32399e7d6f0252799ac7cde69e017fe205a2d27  cases/st-13-midnight-crossing.json
67bd30ecde74d780d28d11bc48db247bfc5f2a1019cfb8869680d8fbd80cfc55  cases/va-01-tabata.json
546abd9f28f06d75f0f2c02a91a1e94a19e629b6c820eca6a46c053dac978894  cases/va-02-seconds-0.json
ea4d395d75c705e4f1475c41ad01f3b044955f02d2418d931b4aa12b07b457a0  cases/va-03-seconds-6000.json
61bd191b512442bc29879667199f9bc1e7c33865a6ad26c6105f6308875850c7  cases/va-04-seconds-edges.json
d66e9b215d3797be0050ac2339f2c185a8db073e6af16eac3c92d509a9de348a  cases/va-05-rounds-0.json
39e5aff3a28c649e7f8ea4464d30b73775471beb3b04215ed4d56f0e854f1984  cases/va-06-rounds-100.json
5457a6c087af2e5e6aff2213fbd65eb486dcaf34c971d7104dce1784418ea697  cases/va-08-21-blocks.json
6f772084f5e4b270460d177a61612d77b225adcbbe9ff141308f2f3eae0bd857  cases/va-09-20-blocks.json
22e04d593b2ce079c2780da4a2b51c91cc3de7c0bf4153a42413e366e05f5e08  cases/va-10-31-intervals.json
6e30def33501e3dabf8c2846abdef5d7089d713090571e64b2591b086f4ab455  cases/va-11-30-intervals.json
ae6850d0a210e601ee5bf898cbac0e2a7662d433a7b8899d7e5f86d27c73f099  cases/va-13-block-name-41.json
239ee6f979dae5951b47afff5f5421468029baaa04558a09d73f3066200ce48e  cases/va-14-total-8h.json
29be55b00213d7cb392eaa1eaf6df66650bbb7358587c8bd41edce8248e61047  cases/va-15-total-8h-1s.json
c5c788772221db8ecd4e46f856204692e690571d6981d22fd67919bd1c0d8a0e  cases/va-16-prep-pushes-over.json
9c0136c36d13564cbf711977e71572424f82e8b3c737ebaa4781c625fc724a3d  cases/va-17-repeat-pushes-over.json
f621dafe5dea9a0b8d04a0a72afc6d2b4b65a9979748bd1bcb34c276d98893d2  cases/va-18-round-rest-pushes-over.json
9eb26b1405ca30a0ba747f5186262ea5dded6c61968b146682604d3e24f39154  cases/va-19-emoji-40.json
9ab39161843828cbc4253e9341d4e9da4661e31d51724ef51611e37057ed4736  cases/va-20-japanese-41.json
336d7970396ec1ebdd962f80b8b7ccc03b57659c22a4fb00a7351559562d3ba1  cases/va-21-combining.json
af606c0c2a425dbdde1f0db7e9c53c226853c66b851e56d78f582f25ebe157ad  cases/va-22-fraction.json
aee4f4e4295b315fbbfab7a78c98597ce57291b127d71c0e50825cd40c5c9c93  excluded-drafts/answers/fm-04-duration-3599-en.json
75e5ac90f24be325f5b48df0f412ac83df2efb41b0281468fe58c0d7de77d1cc  excluded-drafts/answers/fm-05-duration-3600-en.json
f4a80e39911851aa522910d2bea6f91a042bff93407b80a5e175258d24e4d57c  excluded-drafts/answers/fm-06-duration-5999-en.json
46da7faaea21b97727323c5ec060ab1b45fb6ecef0d946a7d650ec809e91ce34  excluded-drafts/answers/fm-07-duration-28800-de.json
639c360f796db7606f0872357b144c382d27fc8cc12674dfc425dc09de2a6eea  excluded-drafts/answers/fm-08-duration-754-ar.json
9040093ab76054f9fd89c98a5967469e9f4d943e34e47a97cc2728e84a56a5a3  excluded-drafts/answers/fm-09-duration-3725-hi.json
55b3c95cf80b19dd67a291b0dad081afc37af48c822b9fd0e672224b62b7df2f  excluded-drafts/answers/fm-10-duration-61-ja.json
a2651a7e19441b9c66519c15e89bfa83cfe2c01f26a5724e5f404a778ca6e647  excluded-drafts/answers/rn-03-skip.json
2e99565663ba0442c528e26c20cd8d1f7af855967723347691770f9d8e13812e  excluded-drafts/answers/rn-06-back-first-segment.json
e3cb43ade94f15a192a79b2de588f7eed7616f8947c8e015cabe511baea9852e  excluded-drafts/answers/rn-19-add-on-prep.json
4595c88eda441215a67437b5b5294a87933219f217c001eb60d83a11ee9ab716  excluded-drafts/answers/va-07-rounds-99.json
6014b0c12551f8b6e3c729e427f58e2232ff82466ec2802f2237b9b562a551d9  excluded-drafts/answers/va-12-timer-name-41.json
ced71afa2fb8ab307855f22355145a86abf443a9c7e2ea38249f18c9930703af  excluded-drafts/answers/va-23-prep-61.json
9eef38fbfeb479c1595a6492a8e7f1b13979d713640afe06c12401b932829d6e  excluded-drafts/answers/va-24-no-blocks.json
e5a71ac156af70a29ca7bddfb8210ceecacfd449bc9f57bc15e1e3660f0b68c8  excluded-drafts/answers/va-25-multi.json
9dbd51935af8a89abfe732ce7b7e925f4249306319fb96273d1c8e64fa1f702c  excluded-drafts/cases/fm-04-duration-3599-en.json
6447ca0312a60655fefb380c4cf89598265419055a5f10fe2c141134024bf5d5  excluded-drafts/cases/fm-05-duration-3600-en.json
573c2400043c5b13db806069aaa8a6f7ae246851960497acafe95f7d3505bacf  excluded-drafts/cases/fm-06-duration-5999-en.json
bcb771b49d3b243013bd73241a3b2b2bba86308a2202522a419593b32e145e81  excluded-drafts/cases/fm-07-duration-28800-de.json
c88d193587dde041159ef5955ee7bc9b1c9663f27448d73a5f84a78be10fd5a8  excluded-drafts/cases/fm-08-duration-754-ar.json
fbb8c5c3f3359d080161d002b77460ee1ff16a372910d50ea94bfd9259b3ddda  excluded-drafts/cases/fm-09-duration-3725-hi.json
3308952108b324294deb1117c750196d1327472117de5330f6772da199efe088  excluded-drafts/cases/fm-10-duration-61-ja.json
ceb51bf36eb3b57ddda8bd76b2082cdec71bfcd1ae38dc035f1362849817f269  excluded-drafts/cases/rn-03-skip.json
57a237c40dc2e297b7e04b214a7c3b28a622e094376c051f479949d6521bf908  excluded-drafts/cases/rn-06-back-first-segment.json
bfdf79b960fec05a7d65d302c9ef363bb05cbcd75206718bdc203d63b7f4daf4  excluded-drafts/cases/rn-19-add-on-prep.json
7d3a7739f5e074b98ea71810d7d362857967c0a10206525925d58aad36f26d7e  excluded-drafts/cases/va-07-rounds-99.json
25acfa1e1dfff3229cd627b1a68eb4f6c7175dc80cfb89e79a58bdfb6c31b274  excluded-drafts/cases/va-12-timer-name-41.json
6a0a9cef25a570ef77ff79c674208bac5c2098fdddc9f39824eced07d5fa6ec6  excluded-drafts/cases/va-23-prep-61.json
9e7fa37cd3ad4309702ed23d9b965261ce52d50831cd2c7212cf2df3ed5468f7  excluded-drafts/cases/va-24-no-blocks.json
7291f0cf8ca83742fe2246dc2fb7b66f41e132df6fefe5e75ef6dcb50dd40e9a  excluded-drafts/cases/va-25-multi.json
2d926794e154b052d71bfc52d599ae866a31ccedd5e850723208c9f3fc459522  excluded-drafts/expected/tl-05-walk-run.json
a6fe41a03f309648f310c6f3604b77cf426beba8bb00dba5365dee365da553dc  excluded-drafts/expected/tl-27-cf5-on-5s.json
b9683bc3bc91db56ca7d37e15fc3e03f1feeac4f8de25c8c448dd17246f848bb  excluded-drafts/expected/tl-31-halfway-meets-cd5.json
e8f28f44e985ec9f50bc94fab97cd5cdabebdd40a7784c6d46197f4409ff8bae  excluded-drafts/expected/tl-34-end-voice-beep.json
78b26c0990babf7189494b0b67fcfbadced3f7d3e8f6d86a3eaf16b824a323ca  excluded-drafts/expected/tl-37-block-boundary.json
42ffd6c7404b400f9d62ff17f6c3a6502e7a4432c3444222d29336e2d914fcf6  excluded-drafts/timers/tl-05-walk-run.json
95031c620765bb17e09eae0a9ff217b9c70e77b8013b22d21cb0764d6c61af4c  excluded-drafts/timers/tl-27-cf5-on-5s.json
b0fd39bbe118339b24d125bf5b38838cad71a836e9c09c9b439ebe3ac812daa4  excluded-drafts/timers/tl-31-halfway-meets-cd5.json
ce48c4b93b62221bf24b3d9bde3d4bf02e43f6b97306fce3c8b867a046efec92  excluded-drafts/timers/tl-34-end-voice-beep.json
10474698159ad189ad940c53a11e270ecc4e05714c01ab0463a94fce59755f70  excluded-drafts/timers/tl-37-block-boundary.json
f0c9eae8882f38b0e8d28e848f4c7235498ee6c86666b2beea441660b69d43f0  expected/tl-01-tabata.json
f7e5bec2c2d4fc3ce8fada91a93219b5ff6a7519254ac822304a26706b760d44  expected/tl-02-hiit.json
1855667924489010dcc53917cd503116d7475370339f3c8fb6625fd84adace85  expected/tl-03-emom.json
d5f0a9d5414e78bfd11d2b7ee851167b5f6cffa54a08bd7479e469c4ba21ff47  expected/tl-04-boxing.json
6ad2abf16c98728fa8ac9da7233d7bafdeb071a79f8fc9acc03b8a96ae00b360  expected/tl-06-circuit.json
f6ac1f6ee4f123ff6e06e4def93b685b12098536ae5878eb5f630025f317a779  expected/tl-07-stretch.json
7341b841a56fa9cf10cebf39a168c7100ca11bc4543cb31658ebf8d5269aa696  expected/tl-08-no-prep.json
d1cc1a431f28200b18d9682ebab44eecdd055230e8edde1eb46464b74ccee05e  expected/tl-09-prep-60-cf10.json
db36ac2f404731681ed4225534c05e79bef3987da2c8060781fbf7567b8e7e02  expected/tl-10-rest-on-one-round-block.json
b2d1fa974fc7de9ebdc0108a4ee88d86377e956303f4530654bd8933bd1568d1  expected/tl-11-repeat-3.json
3c5ca54856a009d04d9ab01fb6d5affeae8139358b994fb8e95513f76e6cdabe  expected/tl-12-repeat-10.json
25c1099248db734876b5d062afc41d7a66d5e3f151f9e4569962c5d0d03def4a  expected/tl-13-rounds-99.json
05b08d690ab712b3fb4ad3e397452eb2c050c3d1ffd0e10d7f7b78b1a3a5f575  expected/tl-14-30-intervals.json
d5f4ce71ba30fdfb007a3f951fb316da29bd4f64555dc1ceeb0ef4d75b634664  expected/tl-15-20-blocks.json
987523f519a51f962593abda04b5b9ca06ddf1509410bb5bbd7dc00097bfdcf1  expected/tl-16-total-8h.json
545e3d858ff29b4ce7efc3d7ebb5bc2dcffeebaf6110d7b52a74ad2ad1a60924  expected/tl-17-5999-halfway.json
cd52cbf1af608d1aa8e9dcc98da91537c2dbcb117e7f34d0776cd21e758a6774  expected/tl-18-open-next.json
f7d0d99f1fd27b1c97d2edf3b94948f618ebc5f3f53c60e22ae3d0d2c871d55d  expected/tl-19-open-stays-open.json
5415a6f0522584725f5dcc77fc5122b349c95730c4c50ffe174200f5b4fbb028  expected/tl-20-open-emom-rest.json
49642ab80bd04f2eced8696e45926e7f1f21a6dea30f5edbca0c394de0aa15e0  expected/tl-21-next-before-start.json
5729643dceb9e09b7fcb04b334ca078392165d02d6477e93db4d9313cd8043e3  expected/tl-22-open-flags-ignored.json
8e7155f1879ed7bf9743c3eadc10979be10860810c78550bb1407a14eb0bc405  expected/tl-23-two-opens-one-next.json
3d3f80609b39855ead3efaa82b5a4791849fa6db66b59ce8a553d97e602d6720  expected/tl-24-open-first-in-round.json
f3bc1bbfa2c524dab3b219c9207dad1077b5ec2bd2d93a48ef17e49ba78b36c5  expected/tl-25-open-repeat.json
2fe26cb3c463569b69d477ca8e09a5f51bb92cdfa881e9f1535284e2a9cc7e17  expected/tl-26-next-at-start.json
236c1a6048cad77c876b79194f3ca35186ac916e29bcc3e5c3f984c95345a97c  expected/tl-28-cf10-on-3s.json
811ce062dddf4dfd7206edc3773f715bb1a2e151a222bb6d6ccf21cfd38d262e  expected/tl-29-halfway-threshold.json
1b8a6c587f12f4333fc8c35462d70d2928189a75230e6d4f6e0e7862e1c376d0  expected/tl-30-halfway-meets-cd10.json
60e562616e57bf3b871e2f3eaf0c0fccc1a25c9cdeebb7d08043d4fb045ad446  expected/tl-32-cue-modes.json
e3b424eb76ba3e8d309f91e40f593494009394362ee376120d132afe9a502d04  expected/tl-33-end-none.json
92e2aea675244d2ee5c66d5fa31bbd2e0396f810b882810d3f84fa1a3186ad1d  expected/tl-35-prep-rest-always-cd.json
9bdfd0ed8c4db5dd9348cee0ed600bb70b48e302e68105a97a5874d5afe4b878  expected/tl-36-round-rest-no-halfway.json
8eea4929f17be450cc425012ef8236a0ae7d1961aac01e63de1e7f2958d1f1ad  expected/tl-38-unicode.json
4eb6c3b82d62489ccf586316316cb53a9414838d34603a598af1d9347cd14925  expected/tl-39-names-40.json
8cb8ce55b7329de19f9de752e7dff43fc7fddd6540740fc4ac1594cbea310c91  expected/tl-40-typed-prep-interval.json
f40fac4e5330318b35cecd261f46cc616aafc962ea82cf4702848ebddcf71940  expected/tl-41-open-tick-not-listed.json
8b8cd49fd059af21d6263ded076747cfe868f2903b03e8698cb8799b7361555e  expected/tl-42-cf10-on-10s.json
56598f8afd96e2502e7040f1c315b7a1f84e986d67880d0563d1870dd5820ce7  expected/tl-43-all-ones.json
ec4ce59e6ba1685d25fb55db9e4bd9f2b65d1268749117222b9e49f941d0ba72  expected/tl-44-u3-circuit-repeat.json
a38c2bfb6af2360350f13a5993dc8d0387a8f77a2b98447a2acfc1b78c03ba52  expected/tl-45-open-last-closed.json
ea4fdbfdad50e59e932823270436af06bdcc5b69d68a3e773766037c0f4f242d  index.json
42ffc54fd86f3f1d8b5abe551ed809a30bf3be7e1089cfb2513a81a0ead01986  timers/tl-01-tabata.json
6b452c753c0bcf3954c41528a1008e817be8ccc925454cc4f6419ee9a0042ee0  timers/tl-02-hiit.json
ef8e7d248bf991a5c3fbf8abe4b382c749891c50858a3c66ae61bcba2d81fd9c  timers/tl-03-emom.json
fa035062b66f16f7e35063f6eddb80bb93960ba3b740862bab627939a3551b57  timers/tl-04-boxing.json
3de94d8b4449684a93761b2401ad9eecddbb881214850843d19682a27231c70b  timers/tl-06-circuit.json
f3668f15f556369e92875be4084a832c1665dcc627076cc4f392ed861aeb204a  timers/tl-07-stretch.json
cf747ea0593c95185c3630f2c586ddbdc1373f5d81e26ad55ac5a12b285f1a74  timers/tl-08-no-prep.json
a43a1be1c54e8a2a357b526af1da988558bd0487aa866e7ed5764ada33801b52  timers/tl-09-prep-60-cf10.json
dc4384700c7774c3be090b6817ba4131742791ebd8a91d9631f398b635fca572  timers/tl-10-rest-on-one-round-block.json
bb129fd4f5b8a38041c3bfdafb4053fa90d4991a4c42b04c8890847a6f78f836  timers/tl-11-repeat-3.json
7ce8bbefeeb2dbf911b14889b2907242ad1f15dbe4e198428401f9661dce356d  timers/tl-12-repeat-10.json
bc70a3ffea928067f589ebe0d031e26e01144fdabf98f853ee4301f60ad5c8b2  timers/tl-13-rounds-99.json
8ddf327b15b294dee4ab660d9a1f3857cb4acce8760788ee351fe3de02aec187  timers/tl-14-30-intervals.json
380385f562701b822baa39e04cf09feed347bb4ec9a1d5f546031f65084d8520  timers/tl-15-20-blocks.json
3dd6649f090d843d25643425998da4ad566448ca08726f92683c2bdef749ff08  timers/tl-16-total-8h.json
3e358e1ed28c07f266e861d030e1c7ff0400d39f2a9f60282b4bd8b4e705bb02  timers/tl-17-5999-halfway.json
5944d0beb8fec0d4dfe15a5de4de67ba66e85addd95966cbe448f5aa8b97ad25  timers/tl-18-open-next.json
297b2c54ac13bc5d6963322480724523340bec3e726dd2bcec22056526bda21b  timers/tl-19-open-stays-open.json
96912ebd99b3a3f19a075e2eb777549889e88e4b62392c522d7eaeba8cd79746  timers/tl-20-open-emom-rest.json
e67b7189aa13a879c1b083be6b15aa7fbddf251f9aac99a59203318b8ef52bf4  timers/tl-21-next-before-start.json
4b38411255c5af9aae58e4de24971204a87bd43333d8640b38d482b5fab3349c  timers/tl-22-open-flags-ignored.json
2e1ec641b3346f9c4d1964bc2cd6197906b26853546fca13b00c37191d46186c  timers/tl-23-two-opens-one-next.json
0c4b7e2d92861c6494c4290b524cdac5fb4e1f52fbf2af3213d954f4bee0316d  timers/tl-24-open-first-in-round.json
d5193aa8a2fb949be968e0e2c1540aaf5ada253ca051a88e6d1d61365ef1a1cd  timers/tl-25-open-repeat.json
93734032b21f5a9c98bec8ca633bc6dbb43695b08ae27f497c324f7c7c24ffb3  timers/tl-26-next-at-start.json
da9635413dd013fe12a7caa7200f4b619846cc0ebdbdc67aea5e74d229610ca6  timers/tl-28-cf10-on-3s.json
c50cb2f56e5f61f950ff0b79a9afd68aa6110ef8fee292db5ec60a084c838eb6  timers/tl-29-halfway-threshold.json
07f0c898bd0426c42e6c12cebacd2b26a952ddb0b09580023c41d443abbd1255  timers/tl-30-halfway-meets-cd10.json
825f9e985f33d3a81e62db86994d08c55833c85776c9237f977378f2f26c498b  timers/tl-32-cue-modes.json
771aef46606b924016580f35183fa985dc88a36e2ea66ba530f50559bc103c8d  timers/tl-33-end-none.json
2ef635a7e93debf317b4b12560ed23dcca3e1dfd5da0e033af7d90fab05a1718  timers/tl-35-prep-rest-always-cd.json
09fef13deee8315c3ac48919bc5fa41e8a90b1c9c5a2ad8178fda495073bbc2a  timers/tl-36-round-rest-no-halfway.json
297c72ef3824348431bd0629b4e42a863ed358970ff7c836b8858a556df4f6e2  timers/tl-38-unicode.json
7d822e8b23a4f31babaa28a48cfb9ecd3a534c84ec3de9f722664cfdac504e60  timers/tl-39-names-40.json
185b3a3fe585a659bffd6e8697af5b0a15e151c30f61a8e5be4b09db76ce4bb1  timers/tl-40-typed-prep-interval.json
b1b37f8ef28955deee6c453f94c4822f0c216609d41e3965e35d95d6a9020ca8  timers/tl-41-open-tick-not-listed.json
47bc65b2a39247c930f4a842c26d2672798e24f268958d96abf2d90ca24e711e  timers/tl-42-cf10-on-10s.json
be6d26b17bec6d4077254354785b72eb90bbc21a8d893fe968460db842f20771  timers/tl-43-all-ones.json
868464a0a64615a7f136bdb9f45bface951e1ef0aab7754d6c365922e73eff45  timers/tl-44-u3-circuit-repeat.json
7145b61a46ff08f4726ba182d3fd7ad86dc88ae1c96de14d306b7e74248bb327  timers/tl-45-open-last-closed.json
e93d6134aceabca90faef460f357b3de9e2553ddffe82aa45571e71d30a35b9c  tools/cases.py
b86814d17f86cf79eed3376d80e6d5cfc4bccc401a5086adf9adb58e2eddc9a6  tools/check.py
20436f43796d052d389434c9d3ccd4153d7259c178206b4487a9e89049b13a31  tools/generate.py
2eb8d91078eeddc40b922b3cffd093b9817f6d7316f269452be308659b9e04bc  tools/oracle.py
d7bb23e9a8e767b88b775a13a1d2a93f391922db8da11ecea4460ea17125ebe0  tools/selftest.py
```
