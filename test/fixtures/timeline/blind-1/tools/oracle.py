"""Independent oracle for the interval-timer blind set B1 (intervals-b1).

Derived ONLY from interval-timer docs/SPEC.md (SS4, SS5.1-5.7, SS9), docs/DECISIONS.md (D13, D19,
D27-D29), docs/V1_PLAN.md (P3a) and test/fixtures/timeline/FORMAT.md. The author never opened the
app's src/ or any other file under test/. Python 3 standard library only (run with `python3 -I`).

Every function that has to pick a reading where the specification is silent records the reading's id
in the `readings` set it is given AND computes the alternative reading where that is cheap; a case is
flagged `ambiguous` only when the alternative would change its expected value (see README "Readings").
"""

from __future__ import annotations

import csv
import io
import json
import unicodedata
from collections import Counter
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

# ---------------------------------------------------------------- constants (SPEC / D29 / FORMAT.md)
PREP_LABEL = "Get ready"          # FORMAT.md: start text "Get ready" for prep
ROUND_REST_LABEL = "Rest"         # D29.5 / FORMAT.md
HALFWAY_TEXT = "Halfway"          # SPEC 5.1 voice texts
DONE_TEXT = "Done"                # SPEC 5.1 voice texts ("Done" = end)
KIND_RANK = {"round": 0, "start": 1, "halfway": 2, "countdown": 3, "openTick": 4, "end": 5}  # D29.8
TYPES = ("prep", "work", "rest", "cooldown", "open")
CUE_MODES = ("voice", "beep", "both", "none")
ADD_MS = 30_000                   # SPEC 5.2 addTime(now, +30 s)
BACK_MS = 2_000                   # SPEC 5.2 back: previous if < 2 s in
MAX_TOTAL_MS = 8 * 3600 * 1000    # SPEC 5.3 total <= 8 h
PAUSED_MAX_MS = 24 * 3600 * 1000  # D29.10
OPEN_MAX_MS = 2 * 3600 * 1000     # D29.10
LINK_PREFIX = "plainintervals://t?d="  # SPEC 5.5 / D19
FORMULA_START = ("=", "+", "-", "@", "\t", "\r")  # OWASP CSV-injection lead characters


# ---------------------------------------------------------------- timer helpers (FORMAT.md shape)
def iv(name, seconds, type="work", cue="both", halfway=False, countdown=True, color="", tick=0):
    return {"name": name, "seconds": seconds, "type": type, "color": color, "cueStart": cue,
            "halfwayCue": halfway, "countdownCue": countdown, "openTickS": tick}


def blk(intervals, rounds=1, rest=0, name=""):
    return {"name": name, "rounds": rounds, "restBetweenRoundsS": rest, "intervals": list(intervals)}


def tmr(name, blocks, prep=10, end="both", repeat=1, vibrate=True, color="#C62828", notes=""):
    return {"name": name, "color": color, "notes": notes, "blocks": list(blocks),
            "prefs": {"prepSeconds": prep, "endCue": end, "repeatWhole": repeat, "vibrate": vibrate}}


def canonical(t, with_notes=False, with_name=True):
    """The comparable definition of a timer (share/backup). Notes only on request (reading SH1)."""
    out = {}
    if with_name:
        out["name"] = t["name"]
    out["color"] = t["color"]
    if with_notes:
        out["notes"] = t["notes"]
    out["blocks"] = [{"name": b["name"], "rounds": b["rounds"], "restBetweenRoundsS": b["restBetweenRoundsS"],
                      "intervals": [dict(i) for i in b["intervals"]]} for b in t["blocks"]]
    out["prefs"] = dict(t["prefs"])
    return out


# ---------------------------------------------------------------- 5.1 schedule
def plan_of(t, readings=None, prep_type_rule="type"):
    """Unfold a timer into ordered segment specs (FORMAT.md 'Segment order', D29.1-5).
    prep_type_rule: 'type' = an interval whose TYPE is prep is treated like the prep segment for the
    halfway/countdown rules (D29.3 'not for prep'; FORMAT 'always prep'); 'origin' = only the generated
    prep segment. Reading T2."""
    p = t["prefs"]
    plan = []
    if p["prepSeconds"] > 0:  # once, before repeat 1 (D29.5)
        plan.append(dict(type="prep", label=PREP_LABEL, ms=p["prepSeconds"] * 1000, open=False, cue="both",
                         countdown=True, halfway=False, roundText=None, tick=0))
    for _rep in range(p["repeatWhole"]):  # no cue/segment between repeats (D29.1, D29.5)
        for b in t["blocks"]:
            n = b["rounds"]
            for r in range(1, n + 1):
                for j, i in enumerate(b["intervals"]):
                    is_open = i["type"] == "open"
                    countdown = bool(i["countdownCue"]) and not is_open          # D29.2
                    halfway = bool(i["halfwayCue"]) and i["seconds"] >= 10 and not is_open  # D29.3
                    if i["type"] == "prep":
                        if readings is not None:
                            readings.add("T2")
                        if prep_type_rule == "type":
                            countdown, halfway = True, False
                    plan.append(dict(type=i["type"], label=i["name"], ms=i["seconds"] * 1000, open=is_open,
                                     cue=i["cueStart"], countdown=countdown, halfway=halfway,
                                     roundText=(f"Round {r} of {n}" if n > 1 and j == 0 else None),  # D29.1
                                     tick=i.get("openTickS", 0)))
                if r < n and b["restBetweenRoundsS"] > 0:  # D29.5
                    plan.append(dict(type="rest", label=ROUND_REST_LABEL, ms=b["restBetweenRoundsS"] * 1000,
                                     open=False, cue="both", countdown=True, halfway=False, roundText=None, tick=0))
    return plan


def materialize(plan, cf, end_cue, open_ends=None, ext=None, order="segment"):
    """Absolute offsets (segment k starts at the sum of the previous lengths, SPEC 5.1).
    open_ends {planIndex: absolute end} closes open segments (FORMAT: max(nextAt, start)).
    ext {planIndex: added ms} = +30 s (D29.8: end moves, countdown moves with it, halfway stays).
    order: same-ms tie between cues of DIFFERENT segments -> 'segment' (segment order first, then the
    D29.8 kind order) or 'kind' (kind order across segments). Reading T1."""
    open_ends = open_ends or {}
    ext = ext or {}
    segs, cues = [], []
    t = 0
    cut = False
    for k, p in enumerate(plan):
        s = t
        if p["open"]:
            e = max(open_ends[k], s) if k in open_ends else None
        else:
            e = s + p["ms"] + ext.get(k, 0)
        segs.append({"startMs": s, "endMs": e, "type": p["type"], "label": p["label"]})
        if p["roundText"]:
            cues.append((s, k, "round", p["roundText"]))
        if p["cue"] != "none":  # D29.4: none suppresses only the start cue
            cues.append((s, k, "start", p["label"]))
        if p["halfway"]:
            cues.append((s + p["ms"] // 2, k, "halfway", HALFWAY_TEXT))  # seconds*500, whole ms
        if p["countdown"] and e is not None:
            for n in range(cf, 0, -1):
                at = e - n * 1000
                if at > s:  # D29.2 strictly after the segment start
                    cues.append((at, k, "countdown", str(n)))
        if e is None:
            cut = True
            break
        t = e
    total = None if cut else t
    if total is not None and end_cue != "none":  # D29.6
        cues.append((total, len(plan), "end", DONE_TEXT))
    if order == "segment":
        cues.sort(key=lambda c: (c[0], c[1], KIND_RANK[c[2]]))
    else:
        cues.sort(key=lambda c: (c[0], KIND_RANK[c[2]], c[1]))
    return {"totalMs": total, "segments": segs,
            "cues": [{"atMs": a, "kind": kd, "text": tx, "_seg": sg} for a, sg, kd, tx in cues]}


def resolve_next(plan, next_at):
    """FORMAT.md nextAt: elapsed ms of the user's Next in each open interval, in order."""
    pending = list(next_at or [])
    ends = {}
    t = 0
    for k, p in enumerate(plan):
        s = t
        if p["open"]:
            if not pending:
                break
            ends[k] = max(pending.pop(0), s)
            t = ends[k]
        else:
            t = s + p["ms"]
    return ends


def public(tl):
    return {"totalMs": tl["totalMs"], "segments": [dict(s) for s in tl["segments"]],
            "cues": [{"atMs": c["atMs"], "kind": c["kind"], "text": c["text"]} for c in tl["cues"]]}


def _timeline(t, settings, next_at=None, order="segment", prep_rule="type", readings=None):
    plan = plan_of(t, readings, prep_rule)
    return materialize(plan, settings["countdownFrom"], t["prefs"]["endCue"], resolve_next(plan, next_at),
                       order=order)


def build_timeline(t, settings, next_at=None, readings=None):
    """Expected timeline + automatic ambiguity detection for readings T1/T2."""
    r = set() if readings is None else readings
    main = _timeline(t, settings, next_at, readings=r)
    if public(_timeline(t, settings, next_at, order="kind")) != public(main):
        r.add("T1!")
    if "T2" in r and public(_timeline(t, settings, next_at, prep_rule="origin")) != public(main):
        r.add("T2!")
    return public(main)


# ---------------------------------------------------------------- 5.1/5.2 locate + cuesBetween
def locate(tl, e):
    """Segment index current at elapsed e: start <= e < end (half-open; an open segment from its
    start on). None at/after the total of a closed timeline. Reading R1 (half-open)."""
    for k, s in enumerate(tl["segments"]):
        if e < s["startMs"]:
            continue
        if s["endMs"] is None or e < s["endMs"]:
            return k
    return None


def cues_between(tl, frm, to, readings, variant="main"):
    """D29.9: cuesBetween(from, to]: only cues of the segment current at `to`, of those only the latest
    same-ms batch; plus the end cue when the end lies in the window. Reading C1: when `to` is at/after
    the total no segment is current, so only the end cue plays ('alt' also plays the last segment's
    latest batch)."""
    if to <= frm:
        return []
    cur = locate(tl, to)
    total = tl["totalMs"]
    if cur is None and total is not None and to >= total:
        readings.add("C1")
        if variant == "alt":
            cur = len(tl["segments"]) - 1
    out = []
    cand = [c for c in tl["cues"] if frm < c["atMs"] <= to and c["kind"] != "end" and c["_seg"] == cur]
    if cand:
        m = max(c["atMs"] for c in cand)
        out = [c for c in cand if c["atMs"] == m]
    if total is not None and frm < total <= to:
        out += [c for c in tl["cues"] if c["kind"] == "end"]
    return [{"atMs": c["atMs"], "kind": c["kind"], "text": c["text"]} for c in out]


def cues_between_case(t, settings, next_at, windows, readings):
    tl = _timeline(t, settings, next_at)
    res, alt = [], []
    for a, b in windows:
        res.append(cues_between(tl, a, b, readings))
        alt.append(cues_between(tl, a, b, set(), "alt"))
    if res != alt:
        readings.add("C1!")
    return {"windows": res}


# ---------------------------------------------------------------- 5.2 runner
class Runner:
    """SPEC 5.2 state machine {idle, running, paused, ended}; elapsed = now - base while running."""

    def __init__(self, t, settings, readings):
        self.t, self.cf, self.endc = t, settings["countdownFrom"], t["prefs"]["endCue"]
        self.plan = plan_of(t)
        self.open_ends, self.ext = {}, {}
        self.state, self.base, self.frozen = "idle", None, 0
        self.r = readings
        self.tl = None
        self.rebuild()

    def rebuild(self):
        self.tl = materialize(self.plan, self.cf, self.endc, self.open_ends, self.ext)

    def elapsed(self, now):
        return now - self.base if self.state == "running" else self.frozen

    def _set(self, now, e):
        if self.state == "running":
            self.base = now - e
        else:
            self.frozen = e

    def _paused_nav(self):
        if self.state == "paused":
            self.r.add("R4!")  # skip/back/+30 s while paused: stays paused (reading R4)

    def step(self, now, op):
        total = self.tl["totalMs"]
        if self.state == "running" and total is not None and now - self.base >= total:
            self.state, self.frozen = "ended", total  # reading R2: the run ends itself at the total
            self.r.add("R2!")
        e = self.elapsed(now)
        live = self.state in ("running", "paused")
        if op == "start":
            if self.state == "idle":
                self.state, self.base, e = "running", now, 0
        elif op == "pause":
            if self.state == "running":
                self.state, self.frozen = "paused", e
        elif op == "resume":
            if self.state == "paused":
                self.state, self.base = "running", now - self.frozen
        elif op == "skip" and live:
            self._paused_nav()
            k = locate(self.tl, e)
            seg = self.tl["segments"][k]
            if seg["endMs"] is None:  # reading R5: Skip on an open interval acts as Next
                self.r.add("R5!")
                self.open_ends[k] = max(e, seg["startMs"])
                self.rebuild()
                e = self.tl["segments"][k]["endMs"]
                self._set(now, e)
            elif k == len(self.tl["segments"]) - 1 and self.tl["totalMs"] is not None:
                self.r.add("R3!")  # reading R3: Skip on the last segment ends the run at the total
                e = self.tl["totalMs"]
                self.state, self.frozen = "ended", e
            else:
                e = seg["endMs"]
                self._set(now, e)
        elif op == "back" and live:
            self._paused_nav()
            k = locate(self.tl, e)
            seg = self.tl["segments"][k]
            if e - seg["startMs"] < BACK_MS and k > 0:
                e = self.tl["segments"][k - 1]["startMs"]
            else:
                e = seg["startMs"]
            self._set(now, e)
        elif op == "addTime" and live:
            self._paused_nav()
            k = locate(self.tl, e)
            if self.tl["segments"][k]["endMs"] is None:
                self.r.add("R6!")  # reading R6: +30 s on an open interval does nothing
            else:
                self.ext[k] = self.ext.get(k, 0) + ADD_MS
                self.rebuild()
        elif op == "next" and live:
            k = locate(self.tl, e)
            seg = self.tl["segments"][k]
            if seg["endMs"] is None:  # SPEC 5.1 rebase at the user's Next
                self.open_ends[k] = max(e, seg["startMs"])
                self.rebuild()
            else:
                self.r.add("R7")  # Next outside an open interval: no-op (README R7)
        elif op == "end":
            if live:
                self.state, self.frozen = "ended", e
        elif op == "probe":
            pass
        elif op in ("skip", "back", "addTime", "next"):
            pass  # not live: no-op (R7)
        else:
            raise ValueError(op)
        out = {"state": self.state, "elapsedMs": e, "totalMs": self.tl["totalMs"]}
        if self.state in ("running", "paused"):
            k = locate(self.tl, e)
            seg = self.tl["segments"][k]
            out["segmentIndex"] = k
            out["remainingMs"] = None if seg["endMs"] is None else seg["endMs"] - e
        if self.state == "idle":
            out["elapsedMs"] = 0
        return out


def run_script(t, settings, script, readings):
    r = Runner(t, settings, readings)
    out = {"steps": [r.step(s["t"], s["op"]) for s in script]}
    if any(s["op"] in ("addTime", "next") for s in script) or "R5!" in readings:
        out["timeline"] = public(r.tl)  # the timeline after the script (+30 s / Next rebuild it, D29.8)
    return out


# ---------------------------------------------------------------- D29.10 recovery
def replay(t, settings, events):
    plan = plan_of(t)
    open_ends, ext = {}, {}
    tl = materialize(plan, settings["countdownFrom"], t["prefs"]["endCue"])
    for ev in events:
        k = locate(tl, ev["atElapsedMs"])
        if k is None:
            continue
        seg = tl["segments"][k]
        if ev["op"] == "next" and seg["endMs"] is None:
            open_ends[k] = max(ev["atElapsedMs"], seg["startMs"])
        elif ev["op"] == "addTime" and seg["endMs"] is not None:
            ext[k] = ext.get(k, 0) + ADD_MS
        tl = materialize(plan, settings["countdownFrom"], t["prefs"]["endCue"], open_ends, ext)
    return tl


def evaluate_recovery(case, readings):
    """case: {record: {state, startedAtWallMs, baseWallMs, elapsedMs, savedAtWallMs, events}, timer,
    settings, nowWallMs}. Returns the scored decision fields."""
    rec, now = case["record"], case["nowWallMs"]
    st = rec["state"]
    if st in ("ended", "idle"):
        return {"decision": "none"}
    tl = replay(case["timer"], case["settings"], rec.get("events", []))
    total = tl["totalMs"]
    age = now - rec["savedAtWallMs"]
    if st == "paused":
        if age == PAUSED_MAX_MS:
            readings.add("REC2!")  # exactly 24 h: 'after 24 h' read as strictly more than 24 h
        if total is None and age > OPEN_MAX_MS:
            readings.add("REC3!")  # paused AND open-ended past 2 h: the 24 h paused rule wins
        if age > PAUSED_MAX_MS:
            return {"decision": "partial", "completed": False}
        e = rec["elapsedMs"]
        return {"decision": "resume", "elapsedMs": e, "segmentIndex": locate(tl, e)}
    # running: resume at the wall-clock elapsed (D29.10)
    wall_e = now - rec["baseWallMs"]
    if wall_e < rec["elapsedMs"]:
        readings.add("REC1!")  # reading REC1: never resume before the recorded elapsed
    e = max(wall_e, rec["elapsedMs"])
    if total is None:
        a1 = now - rec["savedAtWallMs"] > OPEN_MAX_MS
        a2 = now - rec["startedAtWallMs"] > OPEN_MAX_MS
        if a1 != a2:
            readings.add("REC4!")  # 'older than 2 h': since the save vs since the start
        if now - rec["savedAtWallMs"] == OPEN_MAX_MS or now - rec["startedAtWallMs"] == OPEN_MAX_MS:
            readings.add("REC2!")
        if a1:
            return {"decision": "partial", "completed": False}
        return {"decision": "resume", "elapsedMs": e, "segmentIndex": locate(tl, e)}
    if e >= total:
        return {"decision": "finished", "elapsedMs": total, "completed": True}
    return {"decision": "resume", "elapsedMs": e, "segmentIndex": locate(tl, e)}


# ---------------------------------------------------------------- 5.3 validation
def _int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def len_cp(s):
    return len(s)


def len_utf16(s):
    return len(s.encode("utf-16-le")) // 2


def graphemes_may_differ(s):
    """True when a grapheme count could differ from the code-point count (combining marks, ZWJ,
    variation selectors, skin-tone modifiers, regional indicators)."""
    for ch in s:
        o = ord(ch)
        if unicodedata.combining(ch) or unicodedata.category(ch) in ("Mn", "Me", "Cf") or \
                0xFE00 <= o <= 0xFE0F or 0x1F3FB <= o <= 0x1F3FF or 0x1F1E6 <= o <= 0x1F1FF or o == 0x200D:
            return True
    return False


def plan_total_ms(t):
    return sum(p["ms"] for p in plan_of(t))


def validate(t, readings):
    """SPEC 5.3 + the SS4 column ranges. Rule ids: seconds, rounds, blocks, intervals, name, total,
    plus (SS4 ranges, reading V3) prep, repeat, rest; (V2) empty for 0 blocks / 0 intervals."""
    rules = set()
    names = [t["name"]] + [b["name"] for b in t["blocks"]] + [i["name"] for b in t["blocks"] for i in b["intervals"]]
    for n in names:
        cp, u16 = len_cp(n), len_utf16(n)
        if (cp > 40) != (u16 > 40) or (graphemes_may_differ(n) and cp > 40):
            readings.add("V1!")
        if cp > 40:  # reading V1: characters = Unicode code points
            rules.add("name")
    nums_ok = True
    if len(t["blocks"]) > 20:
        rules.add("blocks")
    if len(t["blocks"]) == 0:
        rules.add("empty")
        readings.add("V2!")
    p = t["prefs"]
    if not _int(p["prepSeconds"]) or not 0 <= p["prepSeconds"] <= 60:
        rules.add("prep"); readings.add("V3!"); nums_ok = False
    if not _int(p["repeatWhole"]) or not 1 <= p["repeatWhole"] <= 10:
        rules.add("repeat"); readings.add("V3!"); nums_ok = False
    for b in t["blocks"]:
        if len(b["intervals"]) > 30:
            rules.add("intervals")
        if len(b["intervals"]) == 0:
            rules.add("empty"); readings.add("V2!")
        if not _int(b["rounds"]) or not 1 <= b["rounds"] <= 99:
            rules.add("rounds"); nums_ok = False
        if not _int(b["restBetweenRoundsS"]) or not 0 <= b["restBetweenRoundsS"] <= 5999:
            rules.add("rest"); readings.add("V3!"); nums_ok = False
        for i in b["intervals"]:
            if not _int(i["seconds"]):
                rules.add("seconds"); readings.add("V4!"); nums_ok = False
            elif not 1 <= i["seconds"] <= 5999:
                rules.add("seconds"); nums_ok = False
    if nums_ok and plan_total_ms(t) > MAX_TOTAL_MS:  # total incl. prep, repeats, round rests
        rules.add("total")
    if len(rules) > 1:
        readings.add("V5!")  # every violated rule is reported (inline messages per field)
    return {"valid": not rules, "rules": sorted(rules)}


# ---------------------------------------------------------------- 5.4 format
def fmt_seconds(s):
    """SPEC 5.4 'mm:ss / h:mm:ss' read literally: two-digit minutes below one hour, unpadded hours
    from one hour on; Western digits in every UI language (Arabic explicitly)."""
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    return f"{h}:{m:02d}:{sec:02d}" if h else f"{m:02d}:{sec:02d}"


def block_total_s(b):
    return sum(i["seconds"] for i in b["intervals"]) * b["rounds"] + b["restBetweenRoundsS"] * (b["rounds"] - 1)


def format_case(inp):
    if inp["op"] == "duration":
        return {"text": fmt_seconds(inp["seconds"])}
    if inp["op"] == "blockTotal":
        s = block_total_s(inp["block"])
        return {"seconds": s, "text": fmt_seconds(s)}
    if inp["op"] == "timerTotal":
        ms = plan_total_ms(inp["timer"])
        return {"totalMs": ms, "text": fmt_seconds(ms // 1000)}
    raise ValueError(inp["op"])


# ---------------------------------------------------------------- 5.5 share codec
def share_case(inp, readings):
    op = inp["op"]
    if op in ("roundtrip", "unknownField"):
        notes = inp.get("compareNotes", False)
        if notes:
            readings.add("SH1!")
        out = {"ok": True, "timer": canonical(inp["timer"], with_notes=notes)}
        if op == "roundtrip":
            out["linkPrefix"] = LINK_PREFIX
        return out
    if op == "tamper":
        v = validate(_tampered(inp), set())
        return {"ok": v["valid"]}
    if op == "import":
        return {"ok": False}
    raise ValueError(op)


def _tampered(inp):
    """The timer the engine would see after the marker replacement (for the oracle's own check)."""
    s = json.dumps(inp["timer"], ensure_ascii=False)
    assert s.count(inp["find"]) == 1, inp
    return json.loads(s.replace(inp["find"], inp["replace"]))


# ---------------------------------------------------------------- 5.7 stats
def _day(ms, tz):
    return datetime.fromtimestamp(ms / 1000, tz).date()


def _stats(sessions, tz, now_ms, day_of="start", streak_from="lenient", streak_counts="all"):
    per_day, per_week, per_month = {}, {}, {}
    days = set()
    for s in sessions:
        d = _day(s["startedAt"] if day_of == "start" else s["endedAt"], tz)
        if streak_counts == "all" or s["completed"]:
            days.add(d)
        iso = d.isocalendar()
        for bucket, key in ((per_day, d.isoformat()), (per_week, f"{iso[0]:04d}-W{iso[1]:02d}"),
                            (per_month, f"{d.year:04d}-{d.month:02d}")):
            e = bucket.setdefault(key, {"sessions": 0, "actualS": 0})
            e["sessions"] += 1
            e["actualS"] += s["actualS"]
    longest, run, prev = 0, 0, None
    for d in sorted(days):
        run = run + 1 if prev is not None and d - prev == timedelta(days=1) else 1
        longest = max(longest, run)
        prev = d
    today = _day(now_ms, tz)
    anchor = today if today in days else None
    if anchor is None and streak_from == "lenient" and today - timedelta(days=1) in days:
        anchor = today - timedelta(days=1)
    current = 0
    while anchor is not None and anchor in days:
        current += 1
        anchor -= timedelta(days=1)
    counts = Counter(s["timerName"] for s in sessions)
    return {
        "sessions": len(sessions),
        "completedSessions": sum(1 for s in sessions if s["completed"]),
        "actualS": sum(s["actualS"] for s in sessions),
        "plannedS": sum(s["plannedS"] for s in sessions if s["plannedS"] is not None),
        "perDay": dict(sorted(per_day.items())),
        "perWeek": dict(sorted(per_week.items())),
        "perMonth": dict(sorted(per_month.items())),
        "streakCurrent": current,
        "streakLongest": longest,
        "mostUsed": dict(sorted(counts.items())),
    }


def stats_case(inp, readings):
    tz = ZoneInfo(inp["zone"])
    main = _stats(inp["sessions"], tz, inp["nowMs"])
    if _stats(inp["sessions"], tz, inp["nowMs"], day_of="end") != main:
        readings.add("S1!")  # a session's day = local date of its START
    if _stats(inp["sessions"], tz, inp["nowMs"], streak_from="strict") != main:
        readings.add("S2!")  # the current streak survives a day that has no session YET
    if _stats(inp["sessions"], tz, inp["nowMs"], streak_counts="completed") != main:
        readings.add("S3!")  # every saved session counts for the streak, ended early or not
    top = max(main["mostUsed"].values())
    tops = [n for n, c in main["mostUsed"].items() if c == top]
    assert len(tops) == 1, "most-used must be unique by design"
    main["topTimer"] = tops[0]
    return main


# ---------------------------------------------------------------- 5.6 CSV
def guarded(v):
    return isinstance(v, str) and v.startswith(FORMULA_START)


def csv_case(inp):
    """Every session must appear as one row holding its timer name and note cells, each either
    verbatim or (formula lead character) with exactly one neutral guard character in front."""
    rows = []
    for s in inp["sessions"]:
        cells = []
        for v in (s["timerName"], s["note"]):
            cells.append({"value": v, "guard": guarded(v)})
        rows.append({"cells": cells})
    return {"dataRows": len(inp["sessions"]), "rows": rows}


def reference_csv(sessions, guard_char="'", eol="\r\n"):
    """A reference writer (self-test only): RFC 4180 quoting + guard."""
    def cell(v):
        if v is None:
            return ""
        if isinstance(v, bool):
            v = "1" if v else "0"
        v = str(v)
        if guarded(v):
            v = guard_char + v
        if any(c in v for c in ',"\r\n'):
            v = '"' + v.replace('"', '""') + '"'
        return v
    keys = ["timerName", "startedAt", "endedAt", "plannedS", "actualS", "completed", "skippedIntervals", "pauses", "note"]
    lines = [",".join(keys)] + [",".join(cell(s[k]) for k in keys) for s in sessions]
    return eol.join(lines) + eol


def csv_records(text):
    return list(csv.reader(io.StringIO(text, newline="")))


def record_terminators_ok(text):
    """RFC 4180 2.1: every record ends with CRLF (the last one may end at EOF)."""
    q = False
    i = 0
    while i < len(text):
        c = text[i]
        if c == '"':
            q = not q
        elif not q and c == "\n":
            if i == 0 or text[i - 1] != "\r":
                return False
        elif not q and c == "\r":
            if i + 1 >= len(text) or text[i + 1] != "\n":
                return False
        i += 1
    return True


# ---------------------------------------------------------------- 5.6 backup restore
SESSION_KEYS = ("timerName", "startedAt", "endedAt", "plannedS", "actualS", "completed",
                "skippedIntervals", "pauses", "note")


def skey(x):
    return json.dumps(x, sort_keys=True, ensure_ascii=False)


def backup_case(inp, readings, _full=None):
    """initial -> export backup -> mutations -> restore(mode) [into a fresh database if fresh]."""
    timers = {f"T{n}": t for n, t in enumerate(inp["initial"]["timers"])}
    sessions = {f"S{n}": s for n, s in enumerate(inp["initial"]["sessions"])}
    backup_t, backup_s = dict(timers), dict(sessions)
    nt = len(timers); ns = len(sessions)
    for m in inp.get("mutations", []):
        if m["op"] == "editTimer":
            timers[f"T{m['ref']}"] = m["timer"]
        elif m["op"] == "deleteTimer":
            del timers[f"T{m['ref']}"]
        elif m["op"] == "addTimer":
            timers[f"T{nt}"] = m["timer"]; nt += 1
        elif m["op"] == "addSession":
            sessions[f"S{ns}"] = m["session"]; ns += 1
        elif m["op"] == "deleteSession":
            del sessions[f"S{m['ref']}"]
        else:
            raise ValueError(m)
    before_t, before_s = dict(timers), dict(sessions)
    if "hostile" in inp:
        return {"ok": False,
                "timers": sorted((canonical(t) for t in before_t.values()), key=skey),
                "sessions": sorted(({k: s[k] for k in SESSION_KEYS} for s in before_s.values()), key=skey)}
    if inp.get("fresh"):
        timers, sessions = {}, {}
    mode = inp["mode"]
    copies = []
    for k, t in backup_t.items():
        if k in timers and mode == "keepBoth":
            if canonical(timers[k]) == canonical(t):
                readings.add("BK1!")  # keep both duplicates even an unchanged timer
            copies.append(t)
        else:
            timers[k] = t
    scopies = []
    for k, s in backup_s.items():
        if k in sessions and mode == "keepBoth":
            readings.add("BK2!")  # a session id present on both sides under keep-both: both kept
            scopies.append(s)
        else:
            sessions[k] = s
    if _full is not None:  # self-test only: the final rows as an engine would hold them
        _full["timers"] = [(t, False) for t in timers.values()] + [(t, True) for t in copies]
        _full["sessions"] = list(sessions.values()) + scopies
    all_s = sorted(({k: s[k] for k in SESSION_KEYS} for s in list(sessions.values()) + scopies), key=skey)
    out = {"ok": True, "sessions": all_s}
    if mode == "replace":
        out["timers"] = sorted((canonical(t) for t in timers.values()), key=skey)
    else:
        allt = list(timers.values()) + copies
        out["timerCount"] = len(allt)
        out["timersWithoutName"] = sorted((canonical(t, with_name=False) for t in allt), key=skey)
        out["namesPresent"] = sorted(t["name"] for t in timers.values())
    if inp.get("settings") is not None:
        readings.add("BK3!")  # settings restored with the backup on a fresh install
        out["settings"] = dict(inp["settings"])
    return out
