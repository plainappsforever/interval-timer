"""Independent oracle for blind set B2 (interval timer).

Written from docs/SPEC.md sections 4-5, docs/DECISIONS.md D28-D34 and test/fixtures/timeline/FORMAT.md only.
The author never read src/engine/ or any other fixture set. Python 3 standard library only (run with `python3 -I`).

Every expected value of the set is computed by the functions in this file; nothing is typed in by hand
except the case inputs (b2_cases.py) and a handful of hand-derived anchor values in selftest.py.
"""

import datetime
import json
import zoneinfo

KIND_RANK = {"round": 0, "start": 1, "halfway": 2, "countdown": 3, "openTick": 4, "end": 5}
LIMITS = {
    "seconds": (1, 5999),
    "rounds": (1, 99),
    "blocks": 20,
    "intervals": 30,
    "name_cp": 40,
    "total_ms": 8 * 3600 * 1000,
}
ADD_TIME_MS = 30000
BACK_THRESHOLD_MS = 2000


# --------------------------------------------------------------------------------------------- timeline
def _specs(timer):
    """Planned segment list (before laying out times). FORMAT.md 'Segment order' + D29.1-D29.5, D32."""
    prefs = timer["prefs"]
    specs = []
    if prefs["prepSeconds"] > 0:
        specs.append({
            "type": "prep", "label": "Get ready", "ms": prefs["prepSeconds"] * 1000, "seconds": prefs["prepSeconds"],
            "startMode": "both", "countdown": True, "halfway": False, "open": False, "tick": 0, "roundText": None,
        })
    for _rep in range(prefs["repeatWhole"]):
        for b in timer["blocks"]:
            n_rounds = b["rounds"]
            for r in range(n_rounds):
                for ii, iv in enumerate(b["intervals"]):
                    is_open = iv["type"] == "open"
                    specs.append({
                        "type": iv["type"], "label": iv["name"],
                        "ms": None if is_open else iv["seconds"] * 1000, "seconds": iv["seconds"],
                        "startMode": iv["cueStart"],
                        # D32: an interval typed 'prep' follows its own flags; open never gets countdown/halfway
                        "countdown": bool(iv["countdownCue"]) and not is_open,
                        "halfway": bool(iv["halfwayCue"]) and not is_open and iv["seconds"] >= 10,
                        "open": is_open, "tick": iv.get("openTickS", 0) if is_open else 0,
                        "roundText": ("Round %d of %d" % (r + 1, n_rounds)) if (n_rounds > 1 and ii == 0) else None,
                    })
                if r < n_rounds - 1 and b["restBetweenRoundsS"] > 0:
                    specs.append({
                        "type": "rest", "label": "Rest", "ms": b["restBetweenRoundsS"] * 1000,
                        "seconds": b["restBetweenRoundsS"], "startMode": "both", "countdown": True, "halfway": False,
                        "open": False, "tick": 0, "roundText": None,
                    })
    return specs


def layout(timer, settings, closes=None, extras=None):
    """Lay out absolute times. closes = elapsed ms of each Next in order (FORMAT nextAt);
    extras = {spec index: extra ms} from +30 s (D29.8: countdown moves with the end, halfway stays)."""
    closes = list(closes or [])
    extras = dict(extras or {})
    cf = settings.get("countdownFrom", 3)
    specs = _specs(timer)
    segs, cues = [], []
    t, ci, seq = 0, 0, 0
    cut = False

    def cue(at, kind, text):
        nonlocal seq
        cues.append({"atMs": at, "kind": kind, "text": text, "_seq": seq})
        seq += 1

    for si, sp in enumerate(specs):
        start = t
        if sp["open"]:
            if ci < len(closes):
                end = max(closes[ci], start)
                ci += 1
            else:
                end = None
        else:
            end = start + sp["ms"] + extras.get(si, 0)
        segs.append({"startMs": start, "endMs": end, "type": sp["type"], "label": sp["label"],
                     "_spec": si, "_open": sp["open"], "_tick": sp["tick"]})
        if sp["roundText"] is not None:
            cue(start, "round", sp["roundText"])
        if sp["startMode"] != "none":
            cue(start, "start", sp["label"])
        if sp["halfway"]:
            cue(start + sp["seconds"] * 500, "halfway", "Halfway")
        if sp["countdown"] and end is not None:
            for k in range(cf, 0, -1):
                at = end - k * 1000
                if at > start:
                    cue(at, "countdown", str(k))
        if end is None:
            cut = True
            break
        t = end
    total = None if cut else t
    if total is not None and timer["prefs"]["endCue"] != "none":
        cue(total, "end", "Done")
    cues.sort(key=lambda c: (c["atMs"], KIND_RANK[c["kind"]], c["_seq"]))
    return {"totalMs": total, "segments": segs, "cues": cues}


def public_timeline(tl):
    return {
        "totalMs": tl["totalMs"],
        "segments": [{"startMs": s["startMs"], "endMs": s["endMs"], "type": s["type"], "label": s["label"]}
                     for s in tl["segments"]],
        "cues": [{"atMs": c["atMs"], "kind": c["kind"], "text": c["text"]} for c in tl["cues"]],
    }


def build_timeline(case):
    return public_timeline(layout(case["timer"], case.get("settings", {}), case.get("nextAt")))


def locate(tl, e):
    """Index of the segment with start <= e < end (open: end None). None when e is at/after the total."""
    for i, s in enumerate(tl["segments"]):
        if s["startMs"] <= e and (s["endMs"] is None or e < s["endMs"]):
            return i
    return None


def tick_times(seg, lo, hi):
    """openTick times of an open segment in (lo, hi] (D29.7: start + j*T, j >= 1, before the segment end)."""
    out = []
    t_s = seg["_tick"]
    if not seg["_open"] or t_s <= 0:
        return out
    step = t_s * 1000
    j = 1
    while True:
        at = seg["startMs"] + j * step
        if at > hi:
            break
        if seg["endMs"] is not None and at >= seg["endMs"]:
            break
        if at > lo:
            out.append(at)
        j += 1
    return out


def cues_between(tl, frm, to):
    """D29.9: (from, to]; only cues of the segment current at `to`, only the latest same-ms batch;
    the end cue when the end lies in the window. Window ending at/after the total: [end] only (reading A7)."""
    total = tl["totalMs"]
    if total is not None and to >= total:
        return [{"atMs": c["atMs"], "kind": c["kind"], "text": c["text"]}
                for c in tl["cues"] if c["kind"] == "end" and frm < c["atMs"] <= to]
    k = locate(tl, to)
    seg = tl["segments"][k]
    cand = [c for c in tl["cues"] if frm < c["atMs"] <= to and c["atMs"] >= seg["startMs"] and c["kind"] != "end"]
    for at in tick_times(seg, frm, to):
        cand.append({"atMs": at, "kind": "openTick", "text": None, "_seq": 10 ** 9})
    if not cand:
        return []
    last = max(c["atMs"] for c in cand)
    batch = sorted([c for c in cand if c["atMs"] == last], key=lambda c: (KIND_RANK[c["kind"]], c["_seq"]))
    return [{"atMs": c["atMs"], "kind": c["kind"], "text": c["text"]} for c in batch]


def next_cue_after(tl, e):
    """Earliest cue time strictly after e (ticks included) and the kinds at that ms in order."""
    cand = [(c["atMs"], KIND_RANK[c["kind"]], c["kind"]) for c in tl["cues"] if c["atMs"] > e]
    for s in tl["segments"]:
        if s["_open"] and s["_tick"] > 0:
            # first tick strictly after e
            step = s["_tick"] * 1000
            j = max(1, (e - s["startMs"]) // step + 1)
            at = s["startMs"] + j * step
            while at <= e:
                j += 1
                at = s["startMs"] + j * step
            if s["endMs"] is None or at < s["endMs"]:
                cand.append((at, KIND_RANK["openTick"], "openTick"))
    if not cand:
        return None
    first = min(c[0] for c in cand)
    kinds = [c[2] for c in sorted([c for c in cand if c[0] == first], key=lambda c: c[1])]
    return {"atMs": first, "kinds": kinds}


# --------------------------------------------------------------------------------------------- runner (D33)
class Runner:
    """Pure state machine of SPEC 5.2 with the D33 rules. Readings for the ambiguous corners are marked."""

    def __init__(self, timer, settings):
        self.timer, self.settings = timer, settings
        self.state = "idle"
        self.e0 = 0          # elapsed at t0 (running) / frozen elapsed (paused, ended)
        self.t0 = 0
        self.extras = {}
        self.closes = []
        self.started_at = None
        self.paused_at = None
        self.tl = layout(timer, settings)

    def _relayout(self):
        self.tl = layout(self.timer, self.settings, self.closes, self.extras)

    def raw(self, now):
        if self.state == "running":
            return self.e0 + (now - self.t0)
        return self.e0

    def settle(self, now):
        if self.state == "running":
            total = self.tl["totalMs"]
            if total is not None and self.raw(now) >= total:
                self.state, self.e0 = "ended", total

    def apply(self, action, now):
        self.settle(now)
        st = self.state
        if action == "start":
            if st == "idle":
                self.state, self.e0, self.t0, self.started_at = "running", 0, now, now
        elif action == "pause" or (action == "toggle" and st == "running"):
            if st == "running":
                self.state, self.e0, self.paused_at = "paused", self.raw(now), now
        elif action == "resume" or (action == "toggle" and st == "paused"):
            if st == "paused":
                self.state, self.t0 = "running", now
        elif action == "toggle":
            pass  # idle / ended: no-op (reading A8 for idle)
        elif action == "skip":
            if st in ("running", "paused"):
                e = self.raw(now)
                k = locate(self.tl, e)
                segs = self.tl["segments"]
                target = segs[k + 1]["startMs"] if k + 1 < len(segs) else self.tl["totalMs"]
                self.e0, self.t0 = target, now  # paused stays paused (reading A6)
        elif action == "back":
            if st in ("running", "paused"):
                e = self.raw(now)
                k = locate(self.tl, e)
                seg = self.tl["segments"][k]
                if e - seg["startMs"] < BACK_THRESHOLD_MS and k > 0:
                    target = self.tl["segments"][k - 1]["startMs"]
                else:
                    target = seg["startMs"]
                self.e0, self.t0 = target, now
        elif action == "addTime":
            if st in ("running", "paused"):
                e = self.raw(now)
                k = locate(self.tl, e)
                seg = self.tl["segments"][k]
                if not seg["_open"]:
                    si = seg["_spec"]
                    self.extras[si] = self.extras.get(si, 0) + ADD_TIME_MS
                    self._relayout()
        elif action == "next":
            if st in ("running", "paused"):
                e = self.raw(now)
                k = locate(self.tl, e)
                seg = self.tl["segments"][k]
                if seg["_open"] and seg["endMs"] is None:
                    self.closes.append(e)
                    self._relayout()
        elif action == "end":
            if st in ("running", "paused"):
                self.state, self.e0 = "ended", self.raw(now)
        elif action == "view":
            pass
        else:
            raise ValueError(action)
        self.settle(now)

    def view(self, now):
        self.settle(now)
        v = {"state": self.state, "totalMs": self.tl["totalMs"]}
        if self.state == "idle":
            v.update({"elapsedMs": 0, "segmentIndex": None, "remainingMs": None})
        elif self.state == "ended":
            v.update({"elapsedMs": self.e0, "segmentIndex": None, "remainingMs": None})
        else:
            e = self.raw(now)
            k = locate(self.tl, e)
            seg = self.tl["segments"][k]
            v.update({"elapsedMs": e, "segmentIndex": k,
                      "remainingMs": None if seg["endMs"] is None else seg["endMs"] - e})
        return v


def run_steps(case):
    r = Runner(case["timer"], case.get("settings", {}))
    out = []
    for st in case["steps"]:
        r.apply(st["do"], st["at"])
        out.append(r.view(st["at"]))
    return out, r


# --------------------------------------------------------------------------------------------- recovery (D29.10)
DAY_MS = 24 * 3600 * 1000
OPEN_MAX_MS = 2 * 3600 * 1000


def recover(case):
    _views, r = run_steps(case)
    w = case["relaunchAt"]
    if r.state == "running":
        e = r.raw(w)
        total = r.tl["totalMs"]
        if total is not None and e >= total:
            return {"decision": "finished", "elapsedMs": total, "totalMs": total, "completed": True,
                    "interrupted": True}
        if total is None and e > OPEN_MAX_MS and (w - r.started_at) > OPEN_MAX_MS:
            return {"decision": "partial", "completed": False, "totalMs": None}
        k = locate(r.tl, e)
        seg = r.tl["segments"][k]
        return {"decision": "resume", "state": "running", "elapsedMs": e, "segmentIndex": k,
                "remainingMs": None if seg["endMs"] is None else seg["endMs"] - e, "totalMs": total,
                "nextCue": next_cue_after(r.tl, e)}
    if r.state == "paused":
        if w - r.paused_at > DAY_MS:
            return {"decision": "partial", "completed": False, "elapsedMs": r.e0, "totalMs": r.tl["totalMs"]}
        k = locate(r.tl, r.e0)
        seg = r.tl["segments"][k]
        return {"decision": "resume", "state": "paused", "elapsedMs": r.e0, "segmentIndex": k,
                "remainingMs": None if seg["endMs"] is None else seg["endMs"] - r.e0, "totalMs": r.tl["totalMs"]}
    raise ValueError("recovery cases must die while running or paused")


# --------------------------------------------------------------------------------------------- format (D30)
def format_duration(seconds):
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    if seconds < 3600:
        return "%02d:%02d" % (seconds // 60, s)
    return "%d:%02d:%02d" % (h, m, s)


# --------------------------------------------------------------------------------------------- validation (5.3, D31)
def name_len(s):
    return len(s)  # Python str length = code points; a lone surrogate from JSON counts 1 (D31)


def clamp_name(s):
    return s[:LIMITS["name_cp"]]


def validate(timer):
    """Returns (valid, list of reasons). Settings are irrelevant for the total (no countdown effect on lengths)."""
    reasons = []
    if name_len(timer["name"]) > LIMITS["name_cp"]:
        reasons.append("timer name > 40 code points")
    blocks = timer["blocks"]
    if len(blocks) > LIMITS["blocks"]:
        reasons.append("more than 20 blocks")
    for b in blocks:
        if name_len(b["name"]) > LIMITS["name_cp"]:
            reasons.append("block name > 40 code points")
        if not (LIMITS["rounds"][0] <= b["rounds"] <= LIMITS["rounds"][1]):
            reasons.append("rounds out of 1..99")
        if len(b["intervals"]) > LIMITS["intervals"]:
            reasons.append("more than 30 intervals in a block")
        for iv in b["intervals"]:
            if name_len(iv["name"]) > LIMITS["name_cp"]:
                reasons.append("interval name > 40 code points")
            if not (LIMITS["seconds"][0] <= iv["seconds"] <= LIMITS["seconds"][1]):
                reasons.append("seconds out of 1..5999")
    if not reasons:
        total = layout(timer, {})["totalMs"]
        if total is not None and total > LIMITS["total_ms"]:
            reasons.append("total %d ms > 8 h" % total)
    return (not reasons), reasons


# --------------------------------------------------------------------------------------------- stats (D34)
def local_dt(ms, tz):
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).astimezone(zoneinfo.ZoneInfo(tz))


def bucket_keys(ms, tz):
    d = local_dt(ms, tz).date()
    y, w, _ = d.isocalendar()
    return {"day": d.isoformat(), "week": "%04d-W%02d" % (y, w), "month": "%04d-%02d" % (d.year, d.month)}


def totals(sessions, tz, period):
    out = {}
    for s in sessions:
        key = bucket_keys(s["startedAt"], tz)[period]
        b = out.setdefault(key, {"count": 0, "actualS": 0})
        b["count"] += 1
        b["actualS"] += s["actualS"]
    return dict(sorted(out.items()))


def streak(sessions, tz, now_ms):
    days = {local_dt(s["startedAt"], tz).date() for s in sessions}
    d = local_dt(now_ms, tz).date()
    n = 0
    while d in days:
        n += 1
        d = d - datetime.timedelta(days=1)
    return n


# --------------------------------------------------------------------------------------------- CSV guard (5.6)
GUARD_CHARS = "=+-@\t\r"


def csv_guard(s):
    return "'" + s if s and s[0] in GUARD_CHARS else s


# --------------------------------------------------------------------------------------------- backup (5.6, P4b)
TIMER_CONTENT = ("name", "color", "notes", "blocks", "prefs")
SESSION_CONTENT = ("timerName", "startedAt", "endedAt", "plannedS", "actualS", "completed", "skippedIntervals",
                   "pauses", "note")


def _same_timer(a, b):
    return all(a[k] == b[k] for k in TIMER_CONTENT)


def _same_session(a, b):
    # The timer link is not part of a session's identity: a session whose timer was deleted after the export
    # (timerId nulled, SPEC 9) is still the same session (reading A12; P4b property "nothing duplicated").
    return all(a[k] == b[k] for k in SESSION_CONTENT)


def restore(current, backup, mode):
    """Returns (timers, sessions) with symbolic ids: existing ids stay, copies get ('copy', backup id)."""
    timers = {t["id"]: dict(t) for t in current["timers"]}
    order = [t["id"] for t in current["timers"]]
    tmap = {}
    for t in backup["timers"]:
        if t["id"] not in timers:
            timers[t["id"]] = dict(t)
            order.append(t["id"])
            tmap[t["id"]] = t["id"]
        elif mode == "replace":
            timers[t["id"]] = dict(t)
            tmap[t["id"]] = t["id"]
        elif _same_timer(timers[t["id"]], t):
            tmap[t["id"]] = t["id"]
        else:
            nid = ("copy", t["id"])
            c = dict(t)
            c["id"] = nid
            timers[nid] = c
            order.append(nid)
            tmap[t["id"]] = nid
    sessions = {s["id"]: dict(s) for s in current["sessions"]}
    sorder = [s["id"] for s in current["sessions"]]
    for s in backup["sessions"]:
        mapped = dict(s)
        mapped["timerId"] = None if s["timerId"] is None else tmap[s["timerId"]]
        if s["id"] not in sessions:
            sessions[s["id"]] = mapped
            sorder.append(s["id"])
        elif mode == "replace":
            sessions[s["id"]] = mapped
        elif _same_session(sessions[s["id"]], s):
            pass
        else:
            nid = ("copy", s["id"])
            mapped["id"] = nid
            sessions[nid] = mapped
            sorder.append(nid)
    return [timers[i] for i in order], [sessions[i] for i in sorder]


def backup_expected(case):
    timers, sessions = restore(case["current"], case["backup"], case["mode"])
    idx = {}
    exp_timers = []
    for i, t in enumerate(timers):
        idx[json.dumps(t["id"])] = i
        exp_timers.append({k: t[k] for k in TIMER_CONTENT})
    # Only ids that existed on the phone before the restore are id-checked; a non-clashing backup timer may keep
    # its id or get a new one (the attachment check covers it either way).
    current_ids = {t["id"] for t in case["current"]["timers"]}
    kept = {}
    for t in timers:
        if t["id"] in current_ids:
            kept[str(t["id"])] = idx[json.dumps(t["id"])]
    exp_sessions = []
    for s in sessions:
        exp_sessions.append({
            "content": {k: s[k] for k in SESSION_CONTENT},
            "timer": None if s["timerId"] is None else idx[json.dumps(s["timerId"])],
        })
    current_sids = {s["id"] for s in case["current"]["sessions"]}
    kept_sessions = {}
    for i, s in enumerate(sessions):
        if s["id"] in current_sids:
            kept_sessions[str(s["id"])] = i
    return {"timers": exp_timers, "idsWithContent": kept, "sessions": exp_sessions,
            "sessionIds": kept_sessions}


# --------------------------------------------------------------------------------------------- templates (D28)
def template_total_ms(blocks, prep):
    timer = {"name": "t", "color": "", "notes": "", "blocks": blocks,
             "prefs": {"prepSeconds": prep, "endCue": "both", "repeatWhole": 1, "vibrate": True}}
    return layout(timer, {})["totalMs"]
