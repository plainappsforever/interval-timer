"""Self-test of intervals-b1: (1) hand-computed sanity values for the oracle, (2) a reference dump built
from the oracle must score 100 %, (3) legitimate engine variations must still pass, (4) every planted
error must be caught. Usage: python3 -I tools/selftest.py <set-folder>"""

import base64
import copy
import importlib.util
import json
import os
import sys
import unicodedata
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))


def load(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, name + ".py"))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


oracle = load("oracle")
check = load("check")
FAILS = []


def expect(cond, what):
    if not cond:
        FAILS.append(what)


# ---------------------------------------------------------------- (1) hand-computed sanity values
def sanity(root):
    E = lambda i: json.load(open(os.path.join(root, f"expected/{i}.json"), encoding="utf-8"))  # noqa: E731
    A = lambda i: json.load(open(os.path.join(root, f"answers/{i}.json"), encoding="utf-8"))  # noqa: E731
    t = E("tl-01-tabata")
    expect(t["totalMs"] == 250000, "Tabata total = 250 000 (FORMAT.md example)")
    expect(len(t["segments"]) == 17, "Tabata: prep + 16 segments")
    expect(len(t["cues"]) == 4 + 8 * 9 + 1, "Tabata: 4 prep cues + 9 per round + end")
    t = E("tl-08-no-prep")
    expect([c["atMs"] for c in t["cues"]] == [0, 4000, 5000, 6000, 7000], "7 s interval cue times")
    t = E("tl-17-5999-halfway")
    expect(any(c["kind"] == "halfway" and c["atMs"] == 2999500 for c in t["cues"]), "halfway of 5999 s")
    t = E("tl-13-rounds-99")
    expect(len(t["segments"]) == 197 and len(t["cues"]) == 99 * 2 + 98 + 1, "99 rounds of 1 s + 1 s rest")
    t = E("tl-42-cf10-on-10s")
    expect([c["text"] for c in t["cues"] if c["kind"] == "countdown"] == [str(n) for n in range(9, 0, -1)], "cf10 on 10 s")
    t = E("tl-16-total-8h")
    expect(t["totalMs"] == 8 * 3600 * 1000, "8 h total")
    t = E("tl-19-open-stays-open")
    expect(t["totalMs"] is None and t["segments"][-1]["endMs"] is None and all(c["kind"] != "end" for c in t["cues"]),
           "open timeline cut")
    expect(A("fm-04-duration-3600-en")["text"] == "1:00:00" and A("fm-01-duration-0-en")["text"] == "00:00", "format")
    expect(A("fm-13-timer-tabata") == {"totalMs": 250000, "text": "04:10"}, "Tabata total text")
    expect(date(2026, 1, 1).weekday() == 3, "1 Jan 2026 is a Thursday -> 2026 has ISO week 53")
    expect("2026-W53" in A("st-04-iso-week-53")["perWeek"] and A("st-04-iso-week-53")["perWeek"]["2026-W53"]["sessions"] == 4,
           "28 Dec 2026 .. 1 Jan 2027 = 2026-W53")
    expect(set(A("st-05-iso-week-years")["perWeek"]) == {"2020-W53", "2024-W52", "2025-W01"}, "ISO years 2020/2025")
    for zone, d, hours in (("Europe/Berlin", date(2026, 3, 29), 23), ("America/New_York", date(2026, 11, 1), 25),
                           ("Australia/Lord_Howe", date(2026, 10, 4), 23.5)):
        z = ZoneInfo(zone)
        a = datetime(d.year, d.month, d.day, tzinfo=z)
        b = datetime.combine(d + timedelta(days=1), datetime.min.time(), tzinfo=z)
        expect((b.timestamp() - a.timestamp()) / 3600 == hours, f"{zone} {d} lasts {hours} h")
    expect(A("rc-09-dst-spring")["elapsedMs"] == 15 * 60000, "DST spring: 15 real minutes")
    expect(A("rc-10-dst-fall")["elapsedMs"] == 30 * 60000, "DST fall: 30 real minutes")
    s = "e" * 38 + "é" + "x"
    expect(len(s) == 41 and len(unicodedata.normalize("NFC", s)) == 40, "NFD case: 41 code points, 40 after NFC")
    expect(A("va-14-total-8h")["valid"] is True and A("va-15-total-8h-1s")["rules"] == ["total"], "8 h boundary")


# ---------------------------------------------------------------- (2) reference dump
def b64u(obj):
    return base64.urlsafe_b64encode(json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode()).decode().rstrip("=")


def reference(root):
    res = {}
    for meta, inp, exp in check.load_set(root):
        f, i = meta["family"], meta["id"]
        if f == "timeline":
            out = copy.deepcopy(exp)
            for n, s in enumerate(out["segments"]):
                s["pathLabel"] = f"seg {n}"            # extra engine keys must be ignored
            for c in out["cues"]:
                c["clipId"] = "x"
        elif f == "validation":
            out = {"valid": exp["valid"], "rules": list(reversed(exp["rules"])), "messages": ["..."]}
        elif f == "share":
            op = inp["op"]
            if op == "roundtrip":
                out = {"link": oracle.LINK_PREFIX + b64u({"v": 1, "t": inp["timer"]}),
                       "linkTimer": copy.deepcopy(inp["timer"]), "fileTimer": copy.deepcopy(inp["timer"])}
            elif op == "unknownField":
                out = {"ok": True, "timer": copy.deepcopy(inp["timer"])}
            elif op == "tamper":
                out = {"ok": exp["ok"], "markerCount": 1}
            else:
                out = copy.deepcopy(exp)
        elif f == "csv":
            out = {"csv": oracle.reference_csv(inp["sessions"])}
        elif f == "backup":
            full = {}
            oracle.backup_case(inp, set(), full)
            if "hostile" in inp:
                out = {"ok": False, "timers": copy.deepcopy(exp["timers"]), "sessions": copy.deepcopy(exp["sessions"])}
            else:
                out = {"ok": True,
                       "timers": [dict(copy.deepcopy(t), id=f"id{n}", name=t["name"] + (" (2)" if dup else ""))
                                  for n, (t, dup) in enumerate(full["timers"])],
                       "sessions": [dict(copy.deepcopy(s), id=f"s{n}") for n, s in enumerate(full["sessions"])]}
                if "settings" in exp:
                    out["settings"] = dict(exp["settings"], theme="system")
        else:
            out = copy.deepcopy(exp)
            if isinstance(out, dict):
                out["engineExtra"] = True
        res[i] = out
    return res


def status(root, results, cid):
    for meta, inp, exp in check.load_set(root):
        if meta["id"] == cid:
            return check.check_case(meta, inp, exp, results)
    raise KeyError(cid)


# ---------------------------------------------------------------- (3) legitimate variations (must PASS)
def csv_reordered(rows_csv):
    recs = oracle.csv_records(rows_csv)
    body = [list(reversed(r)) for r in recs[1:]][::-1]  # no header, columns and rows reversed
    return "\r\n".join(",".join('"' + c.replace('"', '""') + '"' for c in r) for r in body)


VARIATIONS = [
    ("cv-03-quoting", "no header, every cell quoted, columns and rows reversed, no final CRLF",
     lambda r: r["cv-03-quoting"].update(csv=csv_reordered(r["cv-03-quoting"]["csv"]))),
    ("cv-02-guard", "a different neutral guard character (leading space instead of an apostrophe)",
     lambda r: r["cv-02-guard"].update(csv=oracle.reference_csv(
         json.load(open(os.path.join(ROOT, "cases/cv-02-guard.json")))["input"]["sessions"], guard_char=" "))),
    ("sh-01-tabata", "link with base64 padding and an extra query parameter",
     lambda r: r["sh-01-tabata"].update(link=r["sh-01-tabata"]["link"] + "=" * (-len(r["sh-01-tabata"]["link"].split("d=", 1)[1]) % 4) + "&v=1")),
    ("bk-04-keep-both", "restored copy named differently",
     lambda r: [t.update(name=t["name"].replace(" (2)", " – restored")) for t in r["bk-04-keep-both"]["timers"]]),
    ("va-02-seconds-0", "rules given as a set-like list with a duplicate",
     lambda r: r["va-02-seconds-0"].update(rules=["seconds", "seconds"])),
]


# ---------------------------------------------------------------- (4) planted errors (must FAIL)
def cue(r, cid, n):
    return r[cid]["cues"][n]


def m_swap(lst, a, b):
    lst[a], lst[b] = lst[b], lst[a]


def nfc_labels(r, cid):
    for s in r[cid]["segments"]:
        s["label"] = unicodedata.normalize("NFC", s["label"])
    for c in r[cid]["cues"]:
        if c["text"]:
            c["text"] = unicodedata.normalize("NFC", c["text"])


def std_b64(r, cid):
    raw = json.dumps({"t": "?>?>?>~~~"}).encode()
    r[cid]["link"] = oracle.LINK_PREFIX + base64.b64encode(raw).decode()


def latin1_mojibake(r, cid):
    t = r[cid]["linkTimer"]
    t["name"] = t["name"].encode("utf-8").decode("latin-1")


def csv_replace(r, cid, a, b):
    r[cid]["csv"] = r[cid]["csv"].replace(a, b)


def utc_days(r, cid):
    d = r[cid]["perDay"]
    k = sorted(d)[0]
    y, m, dd = map(int, k.split("-"))
    nk = (date(y, m, dd) - timedelta(days=1)).isoformat()
    d[nk] = d.pop(k)


PLANTED = [
    ("tl-01-tabata", "one cue 1 ms late", lambda r: cue(r, "tl-01-tabata", 5).update(atMs=cue(r, "tl-01-tabata", 5)["atMs"] + 1)),
    ("tl-01-tabata", "start before round at the same ms", lambda r: m_swap(r["tl-01-tabata"]["cues"], 4, 5)),
    ("tl-01-tabata", "prep label 'Prep'", lambda r: r["tl-01-tabata"]["segments"][0].update(label="Prep")),
    ("tl-19-open-stays-open", "totalMs 0 instead of null", lambda r: r["tl-19-open-stays-open"].update(totalMs=0)),
    ("tl-19-open-stays-open", "segment after the open interval listed",
     lambda r: r["tl-19-open-stays-open"]["segments"].append({"startMs": 15000, "endMs": 25000, "type": "work", "label": "After"})),
    ("tl-29-halfway-threshold", "halfway for the 9 s interval",
     lambda r: r["tl-29-halfway-threshold"]["cues"].insert(1, {"atMs": 4500, "kind": "halfway", "text": "Halfway"})),
    ("tl-42-cf10-on-10s", "countdown '10' on the start",
     lambda r: r["tl-42-cf10-on-10s"]["cues"].insert(1, {"atMs": 0, "kind": "countdown", "text": "10"})),
    ("tl-10-rest-on-one-round-block", "round-rest emitted for a 1-round block",
     lambda r: r["tl-10-rest-on-one-round-block"]["segments"].insert(6, {"startMs": 0, "endMs": 0, "type": "rest", "label": "Rest"})),
    ("tl-38-unicode", "labels NFC-normalised", lambda r: nfc_labels(r, "tl-38-unicode")),
    ("tl-13-rounds-99", "last segment missing", lambda r: r["tl-13-rounds-99"]["segments"].pop()),
    ("tl-32-cue-modes", "round cue dropped with cueStart none", lambda r: r["tl-32-cue-modes"]["cues"].pop(0)),
    ("tl-30-halfway-meets-cd10", "collision: halfway dropped",
     lambda r: r["tl-30-halfway-meets-cd10"].update(cues=[c for c in r["tl-30-halfway-meets-cd10"]["cues"] if c["kind"] != "halfway"])),
    ("tl-45-open-last-closed", "no end cue after the last Next",
     lambda r: r["tl-45-open-last-closed"]["cues"].pop()),
    ("tl-01-tabata", "countdown text as a number", lambda r: cue(r, "tl-01-tabata", 1).update(text=3)),
    ("cb-02-long-gap", "burst: every overtaken cue returned",
     lambda r: r["cb-02-long-gap"]["windows"][0].insert(0, {"atMs": 45000, "kind": "halfway", "text": "Halfway"})),
    ("cb-03-boundary", "window end on a boundary attributed to the old segment",
     lambda r: r["cb-03-boundary"]["windows"].__setitem__(0, [])),
    ("rn-05-back-2000-exact", "back at exactly 2000 ms goes to the previous segment",
     lambda r: r["rn-05-back-2000-exact"]["steps"][1].update(elapsedMs=0, segmentIndex=0, remainingMs=5000)),
    ("rn-02-pause-accounting", "paused time counted as elapsed",
     lambda r: r["rn-02-pause-accounting"]["steps"][4].update(elapsedMs=65000)),
    ("rn-07-add-time", "second +30 s at the same ms ignored",
     lambda r: r["rn-07-add-time"]["steps"][4].update(totalMs=155000, remainingMs=34000)),
    ("rn-11-boundary-pause", "boundary pause kept in the old segment with 0 remaining",
     lambda r: r["rn-11-boundary-pause"]["steps"][1].update(segmentIndex=0, remainingMs=0)),
    ("rn-09-double-actions", "second pause toggles to running",
     lambda r: r["rn-09-double-actions"]["steps"][3].update(state="running")),
    ("rn-16-open-next", "open interval reports a remaining time",
     lambda r: r["rn-16-open-next"]["steps"][1].update(remainingMs=30000)),
    ("rn-08-add-then-back", "+30 s: halfway moved with the new end",
     lambda r: [c.update(atMs=30000) for c in r["rn-08-add-then-back"]["timeline"]["cues"] if c["kind"] == "halfway" and c["atMs"] == 15000]),
    ("rn-08-add-then-back", "+30 s: countdown left at the old end",
     lambda r: [c.update(atMs=c["atMs"] - 30000) for c in r["rn-08-add-then-back"]["timeline"]["cues"] if c["kind"] == "countdown" and 52000 <= c["atMs"] <= 54000]),
    ("rc-01-running-mid", "resumed at the saved elapsed instead of the wall clock",
     lambda r: r["rc-01-running-mid"].update(elapsedMs=100000, segmentIndex=3)),
    ("rc-09-dst-spring", "local-clock elapsed (+1 h)", lambda r: r["rc-09-dst-spring"].update(elapsedMs=4500000)),
    ("rc-11-replay-add", "events not replayed", lambda r: r["rc-11-replay-add"].update(segmentIndex=3)),
    ("rc-05-paused-25h", "stale pause offered as resume", lambda r: r["rc-05-paused-25h"].update(decision="resume")),
    ("rc-02-running-past-end", "finished but not completed", lambda r: r["rc-02-running-past-end"].update(completed=False)),
    ("va-16-prep-pushes-over", "prep not counted in the total", lambda r: r["va-16-prep-pushes-over"].update(valid=True, rules=[])),
    ("va-11-30-intervals", "interval limit counted across blocks",
     lambda r: r["va-11-30-intervals"].update(valid=False, rules=["intervals"])),
    ("va-20-japanese-41", "41 characters accepted", lambda r: r["va-20-japanese-41"].update(valid=True, rules=[])),
    ("va-15-total-8h-1s", "wrong rule reported", lambda r: r["va-15-total-8h-1s"].update(rules=["seconds"])),
    ("fm-01-duration-0-en", "'0:00' instead of '00:00'", lambda r: r["fm-01-duration-0-en"].update(text="0:00")),
    ("fm-04-duration-3600-en", "'60:00' at one hour", lambda r: r["fm-04-duration-3600-en"].update(text="60:00")),
    ("fm-07-duration-754-ar", "Arabic-Indic digits", lambda r: r["fm-07-duration-754-ar"].update(text="١٢:٣٤")),
    ("fm-12-block-one-round-rest", "rest of a 1-round block counted", lambda r: r["fm-12-block-one-round-rest"].update(seconds=120, text="02:00")),
    ("sh-01-tabata", "standard base64 alphabet in the link", lambda r: std_b64(r, "sh-01-tabata")),
    ("sh-02-unicode", "UTF-8 name decoded as Latin-1", lambda r: latin1_mojibake(r, "sh-02-unicode")),
    ("sh-03-every-field", "default-valued field dropped by the codec",
     lambda r: r["sh-03-every-field"]["fileTimer"]["prefs"].pop("vibrate")),
    ("sh-03-every-field", "open-interval tick lost", lambda r: r["sh-03-every-field"]["linkTimer"]["blocks"][0]["intervals"][4].update(openTickS=0)),
    ("sh-07-tamper-seconds", "tampered link accepted", lambda r: r["sh-07-tamper-seconds"].update(ok=True)),
    ("sh-11-hostile-links", "one hostile link accepted", lambda r: r["sh-11-hostile-links"]["ok"].__setitem__(5, True)),
    ("st-02-dst-spring", "day computed in UTC", lambda r: utc_days(r, "st-02-dst-spring")),
    ("st-04-iso-week-53", "calendar-year week for 1 Jan",
     lambda r: r["st-04-iso-week-53"].update(perWeek={"2026-W53": {"sessions": 2, "actualS": 200}, "2027-W01": {"sessions": 3, "actualS": 300}})),
    ("st-03-dst-fall", "streak broken by the 25-hour day", lambda r: r["st-03-dst-fall"].update(streakCurrent=2)),
    ("st-10-gap-streaks", "longest streak off by one", lambda r: r["st-10-gap-streaks"].update(streakLongest=4)),
    ("st-11-planned-null", "planned total includes a session without a planned time", lambda r: r["st-11-planned-null"].update(plannedS=1450)),
    ("cv-02-guard", "one formula cell unguarded", lambda r: csv_replace(r, "cv-02-guard", "'=SUM", "=SUM")),
    ("cv-03-quoting", "LF record terminators", lambda r: csv_replace(r, "cv-03-quoting", "\r\n", "\n")),
    ("cv-03-quoting", "comma cell not quoted", lambda r: csv_replace(r, "cv-03-quoting", '"a, b"', "a, b")),
    ("cv-03-quoting", "embedded CRLF normalised to LF",
     lambda r: csv_replace(r, "cv-03-quoting", "line 1\r\nline 2", "line 1\nline 2")),
    ("cv-06-no-false-guard", "'a=b' guarded although it is no formula", lambda r: csv_replace(r, "cv-06-no-false-guard", "a=b", "'a=b")),
    ("cv-04-unicode", "NFD note normalised", lambda r: csv_replace(r, "cv-04-unicode", "é", "é")),
    ("bk-03-replace", "later-added timer lost", lambda r: r["bk-03-replace"]["timers"].pop()),
    ("bk-03-replace", "edited timer not reverted",
     lambda r: r["bk-03-replace"]["timers"][0]["blocks"][0]["intervals"][0].update(seconds=25)),
    ("bk-04-keep-both", "backup copy of a changed timer dropped", lambda r: r["bk-04-keep-both"]["timers"].pop()),
    ("bk-04-keep-both", "existing timer renamed", lambda r: [t.update(name="Physio (1)") for t in r["bk-04-keep-both"]["timers"] if t["name"] == "Physio"]),
    ("bk-01-fresh-roundtrip", "session note lost", lambda r: r["bk-01-fresh-roundtrip"]["sessions"][1].update(note="")),
    ("bk-01-fresh-roundtrip", "completed stored as 0/1 instead of a boolean",
     lambda r: r["bk-01-fresh-roundtrip"]["sessions"][0].update(completed=1)),
    ("bk-06-truncated", "truncated backup half applied", lambda r: r["bk-06-truncated"].update(ok=True)),
    ("bk-07-not-json", "state changed by a refused restore", lambda r: r["bk-07-not-json"]["timers"].pop()),
]


def main(root):
    global ROOT
    ROOT = root
    sanity(root)
    ref = reference(root)
    rows = check.score(root, {"engine": "oracle reference", "results": ref})
    bad = [r for r in rows if r["status"] != "pass"]
    expect(not bad, f"reference dump must pass every case: {[(r['id'], r['errors'][:2]) for r in bad]}")
    print(f"reference dump: {sum(r['status'] == 'pass' for r in rows)} / {len(rows)} pass")
    missing = dict(ref); missing.pop("tl-01-tabata")
    st, _ = status(root, missing, "tl-01-tabata")
    expect(st == "missing", "a missing output is reported as missing")
    ok = 0
    for cid, what, fn in VARIATIONS:
        r = copy.deepcopy(ref); fn(r)
        st, errs = status(root, r, cid)
        if st == "pass":
            ok += 1
        else:
            FAILS.append(f"variation should pass: {cid} {what}: {errs[:2]}")
    print(f"legitimate variations accepted: {ok} / {len(VARIATIONS)}")
    caught = 0
    for cid, what, fn in PLANTED:
        r = copy.deepcopy(ref); fn(r)
        st, errs = status(root, r, cid)
        if st in ("fail", "missing"):
            caught += 1
        else:
            FAILS.append(f"planted error NOT caught: {cid}: {what}")
    print(f"planted errors caught: {caught} / {len(PLANTED)}")
    hostile = {"tl-01-tabata": None, "sh-01-tabata": "x", "cv-01-plain": {"csv": 5}, "bk-03-replace": [],
               "va-01-tabata": {"valid": "yes"}}
    for cid, junk in hostile.items():
        r = dict(ref); r[cid] = junk
        st, _ = status(root, r, cid)
        expect(st == "fail", f"malformed output for {cid} is a failure, not a crash")
    if FAILS:
        print("SELF-TEST FAILED:")
        for f in FAILS:
            print("  -", f)
        return 1
    print("SELF-TEST PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
