"""Hand-written INPUTS of blind set B2. No expected values here: build_set.py derives all of them with b2_oracle.py.

Each case: id, family, adversarial (bool), ambiguous (None or an ambiguity id from README), why (one line), input keys.
"""

import datetime
import zoneinfo


# ------------------------------------------------------------------ builders (FORMAT.md timer shape)
def iv(name, seconds, type="work", cue="both", hw=False, cd=True, color="", tick=0):
    return {"name": name, "seconds": seconds, "type": type, "color": color, "cueStart": cue,
            "halfwayCue": hw, "countdownCue": cd, "openTickS": tick}


def blk(intervals, rounds=1, rest=0, name=""):
    return {"name": name, "rounds": rounds, "restBetweenRoundsS": rest, "intervals": intervals}


def tmr(name, blocks, prep=10, end="both", rep=1, color="#1565C0", notes="", vibrate=True):
    return {"name": name, "color": color, "notes": notes, "blocks": blocks,
            "prefs": {"prepSeconds": prep, "endCue": end, "repeatWhole": rep, "vibrate": vibrate}}


def wall(s, tz="UTC"):
    """Local 'YYYY-MM-DD HH:MM' in tz -> epoch ms (only used to WRITE inputs; expected keys come from the oracle)."""
    d = datetime.datetime.strptime(s, "%Y-%m-%d %H:%M").replace(tzinfo=zoneinfo.ZoneInfo(tz))
    return int(d.timestamp() * 1000)


CASES = []


def add(cid, family, why, adversarial=False, ambiguous=None, **kw):
    c = {"id": cid, "family": family, "adversarial": adversarial, "ambiguous": ambiguous, "why": why}
    c.update(kw)
    CASES.append(c)


S3 = {"countdownFrom": 3}
S5 = {"countdownFrom": 5}
S10 = {"countdownFrom": 10}

# ================================================================== tl: timelines (FORMAT.md)
W, R = "work", "rest"
add("tl-01", "timeline", "Tabata 20/10 x 8 as SPEC 4 describes it, default prep 10",
    timer=tmr("Tabata", [blk([iv("Work", 20), iv("Rest", 10, R)], rounds=8)]), settings=S3)
add("tl-02", "timeline", "countdown 10 on a 10 s interval: no '10' at the start, halfway collides with '5'", True,
    timer=tmr("Ten", [blk([iv("Hold", 10, hw=True)])], prep=0), settings=S10)
add("tl-03", "timeline", "countdown 5 on 3 s intervals gives only '2','1' each round", True,
    timer=tmr("Short", [blk([iv("Jab", 3), iv("Duck", 3, R)], rounds=3)], prep=0), settings=S5)
add("tl-04", "timeline", "1 s intervals with countdown: no countdown cue at all, round cues still", True,
    timer=tmr("Ones", [blk([iv("Tap", 1)], rounds=5)], prep=0), settings=S3)
add("tl-06", "timeline", "halfway at odd seconds (11 -> 5500), none at 9 s, at 10 s and 13 s", True,
    timer=tmr("Halves", [blk([iv("A", 11, hw=True), iv("B", 9, hw=True), iv("C", 10, hw=True, cd=False),
                              iv("D", 13, hw=True)])], prep=3), settings=S3)
add("tl-07", "timeline", "single 5999 s interval with halfway and countdown 10",
    timer=tmr("Long hold", [blk([iv("Plank forever", 5999, hw=True)])], prep=10), settings=S10)
add("tl-08", "timeline", "D32: block interval TYPED prep with halfway on, countdown off, voice start", True,
    timer=tmr("Typed prep", [blk([iv("Warm-up", 20, "prep", cue="voice", hw=True, cd=False), iv("Go", 30)])],
              prep=0), settings=S3)
add("tl-09", "timeline", "D32: typed prep with start none + timer-level prep segment before it", True,
    timer=tmr("Two preps", [blk([iv("Mobilise", 15, "prep", cue="none", cd=True), iv("Work", 20, hw=True)])],
              prep=5), settings=S3)
add("tl-10", "timeline", "timer-level prep 60 s with countdown 10: no halfway on prep",
    timer=tmr("Prep60", [blk([iv("Row", 40)])], prep=60), settings=S10)
add("tl-11", "timeline", "prep 1 s: no prep countdown cue (only strictly after start)", True,
    timer=tmr("Prep1", [blk([iv("Go", 5)])], prep=1), settings=S3)
add("tl-12", "timeline", "prep 2 s with countdown 5: only '1'", True,
    timer=tmr("Prep2", [blk([iv("Go", 6)])], prep=2), settings=S5)
add("tl-13", "timeline", "rest between rounds 15 s: always countdown, never halfway, label Rest", True,
    timer=tmr("Round rest", [blk([iv("Squat", 30, cd=False), iv("Lunge", 30, cd=False)], rounds=3, rest=15)],
              prep=0), settings=S3)
add("tl-14", "timeline", "rest between rounds 1 s: start cue only", True,
    timer=tmr("Tiny rest", [blk([iv("Burpee", 8)], rounds=3, rest=1)], prep=0), settings=S3)
add("tl-15", "timeline", "rest between rounds 4 s with countdown 5 -> 3,2,1",
    timer=tmr("Rest4", [blk([iv("Pull", 12, hw=True)], rounds=2, rest=4)], prep=0), settings=S5)
circuit = [blk([iv("Station %d.%d" % (b + 1, s + 1), 45, hw=True) if k == 0 else iv("Move", 15, R)
                for s in range(6) for k in range(2)], rounds=3, rest=60, name="Block %d" % (b + 1))
           for b in range(3)]
add("tl-16", "timeline", "long circuit: 3 blocks x 6 stations (45/15) x 3 rounds, 60 s between rounds", True,
    timer=tmr("Big circuit", circuit, prep=10), settings=S5)
add("tl-17", "timeline", "repeat whole 3 with prep once, round cues restart per repeat, rest only between rounds",
    True, timer=tmr("Repeat3", [blk([iv("Work", 20), iv("Rest", 10, R)], rounds=2, rest=20),
                               blk([iv("Core", 25, hw=True)])], prep=10, rep=3), settings=S3)
add("tl-18", "timeline", "repeat whole 10 (maximum) of a tiny timer",
    timer=tmr("Repeat10", [blk([iv("Up", 4), iv("Down", 3, R)])], prep=0, rep=10), settings=S3)
open_core = [iv("Warm-up", 30, hw=True), iv("AMRAP", 60, "open", cue="voice", tick=15), iv("Cool", 20, "cooldown")]
add("tl-19", "timeline", "open interval without Next: cut, totalMs null, no end cue, nothing after it", True,
    timer=tmr("Open cut", [blk(list(open_core))], prep=5), settings=S3)
add("tl-20", "timeline", "open interval closed by Next at 100000: timeline continues, end at new total",
    timer=tmr("Open next", [blk(list(open_core))], prep=5), settings=S3, nextAt=[100000])
add("tl-21", "timeline", "Next before the open start: zero-length open segment, two start cues at one ms", True,
    "A3", timer=tmr("Open early", [blk(list(open_core))], prep=5), settings=S3, nextAt=[5000])
add("tl-22", "timeline", "two open intervals, one Next: cut at the second open", True,
    timer=tmr("Two opens", [blk([iv("Max reps", 1, "open", tick=10), iv("Rest", 30, R),
                                 iv("Max reps again", 1, "open"), iv("Stretch", 30, "cooldown")])], prep=0),
    settings=S3, nextAt=[42000])
add("tl-23", "timeline", "open interval in a 3-round block with rest between rounds, one Next per round", True,
    timer=tmr("Open rounds", [blk([iv("Set", 30, "open", tick=20), iv("Breathe", 20, R)], rounds=3, rest=10)],
              prep=10), settings=S3, nextAt=[55000, 120000, 200000])
add("tl-24", "timeline", "open interval with halfway and countdown flags on: both ignored", True,
    timer=tmr("Open flags", [blk([iv("Hold", 40, "open", hw=True, cd=True), iv("Release", 10)])], prep=0),
    settings=S5, nextAt=[33000])
add("tl-25", "timeline", "open first segment, prep 0, Next at 0: zero-length segment at 0", True, "A3",
    timer=tmr("Open zero", [blk([iv("Ready?", 5, "open"), iv("Go", 10)], rounds=2)], prep=0), settings=S3,
    nextAt=[0, 15000])
add("tl-26", "timeline", "end cue none: no end cue",
    timer=tmr("Silent end", [blk([iv("Work", 15), iv("Rest", 5, R)], rounds=2)], prep=0, end="none"), settings=S3)
add("tl-27", "timeline", "every interval start none in a 4-round block: round cues only", True, "A2",
    timer=tmr("Quiet", [blk([iv("Work", 12, cue="none"), iv("Rest", 6, R, cue="none")], rounds=4)], prep=0),
    settings=S3)
add("tl-28", "timeline", "non-Latin interval names are spoken verbatim",
    timer=tmr("Mundo", [blk([iv("スクワット", 20), iv("راحة", 10, R), iv("आराम करो", 10, R),
                             iv("Unterarm-Übung", 15)], rounds=2)], prep=0), settings=S3)
add("tl-29", "timeline", "emoji / ZWJ names verbatim in labels and start texts", True,
    timer=tmr("Emoji", [blk([iv("🏃‍♀️ Sprint", 25, hw=True), iv("👨‍👩‍👧‍👦", 10, R)])], prep=0), settings=S3)
add("tl-30", "timeline", "interval names that look like cue texts ('Round 1 of 2', '3', 'Halfway', 'Done')", True,
    timer=tmr("Confusing", [blk([iv("Round 1 of 2", 10, hw=True), iv("3", 4, R), iv("Halfway", 5),
                                 iv("Done", 3, "cooldown")], rounds=2)], prep=0), settings=S3)
maxb = [blk([iv("I%d-%d" % (b, i), (i % 5) + 1) for i in range(30)], name="B%d" % b) for b in range(20)]
add("tl-31", "timeline", "maximum structure: 20 blocks x 30 intervals of 1-5 s", True,
    timer=tmr("Max", maxb, prep=0), settings=S3)
add("tl-32", "timeline", "rounds 99 with 2 s rest between rounds", True,
    timer=tmr("Ninety-nine", [blk([iv("Work", 5), iv("Rest", 3, R)], rounds=99, rest=2)], prep=0), settings=S3)
add("tl-33", "timeline", "countdown 10 on an 11 s interval with halfway: '10' at +1000, halfway 5500", True,
    timer=tmr("Eleven", [blk([iv("Hang", 11, hw=True)], rounds=2)], prep=0), settings=S10)
add("tl-34", "timeline", "rounds 1 with rest between rounds 30: no rest segment, no round cue", True,
    timer=tmr("No rest", [blk([iv("Work", 20), iv("Rest", 10, R)], rounds=1, rest=30)], prep=0), settings=S3)
add("tl-36", "timeline", "mixed blocks: rounds 1 / 4 with rest / 2", True,
    timer=tmr("Mixed", [blk([iv("Jog", 30), iv("Skip", 20), iv("Hop", 10, hw=True)]),
                        blk([iv("Push", 40, hw=True), iv("Rest", 20, R)], rounds=4, rest=20),
                        blk([iv("Stretch", 30, "cooldown", cd=False)], rounds=2)], prep=10), settings=S3)
add("tl-37", "timeline", "openTickS on a non-open interval is ignored; cooldown halfway",
    timer=tmr("Ticks ignored", [blk([iv("Work", 20, tick=5), iv("Cool", 60, "cooldown", hw=True)])], prep=0),
    settings=S3)
add("tl-38", "timeline", "countdown 5 on 5 s and 6 s intervals", True,
    timer=tmr("Fives", [blk([iv("Five", 5), iv("Six", 6), iv("Seven", 7, cd=False)], rounds=2)], prep=0),
    settings=S5)
add("tl-39", "timeline", "boxing 3/1 x 12, halfway on rounds, countdown 10",
    timer=tmr("Boxing", [blk([iv("Round", 180, hw=True), iv("Rest", 60, R)], rounds=12)], prep=10), settings=S10)
add("tl-40", "timeline", "typed prep at the start of a 15-round block gets the round cue first", True,
    timer=tmr("Walk run", [blk([iv("Get set", 10, "prep", cue="voice", cd=True), iv("Run", 60, hw=True),
                                iv("Walk", 60, R)], rounds=15)], prep=0), settings=S3)
add("tl-41", "timeline", "repeat whole 2 with an open interval, one Next per repeat", True,
    timer=tmr("Repeat open", [blk([iv("Work", 20), iv("Max reps", 1, "open", tick=7)])], prep=0, rep=2),
    settings=S3, nextAt=[40000, 100000])
add("tl-42", "timeline", "start modes voice / both / none mixed in one block",
    timer=tmr("Modes", [blk([iv("A", 12, cue="voice"), iv("B", 12, cue="both"), iv("C", 12, cue="none", hw=True)],
                            rounds=2, rest=5)], prep=4), settings=S3)
add("tl-44", "timeline", "countdown 5 on a 10 s interval: halfway and '5' at 5000, halfway first", True,
    timer=tmr("Collide", [blk([iv("Hold", 10, hw=True), iv("Rest", 10, R, hw=True)])], prep=0), settings=S5)
add("tl-45", "timeline", "beep-only start cue: listed with the label as text", False, "A1",
    timer=tmr("Beeps", [blk([iv("Work", 15, cue="beep"), iv("Rest", 5, R, cue="beep")], rounds=2)], prep=3),
    settings=S3)

# ================================================================== fm: format (D30)
for cid, secs, lang, adv in [("fm-01", 0, "en", True), ("fm-02", 59, "en", False),
                             ("fm-05", 3599, "en", True), ("fm-06", 3600, "en", True),
                             ("fm-07", 3601, "en", True), ("fm-08", 5999, "en", True), ("fm-09", 6000, "en", True),
                             ("fm-11", 36000, "en", True),
                             ("fm-12", 3599, "ar", True), ("fm-13", 5999, "hi", True), ("fm-14", 250, "de", False)]:
    add(cid, "format", "formatDuration(%d) in %s" % (secs, lang), adv, None, seconds=secs, language=lang)

# ================================================================== va: validation (5.3, D31)
def one(name="Timer", bname="", iname="Work", seconds=20, rounds=1, prep=10, rep=1, rest=0):
    return tmr(name, [blk([iv(iname, seconds)], rounds=rounds, rest=rest, name=bname)], prep=prep, rep=rep)


E = "😀"
FAM = "👨‍👩‍👧‍👦"          # 7 code points
FLAG = "🇯🇵"              # 2 code points
NFD_E = "é"          # 2 code points
NFC_E = "é"           # 1 code point
YOSHI = "\U00020BB7"       # 1 code point, 2 UTF-16 units
add("va-01", "validation", "plain valid timer", timer=one())
add("va-02", "validation", "timer name 40 emoji (80 UTF-16 units) is valid", True, timer=one(name=E * 40))
add("va-03", "validation", "timer name 41 emoji is invalid", True, timer=one(name=E * 41))
add("va-05", "validation", "20 decomposed e+acute = 40 code points: valid", True, timer=one(name=NFD_E * 20))
add("va-06", "validation", "21 decomposed e+acute = 42 code points (21 graphemes): invalid, no normalisation",
    True, timer=one(name=NFD_E * 21))
add("va-07", "validation", "21 precomposed e-acute = 21 code points: valid", True, timer=one(name=NFC_E * 21))
add("va-08", "validation", "6 ZWJ family emoji = 42 code points (6 graphemes): invalid", True,
    timer=one(name=FAM * 6))
add("va-09", "validation", "5 ZWJ family emoji + 5 letters = 40 code points: valid", True,
    timer=one(name=FAM * 5 + "abcde"))
add("va-11", "validation", "21 flags = 42 code points invalid as interval name", True, timer=one(iname=FLAG * 21))
add("va-13", "validation", "block name 41 supplementary CJK: invalid", True, timer=one(bname=YOSHI * 41))
add("va-14", "validation", "lone high surrogate + 39 letters = 40 code points: valid (D31)", True,
    timer=one(name="\ud83d" + "a" * 39))
add("va-15", "validation", "seconds 6000 invalid", timer=one(seconds=6000))
add("va-16", "validation", "seconds 0 invalid", timer=one(seconds=0))
add("va-18", "validation", "rounds 100 invalid", timer=one(seconds=3, rounds=100))
add("va-20", "validation", "21 blocks invalid",
    timer=tmr("B21", [blk([iv("x", 5)]) for _ in range(21)]))
add("va-21", "validation", "31 intervals in a block invalid",
    timer=tmr("I31", [blk([iv("x", 5) for _ in range(31)])]))
add("va-22", "validation", "total 28799 s incl. prep: valid", True,
    timer=tmr("Almost 8h", [blk([iv("Long", 5999)], rounds=4), blk([iv("Rest", 4793, R)])], prep=10))
add("va-23", "validation", "total 28801 s incl. prep: invalid", True,
    timer=tmr("Over 8h", [blk([iv("Long", 5999)], rounds=4), blk([iv("Rest", 4793, R)])], prep=12))
add("va-24", "validation", "total exactly 8 h: SPEC 5.3 says <= 8 h, SPEC 9 says >= 8 h refused", True, "A4",
    timer=tmr("Exactly 8h", [blk([iv("Long", 5999)], rounds=4), blk([iv("Rest", 4793, R)])], prep=11))
add("va-25", "validation", "every field valid, total 35994 s via repeat whole 3: invalid", True,
    timer=tmr("Repeat over", [blk([iv("Long", 5999)], rounds=2)], prep=0, rep=3))

# ================================================================== cl: clampName (D31)
for cid, s, why in [("cl-01", E * 45, "45 emoji -> first 40 emoji, no split pair"),
                    ("cl-02", "a" * 39 + E * 2, "39 letters + 2 emoji -> 39 letters + 1 emoji"),
                    ("cl-03", FAM * 6, "6 ZWJ families (42 cp) -> first 40 cp, cut inside the 6th sequence"),
                    ("cl-06", "\ud83d" + "b" * 45, "lone surrogate counts 1")]:
    add(cid, "clamp", why, True, None, input=s)

# ================================================================== runner (SPEC 5.2, D33)
RT = tmr("Runner", [blk([iv("Work", 20), iv("Rest", 10, R)], rounds=2, rest=15)], prep=5)
# segments: 0 prep [0,5000) 1 Work [5000,25000) 2 Rest [25000,35000) 3 Rest-between [35000,50000)
#           4 Work [50000,70000) 5 Rest [70000,80000), total 80000
T0 = 1_000_000


def steps(*pairs):
    return [{"at": T0 + dt, "do": do} if len(p) == 2 else {"at": T0 + dt, "do": do, "source": p[2]}
            for p in pairs for (dt, do) in [p[:2]]]


def rn(cid, why, adv, amb, *pairs, timer=RT, settings=S3):
    add(cid, "runner", why, adv, amb, timer=timer, settings=settings, steps=steps(*pairs))


rn("rn-01", "plain run to the natural end and reads long after", False, None,
   (0, "start"), (3000, "view"), (30000, "view"), (80000, "view"), (200000, "view"))
rn("rn-02", "double Start never restarts the run", True, None,
   (0, "start"), (10000, "start"), (12000, "view"))
rn("rn-03", "Start after the natural end stays ended", True, None,
   (0, "start"), (90000, "view"), (95000, "start"), (96000, "view"))
rn("rn-04", "Pause after the natural end without a read in between: ended, not paused", True, None,
   (0, "start"), (85000, "pause"), (90000, "view"))
rn("rn-05", "Pause exactly at the total: ended", True, None, (0, "start"), (80000, "pause"))
rn("rn-06", "Pause 1 ms before the total, resume much later, end 1 ms after resume", True, None,
   (0, "start"), (79999, "pause"), (179999, "resume"), (179999, "view"), (180000, "view"))
rn("rn-07", "Back after the natural end does not revive the run", True, None,
   (0, "start"), (81000, "back"), (82000, "view"))
rn("rn-08", "+30 s after the natural end does not extend the run", True, None,
   (0, "start"), (80500, "addTime"), (81000, "view"))
rn("rn-09", "Skip after the natural end (notification) is a no-op", True, None,
   (0, "start"), (100000, "skip", "notification"), (100001, "view"))
rn("rn-10", "headset play-pause and notification resume after the natural end", True, None,
   (0, "start"), (90000, "toggle", "headset"), (91000, "resume", "notification"), (92000, "view"))
rn("rn-11", "Back while paused restarts the segment and stays paused", True, "A6",
   (0, "start"), (12000, "pause"), (20000, "back"), (30000, "view"))
rn("rn-13", "Back at 1999 ms into a segment goes to the previous start; at 2000 ms restarts the current", True,
   None, (0, "start"), (26999, "back"), (27000, "view"), (40000, "skip"), (52000, "back"), (52001, "view"))
rn("rn-14", "Back < 2 s into the prep (segment 0) restarts the prep", True, None,
   (0, "start"), (1500, "back"), (1600, "view"))
rn("rn-15", "Skip from prep, then skip exactly on a segment start", True, None,
   (0, "start"), (1000, "skip"), (1000, "view"), (21000, "skip"), (21000, "skip"), (21500, "view"))
rn("rn-16", "Skip in the last segment ends the run", True, "A6",
   (0, "start"), (72000, "skip"), (72001, "view"))
rn("rn-17", "+30 s extends the current segment and shifts the rest; skip and natural end follow", False, None,
   (0, "start"), (10000, "addTime"), (10000, "view"), (11000, "skip"), (11000, "view"), (66000, "view"),
   (110000, "view"))
rn("rn-18", "+30 s twice with pause accounting", True, None,
   (0, "start"), (60000, "addTime"), (61000, "addTime", "screen"), (62000, "pause"), (300000, "resume"),
   (318000, "view"), (378000, "view"))
rn("rn-19", "headset toggles: pause, resume, pause, resume", False, None,
   (0, "start"), (8000, "toggle", "headset"), (20000, "toggle", "headset"), (30000, "toggle", "headset"),
   (31000, "toggle", "headset"), (40000, "view"))
rn("rn-20", "notification Pause twice, Resume, End, then reads", False, None,
   (0, "start"), (8000, "pause", "notification"), (9000, "pause", "notification"),
   (10000, "resume", "notification"), (40000, "end", "notification"), (60000, "view"))
rn("rn-21", "actions on idle are no-ops, Start still works afterwards", True, None,
   (0, "pause"), (100, "resume"), (200, "skip"), (300, "back"), (400, "addTime"), (500, "next"),
   (1000, "start"), (3000, "view"))
rn("rn-22", "End and headset toggle on idle", True, "A8",
   (0, "toggle", "headset"), (100, "end"), (200, "view"))
OT = tmr("Open runner", [blk([iv("Warm", 10), iv("AMRAP", 30, "open", tick=10), iv("Cool", 20, "cooldown")])],
         prep=0)
rn("rn-23", "open interval: Next closes it, timeline continues, natural end, Next after end no-op", False, None,
   (0, "start"), (25000, "view"), (47000, "next"), (47000, "view"), (60000, "view"), (67000, "view"),
   (68000, "next"), (69000, "view"), timer=OT)
rn("rn-24", "Next on a non-open segment", True, "A9", (0, "start"), (5000, "next"), (6000, "view"), timer=OT)
rn("rn-25", "End arriving after the total: the natural end wins (elapsed = total)", True, None,
   (0, "start"), (100000, "end"), (100000, "view"))
# ================================================================== recovery (D29.10)
RCT = tmr("Recovery", [blk([iv("Work", 60, hw=True), iv("Rest", 30, R)], rounds=6, rest=60)], prep=10)
# total 10 + 6*90 + 5*60 = 850 s
W0 = wall("2026-10-16 08:00")
H = 3600 * 1000


def rc(cid, why, adv, amb, pairs, relaunch, timer=RCT, settings=S3):
    add(cid, "recovery", why, adv, amb, timer=timer, settings=settings,
        steps=[{"at": W0 + dt, "do": do} for dt, do in pairs], relaunchAt=W0 + relaunch)


rc("rc-01", "killed while running, relaunch 4:32 later -> Resume at wall-clock elapsed", False, None,
   [(0, "start")], 272000)
rc("rc-02", "relaunch hours after the end -> finished, completed, interrupted", True, None,
   [(0, "start")], 5 * H)
rc("rc-03", "relaunch exactly at the total -> finished", True, None, [(0, "start")], 850000)
rc("rc-04", "relaunch 1 ms before the total -> resume in the last segment", True, None, [(0, "start")], 849999)
rc("rc-05", "a 2-minute pause before the kill is not counted", True, None,
   [(0, "start"), (100000, "pause"), (220000, "resume")], 400000)
rc("rc-06", "killed while paused, relaunch 23 h later -> resume paused at the same elapsed", True, None,
   [(0, "start"), (300000, "pause")], 300000 + 23 * H)
rc("rc-07", "killed while paused, relaunch 25 h later -> saved as partial", True, None,
   [(0, "start"), (300000, "pause")], 300000 + 25 * H)
rc("rc-08", "paused exactly 24 h", True, "A10", [(0, "start"), (300000, "pause")], 300000 + 24 * H)
rc("rc-09", "two +30 s replayed: elapsed lands in a different segment than without them", True, None,
   [(0, "start"), (15000, "addTime"), (16000, "addTime")], 160000)
rc("rc-10", "replayed Skip and Back move the base", True, None,
   [(0, "start"), (2000, "skip"), (12000, "skip"), (13000, "back"), (13500, "back")], 200000)
OPR = tmr("Open recovery", [blk([iv("Warm", 60), iv("Max", 30, "open", tick=30), iv("Cool", 120, "cooldown")])],
          prep=10)
rc("rc-11", "replayed Next: the timeline after the open interval is rebuilt", True, None,
   [(0, "start"), (200000, "next")], 260000, timer=OPR)
rc("rc-12", "killed inside an open interval, relaunch 30 min later -> resume in the open segment", True, None,
   [(0, "start")], 30 * 60 * 1000, timer=OPR)
rc("rc-13", "killed inside an open interval, relaunch 5 h later -> partial (open-ended > 2 h)", True, None,
   [(0, "start")], 5 * H, timer=OPR)

# ================================================================== catch-up and next cue (D29.7, D29.9)
CT = tmr("Catch-up", [blk([iv("Work", 20, hw=True), iv("Rest", 10, R)], rounds=3, rest=12)], prep=5)
# prep [0,5000) W [5000,25000) R [25000,35000) RB [35000,47000) W [47000,67000) ...
add("cb-01", "cuesBetween", "window inside one segment holding 3 countdown cues -> only the latest", True,
    timer=CT, settings=S3, frm=21000, to=24500)
add("cb-02", "cuesBetween", "window across several segments ending on a segment start -> round+start batch", True,
    timer=CT, settings=S3, frm=10000, to=47000)
add("cb-03", "cuesBetween", "from is exclusive: a cue exactly at from is not returned", True,
    timer=CT, settings=S3, frm=5000, to=5500)
add("cb-04", "cuesBetween", "to is inclusive: halfway exactly at to", False,
    timer=CT, settings=S3, frm=14000, to=15000)
add("cb-05", "cuesBetween", "open segment: window spanning 3 ticks -> only the latest tick", True,
    timer=OPR, settings=S3, frm=75000, to=165000)
add("cb-06", "cuesBetween", "window reaching past the total -> end cue only", True, "A7",
    timer=CT, settings=S3, frm=115000, to=999999)
add("nc-01", "nextCueAfter", "next cue strictly after an exact cue time", True,
    timer=CT, settings=S3, after=15000)
add("nc-02", "nextCueAfter", "inside an open segment the next cue is a tick", False,
    timer=OPR, settings=S3, after=131000)
add("nc-03", "nextCueAfter", "after the last countdown the next cue is the end", False,
    timer=CT, settings=S3, after=118500)

# ================================================================== backup restore (5.6, P4b attachment)
def T(id_, name, secs, kind="custom", notes=""):
    return {"id": id_, "kind": kind, "name": name, "color": "#2E7D32", "notes": notes,
            "blocks": [blk([iv("Work", secs), iv("Rest", 10, R)], rounds=4)],
            "prefs": {"prepSeconds": 10, "endCue": "both", "repeatWhole": 1, "vibrate": True}}


def SE(id_, tid, tname, day, actual, note=""):
    st = wall("2026-10-%02d 07:00" % day)
    return {"id": id_, "timerId": tid, "timerName": tname, "startedAt": st, "endedAt": st + actual * 1000,
            "plannedS": 210, "actualS": actual, "completed": True, "skippedIntervals": 0, "pauses": 0, "note": note}


TEMPL = [T(i + 1, n, 20 + i, "template") for i, n in
         enumerate(["Tabata", "HIIT 30/15", "EMOM 10", "Boxing", "Walk/Run", "Circuit", "Stretch"])]
USER = [T(1, "Legs", 41), T(2, "Arms", 42), T(3, "Core", 43)]
USES = [SE(1, 1, "Legs", 1, 200), SE(2, 2, "Arms", 2, 201), SE(3, 3, "Core", 3, 202), SE(4, 1, "Legs", 4, 203)]
BK = {"timers": USER, "sessions": USES}


def bk(cid, why, adv, amb, mode, current, backup):
    add(cid, "backup", why, adv, amb, mode=mode, current=current, backup=backup)


bk("bk-01", "fresh install (7 templates ids 1-7) keep both: sessions stay with the user's timers, not templates",
   True, None, "keepBoth", {"timers": TEMPL, "sessions": []}, BK)
bk("bk-02", "fresh install replace: ids 1-3 take the backup's timers, sessions follow", True, None,
   "replace", {"timers": TEMPL, "sessions": []}, BK)
bk("bk-03", "same phone, nothing changed since the export, keep both: nothing duplicated", False, None,
   "keepBoth", {"timers": USER, "sessions": USES}, BK)
edited = [USER[0], T(2, "Arms", 52), USER[2]]
bk("bk-04", "timer 2 edited and session 2 deleted after the export, keep both", True, None, "keepBoth",
   {"timers": edited, "sessions": [USES[0], USES[2], USES[3], SE(5, 2, "Arms", 9, 300)]}, BK)
bk("bk-05", "same as bk-04 with replace", True, None, "replace",
   {"timers": edited, "sessions": [USES[0], USES[2], USES[3], SE(5, 2, "Arms", 9, 300)]}, BK)
other = [T(1, "Legs", 41), T(2, "Arms", 42), T(3, "Core", 43), T(4, "Sprint", 61), T(5, "Yoga", 62)]
bk("bk-06", "other phone: ids 4,5 and session ids 5,6 clash with different content, keep both", True, None,
   "keepBoth", {"timers": other, "sessions": USES + [SE(5, 4, "Sprint", 5, 400), SE(6, 5, "Yoga", 6, 401)]},
   {"timers": USER + [T(4, "Swim", 71), T(5, "Bike", 72)],
    "sessions": USES + [SE(5, 4, "Swim", 7, 500), SE(6, 5, "Bike", 8, 501), SE(7, 5, "Bike", 10, 502)]})
bk("bk-07", "copy ids may clash with later backup ids: current {1,2}, backup {1 differs, 3, 4}", True, None,
   "keepBoth", {"timers": [T(1, "Mine", 81), T(2, "Also mine", 82)], "sessions": [SE(1, 1, "Mine", 1, 100)]},
   {"timers": [T(1, "Theirs", 91), T(3, "Third", 93), T(4, "Fourth", 94)],
    "sessions": [SE(1, 1, "Theirs", 2, 110), SE(2, 3, "Third", 3, 111), SE(3, 4, "Fourth", 4, 112),
                 SE(4, 1, "Theirs", 5, 113)]})
bk("bk-08", "backup session whose timer was deleted before the export (timerId null)", False, None,
   "keepBoth", {"timers": TEMPL, "sessions": []},
   {"timers": [T(3, "Core", 43)], "sessions": [SE(1, None, "Old timer", 1, 120), SE(2, 3, "Core", 2, 121)]})
bk("bk-09", "rename-only edit after the export, keep both: old name comes back as a copy", True, None,
   "keepBoth", {"timers": [T(1, "Morning legs", 41), USER[1], USER[2]], "sessions": USES}, BK)
bk("bk-10", "replace keeps current timers that are not in the backup (merge)", False, None,
   "replace", {"timers": USER + [T(9, "New one", 99)], "sessions": USES + [SE(9, 9, "New one", 9, 333)]},
   {"timers": [USER[0]], "sessions": [USES[0]]})
bk("bk-11", "timer deleted after the export (its sessions now have timerId null), keep both", True, "A12",
   "keepBoth", {"timers": [USER[0], USER[2]],
                "sessions": [USES[0], dict(USES[1], timerId=None), USES[2], USES[3]]}, BK)

# ================================================================== CSV (5.6)
def CS(id_, name, note="", day=1):
    return SE(id_, 1, name, day, 100 + id_, note)


add("cv-01", "csv", "formula guard on timer names: = + - @ and a lone =", True,
    sessions=[CS(1, "=SUM(A1:A9)"), CS(2, "+1 lap"), CS(3, "-5 burpees"), CS(4, "@gym"), CS(5, "=")],
    check="timerName")
add("cv-02", "csv", "RFC 4180 quoting: comma, quotes, newline, CRLF, tab inside, emoji, Arabic", True,
    sessions=[CS(1, 'Legs, "heavy"'), CS(2, "Line1\nLine2"), CS(3, "A\r\nB"), CS(4, "Tab\tinside"),
              CS(5, "Ünïcödé 🏋️‍♀️"), CS(6, "تمرين سريع")], check="timerName")
add("cv-03", "csv", "guard inside a quoted field; a name already starting with an apostrophe is unchanged", True,
    sessions=[CS(1, '=HYPERLINK("http://x","y")'), CS(2, "'already"), CS(3, "-"), CS(4, "@SUM(1,2)")],
    check="timerName")
add("cv-04", "csv", "leading tab / carriage return are guarded (OWASP list)", True, "A11",
    sessions=[CS(1, "\t=1+1"), CS(2, "\r=1+1")], check="timerName")
add("cv-06", "csv", "note field guarded and quoted", True, "A11",
    sessions=[CS(1, "Plain", note="=cmd|' /C calc'!A0"), CS(2, "Plain 2", note="line\nbreak, comma")],
    check="note")

# ================================================================== share codec (5.5, D19)
SH = tmr("Share me", [blk([iv("Work", 20, color="#C62828"), iv("Rest", 10, R, color="#1565C0")], rounds=8,
                          rest=30, name="Main"),
                      blk([iv("Stretch", 45, "cooldown", cue="voice", hw=True, cd=False, color="#6A1B9A")],
                          name="End")], prep=10)
LANGS = tmr("Многоязычный 🏋️‍♀️", [blk([iv("スクワット", 20, color="#C62828"), iv("راحة", 10, R, color="#1565C0"),
                                        iv("आराम", 10, R, color="#1565C0"), iv("휴식", 10, R, color="#1565C0"),
                                        iv("Nghỉ ngơi", 10, R, color="#1565C0"), iv("Dinlenme ğüşı", 10, R,
                                                                                     color="#1565C0"),
                                        iv("休息一下", 10, R, color="#1565C0"), iv(FAM * 5 + "abcde", 10,
                                                                                    color="#C62828")],
                                       name="Ü" * 40)], prep=5)
ODD = tmr("Odd", [blk([iv("Get set", 15, "prep", cue="voice", hw=True, cd=False, color="#F9A825"),
                       iv("AMRAP", 60, "open", cue="beep", tick=15, color="#2E7D32"),
                       iv("Quiet", 12, "work", cue="none", color="#C62828")], rounds=3, rest=5)],
          prep=60, end="none", rep=10)
BIG = tmr("Big", [blk([iv("i%d" % i, 2, color="#455A64") for i in range(30)], rounds=1, name="b%d" % b)
                  for b in range(20)], prep=0)


def sc(cid, why, adv, amb, op, expect, timer=SH):
    add(cid, "share", why, adv, amb, timer=timer, op=op, expect=expect)


sc("sc-01", "round trip exact", False, None, "none", "ok")
sc("sc-02", "round trip with names in many scripts, ZWJ emoji, 40-code-point block name", True, None, "none", "ok",
   timer=LANGS)
sc("sc-03", "round trip: typed prep, open + tick, start none/beep/voice, prep 60, repeat 10, end none", True, None,
   "none", "ok", timer=ODD)
sc("sc-04", "round trip of the maximum structure (20 x 30)", True, None, "none", "ok", timer=BIG)
sc("sc-05", "file import of the decoded JSON text", False, None, "file", "ok", timer=LANGS)
sc("sc-07", "unknown key in every object is ignored", True, None, "addKeyEverywhere", "ok")
sc("sc-08", "payload cut in half", True, None, "truncateHalf", "reject")
sc("sc-10", "every string value 41 characters long", True, None, "stringsTo41", "reject")
sc("sc-11", "every number set to 6000", True, None, "numbersTo6000", "reject")
sc("sc-12", "every array repeated to 25 elements (21+ blocks)", True, None, "repeatArrays25", "reject")
sc("sc-13", "payload wrapped in 5000 nested arrays", True, None, "deepNest", "reject")
sc("sc-14", "payload is base64url of plain text", True, None, "notJson", "reject")
sc("sc-15", "empty d parameter", True, None, "emptyD", "reject")
sc("sc-17", "payload bytes are not UTF-8", True, None, "badUtf8", "reject")
sc("sc-19", "encode a timer with a 41-code-point name: import refuses", True, None, "encodeInvalid", "reject",
   timer=tmr(E * 41, [blk([iv("Work", 20)])]))
sc("sc-20", "encode a timer over 8 h: import refuses", True, None, "encodeInvalid", "reject",
   timer=tmr("Too long", [blk([iv("Long", 5999)], rounds=5)], prep=0))
sc("sc-21", "empty JSON object: never throws", True, None, "emptyObject", "no-throw")
# ================================================================== stats keys and totals (5.7, D34)
def sk(cid, why, adv, ms, tz):
    add(cid, "statsKeys", why, adv, None, atMs=ms, tz=tz)


sk("sk-01", "D34 example 2027-01-01 -> 2026-W53", False, wall("2027-01-01 12:00", "Europe/Berlin"), "Europe/Berlin")
sk("sk-02", "UTC+14: 2026-12-31 11:00Z is local 2027-01-01 01:00", True,
   wall("2026-12-31 11:00"), "Pacific/Kiritimati")
sk("sk-04", "UTC-12: 2027-01-04 11:59Z is local Sunday 2027-01-03 23:59", True, wall("2027-01-04 11:59"),
   "Etc/GMT+12")
sk("sk-05", "UTC-12: 2027-01-04 12:00Z is local Monday 00:00 -> W01", True, wall("2027-01-04 12:00"),
   "Etc/GMT+12")
sk("sk-06", "Monday 2024-12-30 belongs to ISO year 2025", True, wall("2024-12-30 08:00", "America/Los_Angeles"),
   "America/Los_Angeles")
sk("sk-08", "Samoa skipped 2011-12-30: the instant lands on 2011-12-31", True, wall("2011-12-30 10:00"),
   "Pacific/Apia")
sk("sk-09", "first Monday after the spring DST change, local midnight", True,
   wall("2026-03-30 00:00", "Europe/Berlin"), "Europe/Berlin")
sk("sk-10", "Lord Howe (+11 in summer): local 2027-01-01 00:00", True, wall("2026-12-31 13:00"),
   "Australia/Lord_Howe")
sk("sk-11", "Monday 2026-12-28 is 2026-W53 (53-week year)", True, wall("2026-12-28 00:00", "Asia/Tokyo"),
   "Asia/Tokyo")

add("sa-01", "statsTotals", "day totals across the autumn DST change (25 h day)", True, None, tz="Europe/Berlin",
    period="day", sessions=[{"startedAt": wall("2026-10-25 00:30", "Europe/Berlin"), "actualS": 100},
                            {"startedAt": wall("2026-10-25 23:30", "Europe/Berlin"), "actualS": 200},
                            {"startedAt": wall("2026-10-26 00:10", "Europe/Berlin"), "actualS": 300},
                            {"startedAt": wall("2026-10-24 23:59", "Europe/Berlin"), "actualS": 400}])
add("sa-02", "statsTotals", "ISO week totals around the year end at UTC+14", True, None, tz="Pacific/Kiritimati",
    period="week", sessions=[{"startedAt": wall("2026-12-27 12:00"), "actualS": 10},
                             {"startedAt": wall("2026-12-31 11:00"), "actualS": 20},
                             {"startedAt": wall("2027-01-03 09:00"), "actualS": 30},
                             {"startedAt": wall("2027-01-03 10:30"), "actualS": 40}])
add("sa-03", "statsTotals", "month totals at UTC-12: UTC instant in November, local still October", True, None,
    tz="Etc/GMT+12", period="month",
    sessions=[{"startedAt": wall("2026-11-01 11:00"), "actualS": 50},
              {"startedAt": wall("2026-11-01 12:00"), "actualS": 60},
              {"startedAt": wall("2026-10-01 11:59"), "actualS": 70}])
add("ss-01", "streak", "4-day streak across the spring DST change (23 h day)", True, None, tz="Europe/Berlin",
    nowMs=wall("2026-03-30 23:45", "Europe/Berlin"),
    sessions=[{"startedAt": wall("2026-03-%02d 23:30" % d, "Europe/Berlin"), "actualS": 60} for d in (27, 28, 29, 30)]
    + [{"startedAt": wall("2026-03-25 23:30", "Europe/Berlin"), "actualS": 60}])
add("ss-02", "streak", "autumn DST end in New York: a missing day breaks the streak", True, None,
    tz="America/New_York", nowMs=wall("2026-11-02 23:00", "America/New_York"),
    sessions=[{"startedAt": wall("2026-10-30 23:59", "America/New_York"), "actualS": 60},
              {"startedAt": wall("2026-11-01 00:30", "America/New_York"), "actualS": 60},
              {"startedAt": wall("2026-11-01 01:30", "America/New_York"), "actualS": 60},
              {"startedAt": wall("2026-11-02 22:00", "America/New_York"), "actualS": 60}])

# ================================================================== templates (D28)
# Structures read from SPEC 4 + D28 (README section "Templates"). Keyword = case-insensitive substring of the name.
TPL = {
    "tabata": ([blk([iv("Work", 20), iv("Rest", 10, R)], rounds=8)], 10),
    "hiit": ([blk([iv("Work", 30), iv("Rest", 15, R)], rounds=10)], 10),
    "emom": ([blk([iv("Minute", 60, hw=True)], rounds=10)], 10),
    "walk": ([blk([iv("Walk", 60), iv("Run", 60)], rounds=15)], 10),
    "stretch": ([blk([iv("Stretch", 30, "cooldown", cd=False)], rounds=10)], 5),
    "boxing": ([blk([iv("Round", 180, hw=True), iv("Rest", 60, R)], rounds=12)], 10),
    "circuit": ([blk([iv("Station", 45) if k == 0 else iv("Rest", 15, R) for s in range(6) for k in range(2)],
                     rounds=3, rest=60)], 10),
}
for cid, kw, amb in [("tp-01", "tabata", None), ("tp-02", "hiit", None), ("tp-03", "emom", "A15"),
                     ("tp-04", "walk", None), ("tp-05", "stretch", None), ("tp-06", "boxing", "A15"),
                     ("tp-07", "circuit", "A15")]:
    add(cid, "templates", "seeded '%s' template total (English)" % kw, False, amb, keyword=kw)
add("tp-08", "templateRestore", "delete two templates, rename one, edit one, then Restore templates", True, None,
    deleteKeywords=["tabata", "stretch"], renameKeyword="boxing", renameSuffix=" (mine)", editKeyword="hiit",
    editFirstIntervalSeconds=33)
