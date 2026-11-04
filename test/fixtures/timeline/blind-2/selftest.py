"""Self-test of blind set B2.   python3 -I selftest.py

1. Rebuilds the set from oracle/ into a temp folder and checks it is byte-identical to the shipped files.
2. Oracle anchors: values derived BY HAND from SPEC/DECISIONS (not by the oracle code) must equal the oracle's output;
   ISO week labels are cross-checked against an independent Thursday-rule implementation over 2000-2040.
3. Checker: a perfect results file (synthesised from the expected data) scores 100 %; then every planted error must
   make exactly its own case fail (scored or ambiguous as labelled); tolerance controls must still pass.
Exit 0 = all good.  Writes nothing (no temp folders, no bytecode caches).
"""

import copy
import csv
import datetime
import io
import json
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "oracle"))

import checker  # noqa: E402
import b2_oracle as O  # noqa: E402
import b2_cases as C  # noqa: E402
import build_set  # noqa: E402

FAILS = []


def ok(cond, msg):
    if not cond:
        FAILS.append(msg)
        print("SELFTEST FAIL:", msg)


# ------------------------------------------------------------------------------------------- 1. reproducible
def reproducible():
    files, _ = build_set.render()
    on_disk = sorted("%s/%s" % (sub, fn) for sub in ("timers", "expected", "cases")
                     for fn in os.listdir(os.path.join(HERE, sub)))
    ok(on_disk == sorted(files), "set file list differs from a fresh oracle build")
    for rel, body in files.items():
        p = os.path.join(HERE, rel)
        ok(os.path.exists(p) and open(p, encoding="ascii").read() == body,
           "%s differs from a fresh oracle build" % rel)


# ------------------------------------------------------------------------------------------- 2. anchors
def by_id(cid):
    return next(c for c in C.CASES if c["id"] == cid)


def anchors():
    # Tabata (tl-01): prep 10 + 8 x (20 + 10) = 250 s; cues: prep start + 3 countdowns, per round
    # round + start + 3 + start + 3 = 9, end 1  -> 4 + 72 + 1 = 77.  FORMAT.md's example also says 250000.
    tl = O.build_timeline(by_id("tl-01"))
    ok(tl["totalMs"] == 250000, "anchor tl-01 total")
    ok(len(tl["cues"]) == 77, "anchor tl-01 cue count %d" % len(tl["cues"]))
    # tl-02: 10 s, countdown 10: k = 10 would be at the start (excluded) -> 9 countdowns + start + halfway + end
    tl = O.build_timeline(by_id("tl-02"))
    ok([c["kind"] for c in tl["cues"]][5:7] == ["halfway", "countdown"], "anchor tl-02 halfway before '5'")
    ok(len(tl["cues"]) == 12, "anchor tl-02 cue count")
    # tl-08 (D32): typed prep 20 s halfway on, countdown off -> halfway at 10000, no countdown before 20000
    tl = O.build_timeline(by_id("tl-08"))
    ok([(c["atMs"], c["kind"]) for c in tl["cues"] if c["atMs"] < 20000] == [(0, "start"), (10000, "halfway")],
       "anchor tl-08 typed prep")
    # tl-16: per block 3 x 6 x 60 + 2 x 60 = 1200 s, 3 blocks + prep 10 = 3610 s
    ok(O.build_timeline(by_id("tl-16"))["totalMs"] == 3610000, "anchor tl-16 total")
    # tl-31: 20 blocks x sum over i<30 of (i%5)+1 = 20 x 90 = 1800 s
    ok(O.build_timeline(by_id("tl-31"))["totalMs"] == 1800000, "anchor tl-31 total")
    # tl-32: 99 x 8 + 98 x 2 = 988 s
    ok(O.build_timeline(by_id("tl-32"))["totalMs"] == 988000, "anchor tl-32 total")
    # tl-20: Next at 100000 closes AMRAP; Cool 20 s -> total 120000
    ok(O.build_timeline(by_id("tl-20"))["totalMs"] == 120000, "anchor tl-20 total")
    # D30 examples
    for secs, s in [(0, "00:00"), (59, "00:59"), (599, "09:59"), (75, "01:15"), (250, "04:10"), (3599, "59:59"),
                    (3600, "1:00:00"), (5999, "1:39:59"), (28800, "8:00:00")]:
        ok(O.format_duration(secs) == s, "anchor format %d" % secs)
    # D31 code points
    ok(len(C.FAM) == 7 and len(C.FLAG) == 2 and len(C.NFD_E) == 2 and len(C.YOSHI) == 1, "anchor code points")
    ok(len(C.YOSHI.encode("utf-16-le")) // 2 == 2, "anchor YOSHI is 2 UTF-16 units")
    # va-22/23/24 totals: 10 + 4 x 5999 + 4793 = 28799 s (prep 12 -> 28801, prep 11 -> 28800)
    ok(O.layout(by_id("va-22")["timer"], {})["totalMs"] == 28799000, "anchor va-22 total")
    ok(O.validate(by_id("va-23")["timer"])[0] is False, "anchor va-23 invalid")
    # runner rn-13 by hand: back at e=26999 (1999 ms into Rest@25000) -> 5000; later e=37000 = 2000 ms into
    # round-rest@35000 -> restart 35000
    views, _ = O.run_steps(by_id("rn-13"))
    ok(views[1]["elapsedMs"] == 5000 and views[4]["elapsedMs"] == 35000, "anchor rn-13")
    # recovery rc-09: two +30 s on Work 1 -> it ends at 130000; Rest to 160000; 160000 = round-rest start (index 3)
    r = O.recover(by_id("rc-09"))
    ok(r["segmentIndex"] == 3 and r["totalMs"] == 910000, "anchor rc-09")
    # ISO weeks by hand: 2027-01-01 is a Friday -> week of Thursday 2026-12-31 -> 2026-W53 (D34's own example)
    ok(O.bucket_keys(by_id("sk-01")["atMs"], "Europe/Berlin")["week"] == "2026-W53", "anchor sk-01")
    # UTC-12 (Etc/GMT+12): 2027-01-04 11:59Z - 12 h = 2027-01-03 23:59 (Sunday)
    ok(O.bucket_keys(by_id("sk-04")["atMs"], "Etc/GMT+12")["day"] == "2027-01-03", "anchor sk-04 day")
    # independent ISO-week implementation (Thursday rule) vs the oracle's isocalendar over 2000-2040
    d = datetime.date(2000, 1, 1)
    while d.year <= 2040:
        thu = d + datetime.timedelta(days=3 - d.weekday())
        wk = (thu.timetuple().tm_yday - 1) // 7 + 1
        mine = "%04d-W%02d" % (thu.year, wk)
        y, w, _ = d.isocalendar()
        if mine != "%04d-W%02d" % (y, w):
            ok(False, "ISO week cross-check %s" % d)
            break
        d += datetime.timedelta(days=1)
    # backup bk-01: 7 templates + 3 copies, every session on a user timer (index >= 7)
    e = O.backup_expected(by_id("bk-01"))
    ok(len(e["timers"]) == 10 and all(s["timer"] >= 7 for s in e["sessions"]), "anchor bk-01")
    # CSV guard examples
    ok(O.csv_guard("=1") == "'=1" and O.csv_guard("a=1") == "a=1" and O.csv_guard("") == "", "anchor csv guard")
    # templates: Tabata 250 s, Stretch 10 x 30 + 5 = 305 s
    ok(build_set.expected_for(by_id("tp-05"))["totalMs"] == 305000, "anchor tp-05")


# ------------------------------------------------------------------------------------------- 3. checker
def perfect_results():
    res = {}
    for c in checker.load_set(HERE):
        e, f = copy.deepcopy(c["expected"]), c["family"]
        if f == "validation":
            res[c["id"]] = {"valid": e["valid"]}
        elif f == "backup":
            res[c["id"]] = backup_db(e)
        elif f == "csv":
            res[c["id"]] = csv_doc(e["cells"])
        elif f == "share":
            res[c["id"]] = {"ok": True, "timer": e["timer"]} if e["outcome"] == "ok" else {"ok": False}
        elif f == "templateRestore":
            ts = []
            for kw, n in e["perKeyword"].items():
                for i in range(n):
                    secs = e["editedFirstIntervalSeconds"] if kw == e["editedKeyword"] else 20
                    ts.append({"name": kw.title() + (" (mine)" if i else ""),
                               "blocks": [{"intervals": [{"seconds": secs}]}]})
            res[c["id"]] = {"timers": ts}
        else:
            res[c["id"]] = e
    return res


def backup_db(e, copy_suffix=""):
    ids = {j: int(tid) for tid, j in e["idsWithContent"].items()}
    nxt = 1000
    timers = []
    for j, t in enumerate(e["timers"]):
        if j not in ids:
            ids[j] = nxt
            nxt += 1
            t = dict(t, name=t["name"] + copy_suffix)
        timers.append(dict(t, id=ids[j]))
    sids = {k: int(sid) for sid, k in e["sessionIds"].items()}
    sessions = []
    for k, s in enumerate(e["sessions"]):
        if k not in sids:
            sids[k] = nxt
            nxt += 1
        sessions.append(dict(s["content"], id=sids[k], timerId=None if s["timer"] is None else ids[s["timer"]]))
    return {"timers": timers, "sessions": sessions}


def csv_doc(cells, quote_all=False, terminator="\r\n"):
    buf = io.StringIO(newline="")
    w = csv.writer(buf, lineterminator=terminator, quoting=csv.QUOTE_ALL if quote_all else csv.QUOTE_MINIMAL)
    w.writerow(["n", "timer_name", "actual_s"])
    for i, cell in enumerate(cells):
        w.writerow([i + 1, cell, 100])
    return buf.getvalue()


def plant(res, cid, fn):
    r = copy.deepcopy(res)
    r[cid] = fn(r[cid])
    return r


def mut(fn):
    def inner(x):
        fn(x)
        return x
    return inner


def planted(res):
    def m_bk01(x):
        # REVIEW M1: copies keep the backup id in the id map -> sessions point to the templates 1-3
        for s in x["sessions"]:
            s["timerId"] = {"Legs": 1, "Arms": 2, "Core": 3}[s["timerName"]]
        return x

    def m_bk03(x):
        x["timers"].append(dict(x["timers"][0], id=555))
        return x

    def m_bk04(x):
        for s in x["sessions"]:
            if s["actualS"] == 300:                      # existing session moved onto the copy
                s["timerId"] = next(t["id"] for t in x["timers"] if t["blocks"][0]["intervals"][0]["seconds"] == 42)
        return x

    def m_cb02(x):
        return [{"atMs": 25000, "kind": "start", "text": "Rest"}] + x

    def m_tl08(x):
        x["cues"].insert(2, {"atMs": 17000, "kind": "countdown", "text": "3"})
        return x

    def m_tl02(x):
        x["cues"][5], x["cues"][6] = x["cues"][6], x["cues"][5]
        return x

    def m_tl28(x):
        x["cues"][1]["text"] = x["cues"][1]["text"].replace("ス", "ス ")
        return x

    def m_tl20(x):
        x["cues"] = x["cues"][:-1]
        return x

    cases = [
        ("tl-01", mut(lambda x: x["cues"][7].__setitem__("atMs", x["cues"][7]["atMs"] + 1)), "cue +1 ms"),
        ("tl-02", m_tl02, "halfway/countdown order swapped"),
        ("tl-19", mut(lambda x: x.__setitem__("totalMs", 0)), "open timeline total 0 instead of null"),
        ("tl-08", m_tl08, "typed prep treated like the prep segment (D32)"),
        ("tl-28", m_tl28, "voice text altered"),
        ("tl-20", m_tl20, "end cue missing after Next"),
        ("tl-16", mut(lambda x: x["segments"][3].__setitem__("label", "Rest")), "segment label"),
        ("fm-02", lambda x: "0:59", "B1-style m:ss"),
        ("fm-06", lambda x: "60:00", "mm:ss past one hour"),
        ("va-02", lambda x: {"valid": False}, "UTF-16 counting refuses 40 emoji"),
        ("va-24", lambda x: {"valid": not x["valid"]}, "ambiguous case flipped (must not affect the score)"),
        ("cl-01", lambda x: x[:20], "clamp at 40 UTF-16 units"),
        ("rn-07", mut(lambda x: x[1].update({"state": "running", "elapsedMs": 70000, "segmentIndex": 5,
                                              "remainingMs": 10000})), "Back revives an ended run"),
        ("rn-02", mut(lambda x: x[1].update({"elapsedMs": 0, "segmentIndex": 0, "remainingMs": 5000})),
         "double Start restarts"),
        ("rn-13", mut(lambda x: x[1].update({"elapsedMs": 25000, "segmentIndex": 2, "remainingMs": 10000})),
         "back threshold off by one"),
        ("rn-10", mut(lambda x: x[1].update({"state": "paused"})), "headset toggle pauses an ended run"),
        ("rc-09", mut(lambda x: x.update({"segmentIndex": 4, "totalMs": 850000})), "events not replayed"),
        ("rc-06", lambda x: {"decision": "partial"}, "23 h pause discarded"),
        ("rc-03", mut(lambda x: x.update({"decision": "resume"})), "relaunch at the total resumes"),
        ("cb-02", m_cb02, "catch-up burst"),
        ("nc-01", mut(lambda x: x.update({"atMs": 15000})), "next cue not strictly after"),
        ("bk-01", m_bk01, "M1: sessions attached to templates"),
        ("bk-03", m_bk03, "keep both duplicates an identical timer"),
        ("bk-04", m_bk04, "existing session moved to the copy"),
        ("bk-02", mut(lambda x: x["timers"][0].__setitem__("notes", "x")), "replace rewrote content"),
        ("cv-01", lambda x: x.replace("'=SUM", "=SUM"), "formula guard missing"),
        ("cv-02", lambda x: x.replace("\r\n", "\n"), "LF record terminators"),
        ("cv-03", lambda x: x.replace("'-", "-"), "minus not guarded"),
        ("sc-08", lambda x: {"ok": True, "timer": {}}, "truncated payload accepted"),
        ("sc-13", lambda x: {"threw": True, "error": "RangeError"}, "deep nesting throws"),
        ("sc-02", mut(lambda x: x["timer"]["blocks"][0]["intervals"][7].__setitem__("name", "x")),
         "ZWJ name not round-tripped"),
        ("sc-21", lambda x: {"threw": True}, "empty object throws"),
        ("sk-04", mut(lambda x: x.update({"day": "2027-01-04", "week": "2027-W01"})), "UTC instead of local"),
        ("sk-08", mut(lambda x: x.update({"day": "2011-12-30"})), "Samoa skipped day"),
        ("sk-11", mut(lambda x: x.update({"week": "2026-W52"})), "week 53 lost"),
        ("sa-01", lambda x: {"2026-10-24": {"count": 1, "actualS": 400}, "2026-10-25": {"count": 3,
                                                                                       "actualS": 600}},
         "25 h day spills over"),
        ("ss-01", lambda x: 3, "DST breaks the streak"),
        ("tp-08", mut(lambda x: [t for t in x["timers"] if t["name"].lower().startswith("hiit")][0]["blocks"][0]
                      ["intervals"][0].__setitem__("seconds", 30)), "Restore overwrote an edited template"),
        ("tp-01", lambda x: {"totalMs": 240000}, "template total without prep"),
        ("rn-21", lambda x: None, "missing result -> stays a failure"),
    ]
    for cid, fn, label in cases:
        r = plant(res, cid, fn)
        if label.startswith("missing"):
            del r[cid]
        rep = checker.run(r, HERE)
        failed = [f["id"] for f in rep["fails"]]
        ok(failed == [cid], "planted error '%s' in %s: checker flagged %s" % (label, cid, failed))
        amb = by_id(cid)["ambiguous"]
        if amb:
            ok(rep["scored"][0] == rep["scored"][1], "ambiguous plant changed the score (%s)" % cid)
        else:
            ok(rep["scored"][0] == rep["scored"][1] - 1, "planted error did not cost one scored case (%s)" % cid)
    print("planted errors: %d, each caught exactly" % len(cases) if not FAILS else "planted errors: problems")
    return len(cases)


def controls(res):
    """Things a correct engine may legitimately do differently; the checker must accept them."""
    def ticks(x):
        x["cues"].append({"atMs": 50000, "kind": "openTick", "text": None})
        return x

    def renamed_copies(x):
        return backup_db(next(c for c in checker.load_set(HERE) if c["id"] == "bk-01")["expected"], " (2)")

    def shuffled_csv(x):
        e = next(c for c in checker.load_set(HERE) if c["id"] == "cv-02")["expected"]
        return csv_doc(list(reversed(e["cells"])), quote_all=True)

    def zero_buckets(x):
        x["2026-10-23"] = {"count": 0, "actualS": 0}
        return x

    def no_header(x):
        return x.split("\r\n", 1)[1]

    def int_flags(x):
        for b in x["timer"]["blocks"]:
            for i in b["intervals"]:
                i["halfwayCue"] = int(i["halfwayCue"])
                i["countdownCue"] = int(i["countdownCue"])
        x["timer"]["extra"] = "ignored"
        return x

    for cid, fn, label in [("tl-19", ticks, "openTick cues listed"), ("bk-01", renamed_copies, "copies renamed"),
                           ("cv-02", shuffled_csv, "rows reordered + all fields quoted"),
                           ("sa-01", zero_buckets, "empty buckets reported"), ("cv-01", no_header, "no header"),
                           ("sc-01", int_flags, "0/1 flags + extra field")]:
        rep = checker.run(plant(res, cid, fn), HERE)
        ok(not rep["fails"], "control '%s' (%s) wrongly failed: %s" % (label, cid, rep["fails"]))


def main():
    reproducible()
    anchors()
    res = perfect_results()
    rep = checker.run(res, HERE)
    ok(not rep["fails"], "perfect results fail: %s" % rep["fails"][:5])
    ok(rep["scored"][1] + rep["ambiguous"][1] == len(C.CASES), "case count")
    print("perfect results: scored %d/%d, ambiguous %d/%d, adversarial %d/%d"
          % tuple(rep["scored"] + rep["ambiguous"] + rep["adversarial"]))
    planted(res)
    controls(res)
    print("SELFTEST", "OK" if not FAILS else "FAILED (%d)" % len(FAILS))
    return 0 if not FAILS else 1


if __name__ == "__main__":
    sys.exit(main())
