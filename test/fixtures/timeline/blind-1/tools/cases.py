"""Case INPUTS for intervals-b1. No expected value is written here: tools/generate.py derives every
expected value from tools/oracle.py. `adv=True` marks an adversarial case (built to break a likely
shortcut); `ambiguous` is computed by the oracle from the readings a case depends on (README)."""

import base64
from datetime import datetime
from zoneinfo import ZoneInfo
from oracle import iv, blk, tmr

C3, C5, C10 = {"countdownFrom": 3}, {"countdownFrom": 5}, {"countdownFrom": 10}
CASES = []


def add(family, id, title, inp, adv=False, readings=()):
    CASES.append({"id": id, "family": family, "title": title, "adversarial": adv,
                  "manualReadings": list(readings), "input": inp})


def tl(id, title, t, s=C3, next_at=None, adv=False, readings=()):
    inp = {"timer": t, "settings": s}
    if next_at is not None:
        inp["nextAt"] = next_at
    add("timeline", id, title, inp, adv, readings)


def utc(iso):
    return int(datetime.fromisoformat(iso).timestamp() * 1000)


def local(zone, iso):
    """Epoch ms of a local wall time; refuses times in a DST gap or fold."""
    z = ZoneInfo(zone)
    d0 = datetime.fromisoformat(iso).replace(tzinfo=z, fold=0)
    d1 = d0.replace(fold=1)
    assert d0.utcoffset() == d1.utcoffset(), f"{iso} is ambiguous or missing in {zone}"
    back = datetime.fromtimestamp(d0.timestamp(), z).replace(tzinfo=None)
    assert back == datetime.fromisoformat(iso), f"{iso} does not exist in {zone}"
    return int(d0.timestamp() * 1000)


# ============================================================ timeline (FORMAT.md shape)
tl("tl-01-tabata", "Tabata template: work 20 / rest 10 x 8, prep 10, countdown 3 (FORMAT.md example total 250 000)",
   tmr("Tabata", [blk([iv("Work", 20), iv("Rest", 10, "rest")], rounds=8)]))
tl("tl-02-hiit", "HIIT 30/15 x 10, halfway on work",
   tmr("HIIT 30/15", [blk([iv("Work", 30, halfway=True), iv("Rest", 15, "rest")], rounds=10)]))
tl("tl-03-emom", "EMOM 10: 'Minute' 60 s x 10 with halfway",
   tmr("EMOM 10", [blk([iv("Minute", 60, halfway=True)], rounds=10)]))
tl("tl-04-boxing", "Boxing 3/1 x 12, halfway on rounds, countdown from 10",
   tmr("Boxing", [blk([iv("Round", 180, halfway=True), iv("Rest", 60, "rest")], rounds=12)]), C10)
tl("tl-06-circuit", "Circuit: 6 stations 45/15, 3 rounds, 60 s rest between rounds",
   tmr("Circuit", [blk(sum(([iv(n, 45, halfway=True), iv("Rest", 15, "rest")] for n in
                            ["Squats", "Push-ups", "Lunges", "Plank", "Burpees", "Climbers"]), []), rounds=3, rest=60)]))
tl("tl-07-stretch", "Stretch 30 s x 10 cooldown, no countdown, prep 5",
   tmr("Stretch", [blk([iv("Stretch", 30, "cooldown", countdown=False)], rounds=10)], prep=5))
tl("tl-08-no-prep", "No prep, one 7 s interval: countdown at 4/5/6 s, end at 7 s",
   tmr("Seven", [blk([iv("Work", 7)])], prep=0))
tl("tl-09-prep-60-cf10", "Prep 60 (limit) with countdown from 10, then one 1 s interval (no countdown fits)",
   tmr("Long prep", [blk([iv("Go", 1)])], prep=60), C10)
tl("tl-10-rest-on-one-round-block", "3 blocks; a 1-round block with rest 45 must not get a round-rest; no round cue for rounds 1",
   tmr("Mixed", [blk([iv("A1", 10), iv("A2", 5, "rest")], rounds=2, rest=30, name="A"),
                 blk([iv("B1", 8)], rounds=1, rest=45, name="B"),
                 blk([iv("C1", 4), iv("C2", 6, "rest"), iv("C3", 3, "cooldown")], rounds=3, rest=5, name="C")]), adv=True)
tl("tl-11-repeat-3", "Repeat whole x 3: prep once, nothing between repeats, round cues restart each repeat",
   tmr("Repeat", [blk([iv("Work", 5), iv("Rest", 3, "rest")], rounds=2, rest=5)], repeat=3))
tl("tl-12-repeat-10", "Repeat whole 10 (limit), no prep, 2 s interval",
   tmr("Repeat max", [blk([iv("Go", 2)])], prep=0, repeat=10), adv=True)
tl("tl-13-rounds-99", "99 rounds (limit) of 1 s with 1 s rest: only start/round cues, 197 segments",
   tmr("Ninety-nine", [blk([iv("Tick", 1)], rounds=99, rest=1)], prep=0), adv=True)
tl("tl-14-30-intervals", "30 intervals (limit) of 1..30 s, all halfway, countdown 5",
   tmr("Thirty", [blk([iv(f"I{n}", n, halfway=True) for n in range(1, 31)])], prep=0), C5, adv=True)
tl("tl-15-20-blocks", "20 blocks (limit), prep 3",
   tmr("Twenty blocks", [blk([iv(f"B{n}", 2 + n % 3)], name=f"Block {n}") for n in range(1, 21)], prep=3), adv=True)
tl("tl-16-total-8h", "Total exactly 8 h (4 x 5999 + 4804 s)",
   tmr("Eight hours", [blk([iv("L1", 5999), iv("L2", 5999), iv("L3", 5999), iv("L4", 5999), iv("Tail", 4804)])],
       prep=0), adv=True)
tl("tl-17-5999-halfway", "One 5999 s interval with halfway (2 999 500 ms) and countdown 10",
   tmr("Max seconds", [blk([iv("Hold", 5999, halfway=True)])], prep=0), C10, adv=True)
tl("tl-18-open-next", "Open interval closed by Next at 42 000, then a 10 s work",
   tmr("Count up", [blk([iv("Count up", 60, "open"), iv("Work", 10)])], prep=0), next_at=[42000])
tl("tl-19-open-stays-open", "Timeline cut at an open interval without Next: totalMs null, no end cue, nothing after",
   tmr("Open end", [blk([iv("Work", 10), iv("Free", 30, "open"), iv("After", 10)])], prep=5), adv=True)
tl("tl-20-open-emom-rest", "Open 60 x 3 rounds with 10 s round-rest, three Nexts",
   tmr("Open EMOM", [blk([iv("Minute", 60, "open")], rounds=3, rest=10)], prep=0), next_at=[61000, 120500, 185000])
tl("tl-21-next-before-start", "Next earlier than the open segment's start: zero-length open segment",
   tmr("Early next", [blk([iv("Work", 10), iv("Free", 20, "open", cue="none"), iv("Work 2", 5)])], prep=0),
   next_at=[5000], adv=True)
tl("tl-22-open-flags-ignored", "Open interval with halfway and countdown flags: both ignored; end after Next",
   tmr("Open flags", [blk([iv("Free", 15, "open", halfway=True, countdown=True)])], prep=0), next_at=[30000], adv=True)
tl("tl-23-two-opens-one-next", "Two open intervals, one Next: the second stays open",
   tmr("Two opens", [blk([iv("A", 5, "open"), iv("B", 5, "open"), iv("Work", 5)])], prep=0), next_at=[20000], adv=True)
tl("tl-24-open-first-in-round", "Open as first interval of each of 2 rounds: round cue at each open start",
   tmr("Open rounds", [blk([iv("Free", 10, "open"), iv("Work", 5)], rounds=2)], prep=0), next_at=[20000, 50000])
tl("tl-25-open-repeat", "Repeat x 2 with an open interval; Next only in repeat 1",
   tmr("Open repeat", [blk([iv("Work", 5), iv("Free", 10, "open")])], prep=0, repeat=2), next_at=[12000], adv=True)
tl("tl-26-next-at-start", "Next exactly at the open start (zero length) between two worked intervals",
   tmr("Next at start", [blk([iv("Work", 4), iv("Free", 10, "open", cue="beep"), iv("Work 2", 4)])], prep=0),
   next_at=[4000], adv=True)
tl("tl-28-cf10-on-3s", "Countdown 10 on 3 s prep and a 3 s interval: 2/1 each",
   tmr("Three", [blk([iv("Work", 3)])], prep=3), C10)
tl("tl-29-halfway-threshold", "Halfway only from 10 s: 9 s none, 10 s at +5000, 11 s at +5500, 13 s at +6500",
   tmr("Halfway", [blk([iv("Nine", 9, halfway=True, countdown=False), iv("Ten", 10, halfway=True, countdown=False),
                        iv("Eleven", 11, halfway=True, countdown=False), iv("Thirteen", 13, halfway=True, countdown=False)])],
       prep=0), adv=True)
tl("tl-30-halfway-meets-cd10", "Countdown 10: 10 s halfway meets '5', 20 s halfway meets '10': both kept, halfway first",
   tmr("Collide", [blk([iv("Ten", 10, halfway=True), iv("Twenty", 20, halfway=True)])], prep=0), C10, adv=True)
tl("tl-32-cue-modes", "cueStart voice/beep/both/none x 2 rounds: none drops only the start cue (round cue stays)",
   tmr("Modes", [blk([iv("None", 4, cue="none"), iv("Voice", 4, cue="voice"), iv("Beep", 4, cue="beep"),
                      iv("Both", 4, cue="both")], rounds=2)], prep=0), adv=True)
tl("tl-33-end-none", "endCue none: no end cue",
   tmr("No end", [blk([iv("Work", 5)])], prep=3, end="none"))
tl("tl-35-prep-rest-always-cd", "Intervals without countdown; prep and round-rest still count down (countdown 5)",
   tmr("Always", [blk([iv("Work", 8, countdown=False), iv("Rest", 6, "rest", countdown=False)], rounds=2, rest=4)],
       prep=4), C5, adv=True)
tl("tl-36-round-rest-no-halfway", "12 s round-rest never gets a halfway cue though the intervals have one",
   tmr("Rest halfway", [blk([iv("Work", 12, halfway=True)], rounds=3, rest=12)], prep=0), adv=True)
tl("tl-38-unicode", "Unicode names: emoji ZWJ, Japanese, Arabic, NFD combining, quotes, commas, backslash",
   tmr("Übung 🏋️‍♀️ \"Tag 1\"", [blk([iv("Kniebeugen 🏋️‍♀️", 12, halfway=True), iv("腕立て伏せ", 11),
                                    iv("تمرين الضغط", 10, "rest"), iv("Ñandú é", 5, "cooldown"),
                                    iv("Jump, \"high\" \\ low", 4), iv("👨‍👩‍👧‍👦 family", 3)],
                                   rounds=2, rest=3, name="ブロック 1")], prep=2), C5, adv=True)
tl("tl-39-names-40", "Names at the 40-character limit (ASCII and Japanese)",
   tmr("A" * 40, [blk([iv("B" * 40, 5), iv("漢" * 40, 5, "rest")], name="C" * 40)], prep=0), adv=True)
tl("tl-40-typed-prep-interval", "An interval of TYPE prep inside a block (halfway on, countdown off)",
   tmr("Typed", [blk([iv("Warm-up", 20, "prep", halfway=True, countdown=False),
                      iv("Breather", 10, "rest", halfway=True)])], prep=0), adv=True)
tl("tl-41-open-tick-not-listed", "openTickS on an open and a work interval: never in the cue list",
   tmr("Ticks", [blk([iv("Free", 30, "open", tick=10), iv("Work", 12, tick=5)])], prep=0), next_at=[33000], adv=True)
tl("tl-42-cf10-on-10s", "Countdown 10 on a 10 s interval: nine cues ('10' would sit on the start)",
   tmr("Ten", [blk([iv("Work", 10)])], prep=0), C10, adv=True)
tl("tl-43-all-ones", "Everything 1 s (prep, intervals, round-rest): no countdown, no halfway anywhere",
   tmr("Ones", [blk([iv("A", 1), iv("B", 1, "rest", halfway=True)], rounds=3, rest=1)], prep=1), adv=True)
tl("tl-44-u3-circuit-repeat", "U3: 3 blocks x 6 stations x 3 rounds, round-rest 60, repeat 2, countdown 5",
   tmr("Big circuit", [blk([iv(f"S{b}{s}", 45 if s % 2 else 15, "work" if s % 2 else "rest", halfway=s % 2 == 1)
                             for s in range(1, 7)], rounds=3, rest=60, name=f"Block {b}") for b in (1, 2, 3)], repeat=2), C5)
tl("tl-45-open-last-closed", "Open as the LAST interval, closed by Next: end cue at the new total",
   tmr("Finisher", [blk([iv("Work", 20), iv("Max reps", 30, "open")], rounds=2, rest=15)], prep=0),
   next_at=[50000, 140000], adv=True)

# ============================================================ cuesBetween (D29.9 catch-up)
CB = tmr("Catch-up", [blk([iv("Work", 20, halfway=True), iv("Rest", 10, "rest")], rounds=2)], prep=5)
add("cuesBetween", "cb-01-basic-windows", "Exclusive from, inclusive to; latest same-ms batch of the current segment",
    {"timer": CB, "settings": C3, "windows": [[-1, 0], [0, 1000], [1000, 4500], [4500, 5000], [4000, 4000]]})
add("cuesBetween", "cb-02-long-gap", "A 47 s gap over 3 segments plays only the latest batch of the current segment",
    {"timer": CB, "settings": C3, "windows": [[5000, 52500], [14000, 30000], [2500, 15000]]}, adv=True)
add("cuesBetween", "cb-03-boundary", "Window ending exactly on a segment start belongs to the new segment",
    {"timer": CB, "settings": C3, "windows": [[24500, 25000], [23500, 24999], [24000, 35000]]}, adv=True)
add("cuesBetween", "cb-04-into-end", "Windows reaching the end: only the end cue (no countdown burst)",
    {"timer": CB, "settings": C3, "windows": [[63500, 65000], [60000, 70000], [64999, 65000]]}, adv=True)
add("cuesBetween", "cb-05-open", "Open timeline: the open segment's batch, no end cue",
    {"timer": tmr("Open CB", [blk([iv("Work", 10), iv("Free", 30, "open")], rounds=2)], prep=0), "settings": C3,
     "windows": [[5000, 500000], [10000, 10000], [9999, 10000]]})
add("cuesBetween", "cb-06-halfway-batch", "A batch holds halfway and countdown '5' at the same ms",
    {"timer": tmr("Ten", [blk([iv("Ten", 10, halfway=True)])], prep=0), "settings": C5,
     "windows": [[4000, 5500], [5000, 5999], [3000, 2000]]}, adv=True)
add("cuesBetween", "cb-07-round-batch", "Round + start at a round boundary arrive together after a gap",
    {"timer": CB, "settings": C3, "windows": [[26000, 36000], [34000, 35000]]})

# ============================================================ runner scripts (SPEC 5.2)
RA = tmr("Run A", [blk([iv("Work", 20, halfway=True), iv("Rest", 10, "rest")], rounds=3)], prep=5)  # total 95 000
RB = tmr("Run B", [blk([iv("Work", 8), iv("Rest", 4, "rest")], rounds=2, rest=6)], prep=0)  # total 30 000
RO = tmr("Run open", [blk([iv("Warm", 10), iv("Free", 60, "open"), iv("Work", 10)])], prep=0)


def run(id, title, t, script, adv=False, readings=()):
    add("runner", id, title, {"timer": t, "settings": C3,
                              "script": [{"t": a, "op": b} for a, b in script]}, adv, readings)


run("rn-01-basic", "start, probes, end early", RA, [(10000, "start"), (17000, "probe"), (40000, "probe"), (50000, "end")])
run("rn-02-pause-accounting", "pause/resume twice: elapsed excludes paused time", RA,
    [(10000, "start"), (22000, "pause"), (60000, "probe"), (70000, "resume"), (75000, "probe"), (80000, "pause"),
     (81000, "resume"), (100000, "probe")])
run("rn-04-back-rule", "back after 3 s restarts the segment; back 1.5 s in goes to the previous", RA,
    [(1000, "start"), (9000, "probe"), (9000, "back"), (10500, "back"), (11000, "probe")])
run("rn-05-back-2000-exact", "back exactly 2000 ms in restarts; 1999 ms in goes back", RA,
    [(0, "start"), (7000, "back"), (8999, "back"), (9000, "probe")], adv=True)
run("rn-07-add-time", "+30 s shifts the rest of the timeline; two +30 s at the same ms add 60 s", RA,
    [(0, "start"), (15000, "addTime"), (60000, "probe"), (61000, "addTime"), (61000, "addTime"), (62000, "probe")], adv=True)
run("rn-08-add-then-back", "+30 s then back: the segment restarts with its extended length", RA,
    [(0, "start"), (10000, "addTime"), (20000, "back"), (21000, "probe")])
run("rn-09-double-actions", "start twice, pause twice, resume twice: second call is a no-op", RA,
    [(0, "start"), (1000, "start"), (2000, "pause"), (3000, "pause"), (4000, "resume"), (5000, "resume"), (6000, "probe")],
    adv=True)
run("rn-10-after-end", "every control after end is ignored", RA,
    [(0, "start"), (30000, "end"), (31000, "resume"), (32000, "skip"), (33000, "back"), (34000, "addTime"),
     (35000, "start"), (36000, "end")], adv=True)
run("rn-11-boundary-pause", "pause exactly on a segment boundary belongs to the next segment", RA,
    [(0, "start"), (5000, "pause"), (9000, "resume"), (29000, "pause"), (30000, "probe")], adv=True)
run("rn-12-end-while-paused", "end while paused keeps the paused elapsed", RA,
    [(0, "start"), (10000, "pause"), (50000, "end")])
run("rn-13-skip-paused", "skip while paused moves and stays paused", RA,
    [(0, "start"), (10000, "pause"), (11000, "skip"), (20000, "probe")])
run("rn-14-skip-to-end", "skipping through every segment; skip on the last ends at the total", RA,
    [(0, "start")] + [(1000 * k, "skip") for k in range(1, 8)])
run("rn-15-runs-out", "probing after the total: the run has ended at the total", RA,
    [(0, "start"), (94000, "probe"), (200000, "probe")])
run("rn-16-open-next", "open interval counts up (no remaining, no total) until Next rebases", RO,
    [(1000, "start"), (31000, "probe"), (51000, "next"), (56000, "probe")])
run("rn-17-open-add-skip", "+30 s on an open interval; skip on an open interval", RO,
    [(0, "start"), (20000, "addTime"), (25000, "skip"), (26000, "probe")])
run("rn-18-back-into-closed-open", "back < 2 s after Next returns to the (now closed) open interval", RO,
    [(0, "start"), (20000, "next"), (21000, "back"), (22000, "probe")], readings=["R8!"])
run("rn-20-odd-ms", "pause/resume at odd milliseconds", RA,
    [(1234, "start"), (5678, "pause"), (9999, "resume"), (12345, "pause"), (20000, "resume"), (33333, "probe")])
run("rn-21-round-rest", "skip into the round-rest, back after 2.7 s restarts it, +30 s on it", RB,
    [(100, "start"), (200, "skip"), (300, "skip"), (2400, "probe"), (3000, "back"), (3500, "addTime")], adv=True)
run("rn-22-double-skip", "two skips at the same ms (screen + notification) move two segments", RA,
    [(0, "start"), (6000, "skip"), (6000, "skip"), (6500, "probe")], adv=True)

# ============================================================ recovery (D13 / D29.10)
RECT = tmr("Recover", [blk([iv("Work", 40), iv("Rest", 20, "rest")], rounds=10)], prep=10)          # 610 000
RECL = tmr("Recover long", [blk([iv("Work", 40), iv("Rest", 20, "rest")], rounds=30)], prep=10)    # 1 810 000
RECO = tmr("Recover open", [blk([iv("Warm", 30), iv("Free", 60, "open"), iv("Work", 30)], rounds=2)], prep=0)
T0 = utc("2026-10-16T18:00:00+00:00")


def rec(id, title, t, state, started, saved, elapsed, now, events=(), adv=False):
    r = {"state": state, "startedAtWallMs": started, "savedAtWallMs": saved, "elapsedMs": elapsed,
         "events": [{"op": o, "atElapsedMs": a} for o, a in events]}
    if state == "running":
        r["baseWallMs"] = saved - elapsed
    add("recovery", id, title, {"timer": t, "settings": C3, "record": r, "nowWallMs": now}, adv)


rec("rc-01-running-mid", "killed at 1:40, relaunch at 4:00 wall: resume at the wall-clock elapsed", RECT,
    "running", T0, T0 + 100000, 100000, T0 + 240000)
rec("rc-02-running-past-end", "relaunch an hour later: finished, completed", RECT,
    "running", T0, T0 + 100000, 100000, T0 + 3600000)
rec("rc-03-running-exact-end", "relaunch exactly at the total: finished", RECT,
    "running", T0, T0 + 100000, 100000, T0 + 610000, adv=True)
rec("rc-04-paused-10min", "paused record, relaunch 10 min later: resume where paused", RECT,
    "paused", T0, T0 + 130000, 125000, T0 + 730000)
rec("rc-05-paused-25h", "paused 25 h: saved as partial", RECT,
    "paused", T0, T0 + 130000, 125000, T0 + 130000 + 25 * 3600000)
rec("rc-06-paused-24h-exact", "paused exactly 24 h", RECT,
    "paused", T0, T0 + 130000, 125000, T0 + 130000 + 24 * 3600000, adv=True)
rec("rc-07-ended", "ended record: nothing to offer", RECT, "ended", T0, T0 + 610000, 610000, T0 + 700000)
rec("rc-08-clock-back", "wall clock set back 10 min after the save", RECT,
    "running", T0, T0 + 100000, 100000, T0 - 500000, adv=True)
rec("rc-09-dst-spring", "Berlin DST spring-forward between save and relaunch (15 min real, 75 min on the local clock)", RECL,
    "running", local("Europe/Berlin", "2026-03-29T01:50:00"), local("Europe/Berlin", "2026-03-29T01:55:00"), 300000,
    local("Europe/Berlin", "2026-03-29T03:05:00"), adv=True)
rec("rc-10-dst-fall", "New York DST fall-back: local clock reads earlier at relaunch, 30 min really passed", RECL,
    "running", utc("2026-11-01T05:40:00+00:00"), utc("2026-11-01T05:45:00+00:00"), 300000,
    utc("2026-11-01T06:10:00+00:00"), adv=True)
rec("rc-11-replay-add", "+30 s event replayed before locating the segment", RECT,
    "running", T0, T0 + 30000, 30000, T0 + 85000, events=[("addTime", 20000)], adv=True)
rec("rc-12-open-resume", "open-ended run (Next replayed) relaunched after 18 min: resume in the second open interval", RECO,
    "running", T0, T0 + 130000, 130000, T0 + 1200000, events=[("next", 100000)])
rec("rc-13-open-stale", "open-ended run older than 2 h: partial", RECO,
    "running", T0, T0 + 180000, 180000, T0 + 3 * 3600000, events=[("next", 100000)])
rec("rc-14-open-closed-finished", "both opens closed by replayed Nexts, relaunch after the end: finished", RECO,
    "running", T0, T0 + 230000, 230000, T0 + 900000, events=[("next", 100000), ("next", 220000)], adv=True)

# ============================================================ validation (SPEC 5.3 + SS4)
def V(blocks, prep=10, repeat=1, name="Valid"):
    return tmr(name, blocks, prep=prep, repeat=repeat)


TAB = [blk([iv("Work", 20), iv("Rest", 10, "rest")], rounds=8)]
add("validation", "va-01-tabata", "valid Tabata", {"timer": V(TAB)})
add("validation", "va-02-seconds-0", "interval of 0 s", {"timer": V([blk([iv("Work", 0)])])}, adv=True)
add("validation", "va-03-seconds-6000", "interval of 6000 s", {"timer": V([blk([iv("Work", 6000)])])})
add("validation", "va-04-seconds-edges", "1 s and 5999 s are valid", {"timer": V([blk([iv("A", 1), iv("B", 5999)])])})
add("validation", "va-05-rounds-0", "rounds 0", {"timer": V([blk([iv("Work", 20)], rounds=0)])}, adv=True)
add("validation", "va-06-rounds-100", "rounds 100", {"timer": V([blk([iv("Work", 20)], rounds=100)])})
add("validation", "va-08-21-blocks", "21 blocks", {"timer": V([blk([iv("W", 5)]) for _ in range(21)])})
add("validation", "va-09-20-blocks", "20 blocks valid", {"timer": V([blk([iv("W", 5)]) for _ in range(20)])})
add("validation", "va-10-31-intervals", "31 intervals in one block", {"timer": V([blk([iv("W", 5)] * 31)])})
add("validation", "va-11-30-intervals", "30 intervals x 2 blocks valid (limit is per block)",
    {"timer": V([blk([iv("W", 5)] * 30), blk([iv("X", 5)] * 30)])}, adv=True)
add("validation", "va-13-block-name-41", "block name 41 characters",
    {"timer": V([blk([iv("Work", 20)], name="b" * 41)])}, adv=True)
add("validation", "va-14-total-8h", "total exactly 8 h incl. prep 10 is valid",
    {"timer": V([blk([iv("L", 5999)] * 4 + [iv("T", 4794)])], prep=10)}, adv=True)
add("validation", "va-15-total-8h-1s", "total 8 h + 1 s", {"timer": V([blk([iv("L", 5999)] * 4 + [iv("T", 4805)])], prep=0)})
add("validation", "va-16-prep-pushes-over", "8 h of intervals + prep 1 s is over the limit",
    {"timer": V([blk([iv("L", 5999)] * 4 + [iv("T", 4804)])], prep=1)}, adv=True)
add("validation", "va-17-repeat-pushes-over", "2 h timer x repeat 5 = 10 h",
    {"timer": V([blk([iv("Long", 3600)], rounds=2)], prep=0, repeat=5)}, adv=True)
add("validation", "va-18-round-rest-pushes-over", "99 rounds x 290 s + 98 x 5 s round-rest > 8 h, without rests < 8 h",
    {"timer": V([blk([iv("W", 290)], rounds=99, rest=5)], prep=0)}, adv=True)
add("validation", "va-19-emoji-40", "timer name of 40 emoji (40 code points, 80 UTF-16 units)",
    {"timer": V(TAB, name="😀" * 40)}, adv=True)
add("validation", "va-20-japanese-41", "interval name of 41 Japanese characters",
    {"timer": V([blk([iv("漢" * 41, 20)])])})
add("validation", "va-21-combining", "interval name of 40 user-perceived characters, 41 code points (NFD e+acute)",
    {"timer": V([blk([iv("e" * 38 + "é" + "x", 20)])])}, adv=True)
add("validation", "va-22-fraction", "2.5 s interval", {"timer": V([blk([iv("Work", 2.5)])])}, adv=True)

# ============================================================ format (SPEC 5.4)
for n, (secs, lang, adv) in enumerate([(0, "en", False), (59, "en", False), (599, "en", True),
                                       (3600, "en", True), (5999, "en", False), (28800, "de", False),
                                       (754, "ar", True), (3725, "hi", False)], 1):
    add("format", f"fm-{n:02d}-duration-{secs}-{lang}", f"duration {secs} s in {lang}",
        {"op": "duration", "seconds": secs, "lang": lang}, adv)
add("format", "fm-11-block-circuit", "block total: 6 stations 45/15 x 3 rounds + 2 x 60 s round-rest",
    {"op": "blockTotal", "block": blk(sum(([iv(f"S{k}", 45), iv("Rest", 15, "rest")] for k in range(6)), []),
                                      rounds=3, rest=60)})
add("format", "fm-12-block-one-round-rest", "block total: 1 round with rest 45 (never used)",
    {"op": "blockTotal", "block": blk([iv("A", 50), iv("B", 25)], rounds=1, rest=45)}, adv=True)
add("format", "fm-13-timer-tabata", "timer total Tabata incl. prep", {"op": "timerTotal", "timer": tmr("Tabata", TAB)})
add("format", "fm-14-timer-repeat", "timer total with repeat 3, two blocks, round-rest, prep 7",
    {"op": "timerTotal", "timer": tmr("Mix", [blk([iv("W", 33), iv("R", 17, "rest")], rounds=4, rest=11),
                                              blk([iv("X", 61)])], prep=7, repeat=3)}, adv=True)

def b64u(text):
    return base64.urlsafe_b64encode(text.encode("utf-8")).decode("ascii").rstrip("=")


HOSTILE_LINKS = [
    "plainintervals://t?d=",                                   # empty payload
    "plainintervals://t?d=!!**not~base64**!!",                 # not base64url
    "plainintervals://t?d=" + b64u("not json at all"),         # not JSON
    "plainintervals://t?d=" + b64u("[]"),                      # JSON array
    "plainintervals://t?d=" + b64u("null"),                    # JSON null
    "plainintervals://t?d=" + b64u("{}"),                      # object without a timer
    "plainintervals://t?d=" + b64u('{"__proto__": {"polluted": 1}}'),
    "plainintervals://t?d=" + "A" * 200000,                    # 200 kB of zero bytes
    "plainintervals://t?d=" + b64u("[" * 5000 + "]" * 5000),   # deep nesting
    "plainintervals://t?d=" + b64u('{"name": "x", "blocks": "' + "y" * 1000 + '"'),  # truncated JSON
]

# ============================================================ share codec (SPEC 5.5, D19)
FULL = tmr("Every field", [
    blk([iv("Prep-ish", 15, "prep", cue="voice", halfway=False, countdown=False, color="#112233"),
         iv("Work", 20, "work", cue="beep", halfway=True, countdown=True, color=""),
         iv("Rest", 10, "rest", cue="none", halfway=False, countdown=True),
         iv("Cool", 30, "cooldown", cue="both", halfway=True, countdown=False, color="#FFFFFF"),
         iv("Open", 60, "open", cue="both", tick=15)], rounds=3, rest=25, name="Main")],
    prep=0, end="none", repeat=10, vibrate=False, color="#00897B")
UNI = tmr("Übung 🏋️‍♀️ \"Tag\" \\ 1", [blk([iv("腕立て伏せ", 11), iv("تمرين الضغط", 10, "rest"),
                                        iv("Ñandú", 5, "cooldown"), iv("👨‍👩‍👧‍👦 <&> %20 ?d=", 3)],
                                       rounds=2, rest=3, name="ブロック 1 / Блок")], prep=2)
add("share", "sh-01-tabata", "round trip Tabata (link + file)", {"op": "roundtrip", "timer": tmr("Tabata", TAB)})
add("share", "sh-02-unicode", "round trip Unicode names (UTF-8 inside base64url; URL-like characters)",
    {"op": "roundtrip", "timer": UNI}, adv=True)
add("share", "sh-03-every-field", "round trip every enum value and non-default prefs (a compact codec must not drop defaults)",
    {"op": "roundtrip", "timer": FULL}, adv=True)
add("share", "sh-04-big", "round trip 20 blocks x 5 intervals with 40-character names",
    {"op": "roundtrip", "timer": tmr("Z" * 40, [blk([iv(f"{b:02d}-{k}-" + "n" * 35, 5 + k) for k in range(5)],
                                                   rounds=2, rest=1, name="B" * 40) for b in range(20)], prep=0)}, adv=True)
add("share", "sh-05-notes", "round trip with notes", {"op": "roundtrip", "compareNotes": True,
                                                      "timer": tmr("Noted", TAB, notes="Knee 🦵 easy, \"slow\"")})
add("share", "sh-06-unknown-field", "unknown top-level field in the decoded JSON is ignored",
    {"op": "unknownField", "timer": UNI}, adv=True)
add("share", "sh-07-tamper-seconds", "decoded JSON edited: 4321 s -> 6001 s must be refused",
    {"op": "tamper", "find": "4321", "replace": "6001",
     "timer": tmr("Tamper", [blk([iv("Work", 4321), iv("Rest", 15, "rest")])], color="#ABCDEF")}, adv=True)
add("share", "sh-08-tamper-name", "decoded JSON edited: 40-character name -> 41 must be refused",
    {"op": "tamper", "find": "Q" * 40, "replace": "Q" * 41,
     "timer": tmr("Q" * 40, [blk([iv("Work", 20)])], color="#ABCDEF")}, adv=True)
add("share", "sh-09-tamper-total", "decoded JSON edited so that the total exceeds 8 h (each field still in range)",
    {"op": "tamper", "find": "4321", "replace": "5999",
     "timer": tmr("Tamper total", [blk([iv("L", 5999)] * 4 + [iv("T", 4321)])], prep=0, color="#ABCDEF")}, adv=True)
add("share", "sh-10-tamper-rounds", "decoded JSON edited: rounds 97 -> 100 must be refused",
    {"op": "tamper", "find": "97", "replace": "100",
     "timer": tmr("Tamper rounds", [blk([iv("Work", 20), iv("Rest", 10, "rest")], rounds=97)], color="#ABCDEF")})
add("share", "sh-11-hostile-links", "hostile links: empty, non-base64url, non-JSON, JSON array/null/{}, huge, deep nesting",
    {"op": "import", "links": HOSTILE_LINKS}, adv=True)

# ============================================================ stats (SPEC 5.7)
def ses(name, start, actual, planned=None, completed=True, note="", skipped=0, pauses=0):
    return {"timerName": name, "startedAt": start, "endedAt": start + actual * 1000, "plannedS": planned,
            "actualS": actual, "completed": completed, "skippedIntervals": skipped, "pauses": pauses, "note": note}


def stats(id, title, zone, now_iso, sessions, adv=False):
    add("stats", id, title, {"zone": zone, "nowMs": local(zone, now_iso), "sessions": sessions}, adv)


B = "Europe/Berlin"
stats("st-01-basic", "3 consecutive days ending today; totals, planned vs actual", B, "2026-10-16T20:00:00", [
    ses("Tabata", local(B, "2026-10-14T07:00:00"), 250, 250),
    ses("Tabata", local(B, "2026-10-15T07:00:00"), 250, 250),
    ses("Walk/Run", local(B, "2026-10-15T19:00:00"), 120, 900, completed=False),
    ses("HIIT", local(B, "2026-10-16T18:00:00"), 460, 460)])
stats("st-02-dst-spring", "Berlin spring-forward: 23-hour day inside a 3-day streak", B, "2026-03-30T12:00:00", [
    ses("Run", local(B, "2026-03-28T00:30:00"), 600, 600),
    ses("Run", local(B, "2026-03-29T00:30:00"), 600, 600),
    ses("Run", local(B, "2026-03-29T23:30:00"), 600, 600),
    ses("Box", local(B, "2026-03-30T01:30:00"), 900, 900)], adv=True)
NY = "America/New_York"
stats("st-03-dst-fall", "New York fall-back: 25-hour day; 23:30 sessions on consecutive days", NY, "2026-11-02T23:50:00", [
    ses("Row", local(NY, "2026-10-31T23:30:00"), 1200, 1200),
    ses("Row", local(NY, "2026-11-01T00:30:00"), 300, 300),
    ses("Row", local(NY, "2026-11-01T23:30:00"), 1200, 1200),
    ses("Lift", local(NY, "2026-11-02T23:30:00"), 1500, 1500)], adv=True)
stats("st-04-iso-week-53", "ISO week 2026-W53 spans the new year (Mon 28 Dec .. Sun 3 Jan)", B, "2027-01-04T20:00:00", [
    ses("A", local(B, "2026-12-28T09:00:00"), 100, 100), ses("A", local(B, "2026-12-31T09:00:00"), 100, 100),
    ses("A", local(B, "2027-01-01T09:00:00"), 100, 100), ses("B", local(B, "2027-01-03T09:00:00"), 100, 100),
    ses("A", local(B, "2027-01-04T09:00:00"), 100, 100)], adv=True)
stats("st-05-iso-week-years", "30 Dec 2024 is 2025-W01; 3 Jan 2021 is 2020-W53", "UTC", "2025-01-01T12:00:00", [
    ses("X", local("UTC", "2021-01-03T12:00:00"), 60, 60), ses("X", local("UTC", "2024-12-29T12:00:00"), 60, 60),
    ses("Y", local("UTC", "2024-12-30T12:00:00"), 60, 60)], adv=True)
KIR_SES = [ses("Early", utc("2026-10-15T09:30:00+00:00"), 400, 400), ses("Early", utc("2026-10-15T10:30:00+00:00"), 400, 400),
           ses("Late", utc("2026-10-16T09:00:00+00:00"), 500, 500)]
stats("st-06-kiritimati", "UTC+14: 09:30Z and 10:30Z on the same UTC day fall on different local days",
      "Pacific/Kiritimati", "2026-10-16T23:50:00", KIR_SES, adv=True)
stats("st-07-pago-pago", "Same sessions in UTC-11", "Pacific/Pago_Pago", "2026-10-15T23:00:00", KIR_SES, adv=True)
K = "Asia/Kathmandu"
stats("st-08-kathmandu", "UTC+5:45: 23:59 and 00:01 local are different days; streak 2", K, "2026-10-16T08:00:00", [
    ses("Yoga", utc("2026-10-15T18:14:00+00:00"), 30, 30), ses("Yoga", utc("2026-10-15T18:16:00+00:00"), 900, 900)],
    adv=True)
LH = "Australia/Lord_Howe"
stats("st-09-lord-howe", "Lord Howe 30-minute DST change (4 Oct 2026); streak and month boundary", LH, "2026-10-05T10:00:00", [
    ses("Swim", local(LH, "2026-09-30T23:45:00"), 600, 600), ses("Swim", local(LH, "2026-10-01T00:15:00"), 1000, 1000),
    ses("Swim", local(LH, "2026-10-02T06:00:00"), 1000, 1000), ses("Swim", local(LH, "2026-10-03T06:00:00"), 1000, 1000),
    ses("Swim", local(LH, "2026-10-04T03:00:00"), 1000, 1000), ses("Swim", local(LH, "2026-10-05T06:00:00"), 1000, 1000)],
    adv=True)
stats("st-10-gap-streaks", "today + yesterday current 2, an older 5-day run is the longest", B, "2026-10-16T21:00:00",
      [ses("Tabata", local(B, f"2026-10-{d:02d}T19:00:00"), 250, 250) for d in (2, 3, 4, 5, 6, 9, 15, 16)] +
      [ses("HIIT", local(B, "2026-10-06T07:00:00"), 460, 460)])
stats("st-11-planned-null", "open-interval sessions have no planned time; most used by count", NY, "2026-10-16T12:00:00", [
    ses("EMOM", local(NY, "2026-10-16T06:00:00"), 615, None), ses("EMOM", local(NY, "2026-10-15T06:00:00"), 600, None),
    ses("Tabata", local(NY, "2026-10-14T06:00:00"), 250, 250), ses("EMOM", local(NY, "2026-10-01T06:00:00"), 590, 600)])
stats("st-12-yesterday-only", "last session yesterday, none yet today", B, "2026-10-16T08:00:00", [
    ses("Tabata", local(B, "2026-10-14T19:00:00"), 250, 250), ses("Tabata", local(B, "2026-10-15T19:00:00"), 250, 250)])
stats("st-13-midnight-crossing", "a session that starts 23:50 and ends 00:20; an ended-early session alone on a day", B,
      "2026-10-16T20:00:00", [ses("Long", local(B, "2026-10-14T23:50:00"), 1800, 1800),
                              ses("Long", local(B, "2026-10-14T07:00:00"), 1800, 1800),
                              ses("Short", local(B, "2026-10-16T07:00:00"), 60, 600, completed=False)])

# ============================================================ CSV (SPEC 5.6, RFC 4180 + formula guard)
def csvc(id, title, rows, adv=False):
    T = utc("2026-10-10T07:00:00+00:00")
    add("csv", id, title, {"sessions": [ses(n, T + k * 86400000, 250 + k, 250, note=note) for k, (n, note) in enumerate(rows)]}, adv)


csvc("cv-01-plain", "plain rows", [("Tabata", ""), ("HIIT 30/15", "good"), ("Walk/Run", "legs heavy")])
csvc("cv-02-guard", "formula lead characters = + - @ TAB CR in names and notes", [
    ("=HYPERLINK(\"http://x\")", "=SUM(A1:A9)"), ("+30s drill", "+1 call"), ("-plank", "-5 kg"), ("@home", "@gym"),
    ("Tabata", "\tTabbed"), ("HIIT", "\rCR first")], adv=True)
csvc("cv-03-quoting", "commas, quotes, CRLF/LF/CR inside a note, leading and trailing spaces", [
    ("Box, 3/1", "a, b"), ("\"Quoted\"", "she said \"go\""), ("Multi", "line 1\r\nline 2\nline 3\rline 4"),
    ("Spaces", "  padded  ")], adv=True)
csvc("cv-04-unicode", "emoji, Arabic, Japanese, RTL mark, NFD", [
    ("Übung 🏋️‍♀️", "👨‍👩‍👧‍👦"), ("تمرين", "‏ملاحظة"), ("腕立て伏せ", "é")])
csvc("cv-05-guard-and-quote", "formula characters together with commas and quotes", [
    ("=1,2", "-\"x\",y"), ("@\"a\"", "+\n=")], adv=True)
csvc("cv-06-no-false-guard", "not guarded: '=' and '@' inside, digits, apostrophe, empty", [
    ("a=b", "1+1"), ("x@y", "'already"), ("Tabata", ""), ("100%", "x-y")], adv=True)

# ============================================================ backup (SPEC 5.6, U10)
BT = [tmr("Tabata", TAB), UNI, tmr("Physio", [blk([iv("Left", 30), iv("Right", 30)], rounds=3, name="Sides")], prep=5)]
BS = [ses("Tabata", utc("2026-10-10T07:00:00+00:00"), 250, 250),
      ses("Übung 🏋️‍♀️ \"Tag\" \\ 1", utc("2026-10-11T07:00:00+00:00"), 200, 212, completed=False, note="knee, \"ok\"", skipped=2, pauses=1),
      ses("Physio", utc("2026-10-12T07:00:00+00:00"), 185, 185, note="=not a formula"),
      ses("Deleted timer", utc("2026-10-13T07:00:00+00:00"), 90, None, note="timer deleted later")]
EDIT0 = tmr("Tabata", [blk([iv("Work", 25), iv("Rest", 5, "rest")], rounds=8)])
EDIT1 = tmr("Übung edited", [blk([iv("Only", 40)])], prep=0)
EDIT2 = tmr("Physio", [blk([iv("Left", 45), iv("Right", 45)], rounds=2, name="Sides")], prep=5)
NEWT = tmr("Added later", [blk([iv("New", 12)])], prep=0)
NEWS = ses("Added later", utc("2026-10-15T07:00:00+00:00"), 12, 12)
add("backup", "bk-01-fresh-roundtrip", "U10: backup -> restore on a fresh install: timers and history identical",
    {"initial": {"timers": BT, "sessions": BS}, "mode": "replace", "fresh": True}, adv=True)
add("backup", "bk-02-fresh-settings", "fresh install restore also brings the settings back",
    {"initial": {"timers": BT[:1], "sessions": BS[:1]}, "mode": "replace", "fresh": True,
     "settings": {"countdown_from": 5, "language": "de", "halfway_default": True, "keep_screen_on": False}})
add("backup", "bk-03-replace", "replace: edits reverted, deleted re-added, later additions kept, sessions merged by id",
    {"initial": {"timers": BT, "sessions": BS}, "mode": "replace",
     "mutations": [{"op": "editTimer", "ref": 0, "timer": EDIT0}, {"op": "deleteTimer", "ref": 1},
                   {"op": "addTimer", "timer": NEWT}, {"op": "deleteSession", "ref": 3},
                   {"op": "addSession", "session": NEWS}]}, adv=True)
add("backup", "bk-04-keep-both", "keep both: every changed timer exists twice (current + backup copy), deleted ones return",
    {"initial": {"timers": BT, "sessions": BS[:2]}, "mode": "keepBoth",
     "mutations": [{"op": "editTimer", "ref": 0, "timer": EDIT0}, {"op": "editTimer", "ref": 1, "timer": EDIT1},
                   {"op": "deleteTimer", "ref": 2}, {"op": "addTimer", "timer": NEWT},
                   {"op": "deleteSession", "ref": 0}, {"op": "deleteSession", "ref": 1},
                   {"op": "addSession", "session": NEWS}]}, adv=True)
add("backup", "bk-05-keep-both-unchanged", "keep both with one timer unchanged since the backup",
    {"initial": {"timers": BT, "sessions": []}, "mode": "keepBoth",
     "mutations": [{"op": "editTimer", "ref": 0, "timer": EDIT0}, {"op": "editTimer", "ref": 1, "timer": EDIT1}]})
add("backup", "bk-06-truncated", "restore of a backup cut in half: refused, database unchanged",
    {"initial": {"timers": BT, "sessions": BS}, "hostile": {"kind": "truncate-half"}, "mode": "replace",
     "mutations": [{"op": "editTimer", "ref": 2, "timer": EDIT2}]}, adv=True)
add("backup", "bk-07-not-json", "restore of non-JSON text: refused, database unchanged",
    {"initial": {"timers": BT[:2], "sessions": BS[:2]}, "hostile": {"kind": "raw", "text": "{\"timers\": ["}, "mode": "keepBoth"}, adv=True)
add("backup", "bk-08-null", "restore of the JSON value null: refused, database unchanged",
    {"initial": {"timers": BT[:1], "sessions": []}, "hostile": {"kind": "raw", "text": "null"}, "mode": "replace"})
