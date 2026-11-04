# Timeline fixture format (development set; SPEC §13 O1)

One timer per file in `<set>/timers/<name>.json`, its expected timeline in `<set>/expected/<name>.json`. The dev set's
expected files are produced by the independent Python oracle `referee/python/timeline_oracle.py` (same author as the
engine → a DEVELOPMENT set, tuning material, never evidence). A blind set written by another agent documents its own
schema in its README; `test/blind-format.ts` maps only the keys that README documents.

## timers/<name>.json
```json
{
  "timer": {
    "name": "Tabata", "color": "#C62828", "notes": "",
    "blocks": [{ "name": "", "rounds": 8, "restBetweenRoundsS": 0,
      "intervals": [{ "name": "Work", "seconds": 20, "type": "work", "color": "", "cueStart": "both",
                      "halfwayCue": false, "countdownCue": true, "openTickS": 0 }] }],
    "prefs": { "prepSeconds": 10, "endCue": "both", "repeatWhole": 1, "vibrate": true }
  },
  "settings": { "countdownFrom": 3 },
  "nextAt": [47300]
}
```
`type` ∈ prep|work|rest|cooldown|open; `cueStart`/`endCue` ∈ voice|beep|both|none; `countdownFrom` ∈ 3|5|10.
`nextAt` (optional): elapsed ms at which the user taps Next in each open interval, in order (the open segment closes at
max(nextAt, its start) and the timeline continues from there). Open intervals without a Next stay open (`endMs: null`).

## expected/<name>.json
```json
{
  "totalMs": 250000,
  "segments": [{ "startMs": 0, "endMs": 10000, "type": "prep", "label": "Get ready" }, ...],
  "cues": [{ "atMs": 0, "kind": "start", "text": "Get ready" }, ...]
}
```
`totalMs` is null while the timeline ends in an open interval. Cue `kind` ∈ start|round|halfway|countdown|end; `text`
is the English voice text (`null` for a cue with no voice part — none in v1: ticks are not listed). Open-interval ticks
(`openTick`) are derived at run time and are NOT part of the expected list.

## Rules (SPEC §5.1 + D29, D32)
"prep" below always means the timer-level prep SEGMENT from `prefs.prepSeconds` ("Get ready"). A block interval whose
`type` is `prep` is an ordinary interval: its own cueStart / halfwayCue / countdownCue apply (D32).
- Segment order: prep (if prepSeconds > 0, once) → repeatWhole × (blocks → rounds → intervals, with a "Rest" segment of
  restBetweenRoundsS after every round except the last when > 0). Offsets are absolute sums of the previous lengths.
- start: at every segment start whose cue mode is not none (prep/round-rest: both); text = label ("Get ready" for prep,
  "Rest" for round-rest, else the interval name).
- round: before the start cue at the first interval of every round of a block with rounds > 1, text "Round n of N".
- halfway: start + seconds × 500 for an interval with halfwayCue and seconds ≥ 10 (never prep/round-rest/open).
- countdown: end − k × 1000 for k = countdownFrom … 1, only when strictly after the segment start; intervals with
  countdownCue, always prep and round-rest, never open. Text = the number.
- end: at totalMs when endCue ≠ none and the timeline has an end.
- Same-ms order: round, start, halfway, countdown, end.
