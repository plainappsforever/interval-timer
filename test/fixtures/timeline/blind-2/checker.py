"""Checker for blind set B2 (interval timer).

    python3 -I checker.py <results.json> [--set <set-dir>] [--json] [--quiet]

<results.json> maps case id -> the engine's actual output in the shape README.md documents per family.
A missing id, or {"error": "..."} (any family except share), is a mismatch.  Ambiguous cases (README "Ambiguities")
are scored separately and never change the exit code.  Exit 0 = every non-ambiguous case matched.

Standard library only; reads nothing outside the set folder and the results file; imports nothing from oracle/.
"""

import csv
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


# ---------------------------------------------------------------------------------------------- loading
def load_set(set_dir):
    cases = []
    cdir = os.path.join(set_dir, "cases")
    for fn in sorted(os.listdir(cdir)):
        if not fn.endswith(".json"):
            continue
        with open(os.path.join(cdir, fn), encoding="utf-8") as fh:
            for c in json.load(fh):
                if c["family"] == "timeline":
                    with open(os.path.join(set_dir, c["expectedFile"]), encoding="utf-8") as eh:
                        c["expected"] = json.load(eh)
                cases.append(c)
    return cases


# ---------------------------------------------------------------------------------------------- helpers
class Mismatch(Exception):
    pass


def need(cond, msg):
    if not cond:
        raise Mismatch(msg)


def eq(a, b, what):
    # Python equality: 1 == True and 20 == 20.0 are accepted (SQLite-style 0/1 flags); None never equals 0.
    if a != b:
        raise Mismatch("%s: expected %s, got %s" % (what, _show(a), _show(b)))


def _show(x):
    s = json.dumps(x, ensure_ascii=False)
    s = s.encode("utf-8", "backslashreplace").decode("utf-8")      # lone surrogates stay printable
    return s if len(s) <= 300 else s[:300] + "..."


def is_obj(x):
    return isinstance(x, dict)


def matching(n_left, cand):
    """Perfect bipartite matching (Kuhn). cand[i] = list of right indices. Returns list right-of-left or None."""
    match_r = {}

    def try_(i, seen):
        for j in cand[i]:
            if j in seen:
                continue
            seen.add(j)
            if j not in match_r or try_(match_r[j], seen):
                match_r[j] = i
                return True
        return False

    for i in range(n_left):
        if not try_(i, set()):
            return None
    out = [None] * n_left
    for j, i in match_r.items():
        out[i] = j
    return out


# ---------------------------------------------------------------------------------------------- per family
def chk_timeline(exp, act):
    need(is_obj(act), "result is not an object")
    eq(exp["totalMs"], act.get("totalMs"), "totalMs")
    asegs = act.get("segments")
    need(isinstance(asegs, list), "segments missing")
    eq(len(exp["segments"]), len(asegs), "segment count")
    for i, (e, a) in enumerate(zip(exp["segments"], asegs)):
        for k in ("startMs", "endMs", "type", "label"):
            eq(e[k], a.get(k), "segment %d %s" % (i, k))
    acues = [c for c in act.get("cues", []) if c.get("kind") != "openTick"]   # FORMAT: ticks are not listed
    for i, (e, a) in enumerate(zip(exp["cues"], acues)):
        for k in ("atMs", "kind", "text"):
            eq(e[k], a.get(k), "cue %d %s" % (i, k))
    eq(len(exp["cues"]), len(acues), "cue count")


def chk_format(exp, act):
    eq(exp, act, "formatted")


def chk_validation(exp, act):
    v = act.get("valid") if is_obj(act) else act
    eq(exp["valid"], v, "valid (oracle reasons: %s)" % "; ".join(exp["reasons"]))


def chk_clamp(exp, act):
    eq(exp, act, "clamped name")


VIEW_ALWAYS = ("state", "elapsedMs", "totalMs")
VIEW_ACTIVE = ("segmentIndex", "remainingMs")


def chk_runner(exp, act):
    need(isinstance(act, list), "result is not a list of views")
    eq(len(exp), len(act), "number of views")
    for i, (e, a) in enumerate(zip(exp, act)):
        need(is_obj(a), "view %d is not an object" % i)
        for k in VIEW_ALWAYS:
            eq(e[k], a.get(k), "step %d %s" % (i, k))
        if e["state"] in ("running", "paused"):
            for k in VIEW_ACTIVE:
                eq(e[k], a.get(k), "step %d %s" % (i, k))


def chk_recovery(exp, act):
    need(is_obj(act), "result is not an object")
    for k, v in exp.items():
        eq(v, act.get(k), k)


def chk_cues_between(exp, act):
    need(isinstance(act, list), "result is not a list")
    eq(len(exp), len(act), "cue count")
    for i, (e, a) in enumerate(zip(exp, act)):
        for k in ("atMs", "kind", "text"):
            eq(e[k], a.get(k), "cue %d %s" % (i, k))


def chk_next_cue(exp, act):
    if exp is None:
        eq(None, act, "next cue")
        return
    need(is_obj(act), "result is not an object")
    eq(exp["atMs"], act.get("atMs"), "atMs")
    eq(exp["kinds"], act.get("kinds"), "kinds")


T_KEYS = ("color", "notes", "blocks", "prefs")
S_KEYS = ("timerName", "startedAt", "endedAt", "plannedS", "actualS", "completed", "skippedIntervals", "pauses",
          "note")


def _name_ok(exp_name, act_name):
    return act_name == exp_name or (isinstance(act_name, str) and act_name.startswith(exp_name)
                                    and len(act_name) > len(exp_name))


def chk_backup(exp, act):
    need(is_obj(act) and isinstance(act.get("timers"), list) and isinstance(act.get("sessions"), list),
         "result needs timers[] and sessions[]")
    at, ast = act["timers"], act["sessions"]
    et, es = exp["timers"], exp["sessions"]
    eq(len(et), len(at), "timer count")
    cand = []
    for t in at:
        exact = [j for j, e in enumerate(et) if all(e[k] == t.get(k) for k in T_KEYS) and e["name"] == t.get("name")]
        loose = [j for j, e in enumerate(et) if all(e[k] == t.get(k) for k in T_KEYS) and _name_ok(e["name"],
                                                                                                   t.get("name"))]
        cand.append(exact + [j for j in loose if j not in exact])
    for i, c in enumerate(cand):
        need(c, "actual timer %r (id %r) matches no expected timer" % (at[i].get("name"), at[i].get("id")))
    tm = matching(len(at), cand)
    need(tm is not None, "timers cannot be paired one-to-one with the expected timers (lost or duplicated)")
    by_id = {}
    for i, t in enumerate(at):
        by_id[str(t.get("id"))] = tm[i]
    for tid, j in exp["idsWithContent"].items():
        need(tid in by_id, "timer id %s that existed before the restore is gone" % tid)
        need(by_id[tid] == j, "timer id %s carries the wrong content after the restore (expected %r)"
             % (tid, et[j]["name"]))
    eq(len(es), len(ast), "session count")
    scand = []
    for s in ast:
        scand.append([k for k, e in enumerate(es) if all(e["content"][f] == s.get(f) for f in S_KEYS)])
    for i, c in enumerate(scand):
        need(c, "actual session %r/%r matches no expected session" % (ast[i].get("timerName"),
                                                                       ast[i].get("startedAt")))
    sm = matching(len(ast), scand)
    need(sm is not None, "sessions cannot be paired one-to-one (lost or duplicated)")
    for i, s in enumerate(ast):
        e = es[sm[i]]
        tid = s.get("timerId")
        label = "session %r started %r" % (s.get("timerName"), s.get("startedAt"))
        if e["timer"] is None:
            need(tid is None, "%s should have no timer, points to id %r" % (label, tid))
        else:
            need(tid is not None and str(tid) in by_id, "%s points to no existing timer (%r)" % (label, tid))
            got = by_id[str(tid)]
            need(got == e["timer"], "%s is attached to %r, expected %r" % (label, et[got]["name"],
                                                                          et[e["timer"]]["name"]))
    sid_map = {str(s.get("id")): sm[i] for i, s in enumerate(ast)}
    for sid, k in exp["sessionIds"].items():
        need(sid in sid_map and sid_map[sid] == k, "existing session id %s lost or rewritten" % sid)


def _records_crlf(doc):
    """RFC 4180: every record ends with CRLF (the last one may omit it); CR/LF elsewhere only inside quotes."""
    inq, i, n = False, 0, len(doc)
    while i < n:
        ch = doc[i]
        if inq:
            if ch == '"':
                if i + 1 < n and doc[i + 1] == '"':
                    i += 1
                else:
                    inq = False
        else:
            if ch == '"':
                inq = True
            elif ch == "\r":
                need(i + 1 < n and doc[i + 1] == "\n", "bare CR outside quotes at offset %d" % i)
                i += 1
            elif ch == "\n":
                raise Mismatch("bare LF outside quotes at offset %d (records must end with CRLF)" % i)
        i += 1
    need(not inq, "unterminated quoted field")


def chk_csv(exp, act):
    need(isinstance(act, str), "result is not the CSV text")
    _records_crlf(act)
    rows = [r for r in csv.reader(io.StringIO(act, newline=""), strict=True) if r != []]
    need(len(rows) in (exp["rows"], exp["rows"] + 1), "expected %d data rows (+ optional header), got %d rows"
         % (exp["rows"], len(rows)))
    for r in rows:
        for cell in r:
            need(not (cell[:1] in ("=", "+", "@")), "unguarded formula cell %r" % cell)
    data = rows[-exp["rows"]:] if exp["rows"] else []
    cand = [[ri for ri, r in enumerate(data) if cell in r] for cell in exp["cells"]]
    for k, c in enumerate(cand):
        need(c, "no row contains the cell %r" % exp["cells"][k])
    need(matching(len(cand), cand) is not None, "expected cells cannot be placed one per row")


I_KEYS = ("name", "seconds", "type", "color", "cueStart", "halfwayCue", "countdownCue", "openTickS")


def _share_timer(exp, act):
    need(is_obj(act), "decoded timer missing")
    eq(exp["name"], act.get("name"), "name")
    eq(exp["color"], act.get("color"), "color")
    eb, ab = exp["blocks"], act.get("blocks")
    need(isinstance(ab, list), "blocks missing")
    eq(len(eb), len(ab), "block count")
    for bi, (e, a) in enumerate(zip(eb, ab)):
        for k in ("name", "rounds", "restBetweenRoundsS"):
            eq(e[k], a.get(k), "block %d %s" % (bi, k))
        eq(len(e["intervals"]), len(a.get("intervals", [])), "block %d interval count" % bi)
        for ii, (x, y) in enumerate(zip(e["intervals"], a["intervals"])):
            for k in I_KEYS:
                eq(x[k], y.get(k), "block %d interval %d %s" % (bi, ii, k))
    ap = act.get("prefs") or {}
    for k, v in exp["prefs"].items():
        eq(v, ap.get(k), "prefs.%s" % k)


def chk_share(exp, act):
    need(is_obj(act), "result is not an object")
    threw = bool(act.get("threw"))
    if exp["outcome"] == "ok":
        need(not threw, "decoder threw: %s" % act.get("error"))
        eq(True, act.get("ok"), "ok")
        _share_timer(exp["timer"], act.get("timer"))
    elif exp["outcome"] == "reject":
        need(not threw, "decoder threw instead of rejecting: %s" % act.get("error"))
        eq(False, act.get("ok"), "ok")
    else:
        need(not threw, "decoder threw: %s" % act.get("error"))


def chk_stats_keys(exp, act):
    need(is_obj(act), "result is not an object")
    for k in ("day", "week", "month"):
        eq(exp[k], act.get(k), k)


def chk_totals(exp, act):
    need(is_obj(act), "result is not an object")
    got = {k: v for k, v in act.items() if is_obj(v) and v.get("count", 0) != 0}
    eq(sorted(exp), sorted(got), "bucket keys")
    for k in exp:
        eq(exp[k]["count"], got[k].get("count"), "%s count" % k)
        eq(exp[k]["actualS"], got[k].get("actualS"), "%s actualS" % k)


def chk_streak(exp, act):
    eq(exp, act, "streak")


def chk_templates(exp, act):
    need(is_obj(act), "result is not an object")
    eq(exp["totalMs"], act.get("totalMs"), "totalMs")


def chk_template_restore(exp, act):
    need(is_obj(act) and isinstance(act.get("timers"), list), "result needs timers[]")
    ts = act["timers"]
    eq(exp["count"], len(ts), "timer count")
    for kw, n in exp["perKeyword"].items():
        eq(n, sum(1 for t in ts if kw in str(t.get("name", "")).lower()), "timers named like %r" % kw)
    ed = [t for t in ts if exp["editedKeyword"] in str(t.get("name", "")).lower()]
    need(len(ed) == 1, "expected one %r timer" % exp["editedKeyword"])
    eq(exp["editedFirstIntervalSeconds"], ed[0]["blocks"][0]["intervals"][0]["seconds"],
       "edited template's first interval (must survive Restore)")


CHECKS = {
    "timeline": chk_timeline, "format": chk_format, "validation": chk_validation, "clamp": chk_clamp,
    "runner": chk_runner, "recovery": chk_recovery, "cuesBetween": chk_cues_between,
    "nextCueAfter": chk_next_cue, "backup": chk_backup, "csv": chk_csv, "share": chk_share,
    "statsKeys": chk_stats_keys, "statsTotals": chk_totals, "streak": chk_streak, "templates": chk_templates,
    "templateRestore": chk_template_restore,
}


def check_case(c, results):
    if c["id"] not in results:
        return "missing result"
    act = results[c["id"]]
    if c["family"] != "share" and is_obj(act) and set(act) == {"error"}:
        return "engine error: %s" % act["error"]
    try:
        CHECKS[c["family"]](c["expected"], act)
    except Mismatch as m:
        return str(m)
    except (KeyError, TypeError, IndexError, AttributeError, ValueError, csv.Error) as x:
        return "malformed result (%s: %s)" % (type(x).__name__, x)
    return None


def run(results, set_dir):
    cases = load_set(set_dir)
    fams, fails = {}, []
    for c in cases:
        why = check_case(c, results)
        f = fams.setdefault(c["family"], {"n": 0, "pass": 0, "ambN": 0, "ambPass": 0, "adv": 0, "advPass": 0})
        if c["ambiguous"]:
            f["ambN"] += 1
            f["ambPass"] += why is None
        else:
            f["n"] += 1
            f["pass"] += why is None
        if c["adversarial"]:
            f["adv"] += 1
            f["advPass"] += why is None
        if why is not None:
            fails.append({"id": c["id"], "family": c["family"], "ambiguous": c["ambiguous"], "why": why})
    scored_n = sum(f["n"] for f in fams.values())
    scored_pass = sum(f["pass"] for f in fams.values())
    return {"families": fams, "fails": fails, "scored": [scored_pass, scored_n],
            "ambiguous": [sum(f["ambPass"] for f in fams.values()), sum(f["ambN"] for f in fams.values())],
            "adversarial": [sum(f["advPass"] for f in fams.values()), sum(f["adv"] for f in fams.values())],
            "unknownIds": sorted(set(results) - {c["id"] for c in cases})}


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    set_dir = HERE
    if "--set" in argv:
        set_dir = argv[argv.index("--set") + 1]
        args = [a for a in args if a != set_dir]
    if not args:
        print(__doc__)
        return 2
    with open(args[0], encoding="utf-8") as fh:
        results = json.load(fh)
    rep = run(results, set_dir)
    if "--json" in argv:
        print(json.dumps(rep, indent=1, ensure_ascii=False))
    else:
        print("%-16s %9s %11s %11s" % ("family", "scored", "ambiguous", "adversarial"))
        for fam, f in sorted(rep["families"].items()):
            print("%-16s %4d/%-4d %5d/%-5d %5d/%-5d" % (fam, f["pass"], f["n"], f["ambPass"], f["ambN"],
                                                        f["advPass"], f["adv"]))
        print("TOTAL scored %d/%d   ambiguous %d/%d   adversarial %d/%d"
              % tuple(rep["scored"] + rep["ambiguous"] + rep["adversarial"]))
        if rep["unknownIds"]:
            print("results for unknown ids (ignored):", ", ".join(rep["unknownIds"]))
        if "--quiet" not in argv:
            for f in rep["fails"]:
                print("%s %-7s %s%s" % ("AMBIG" if f["ambiguous"] else "FAIL ", f["id"],
                                        ("[%s] " % f["ambiguous"]) if f["ambiguous"] else "", f["why"]))
    return 0 if rep["scored"][0] == rep["scored"][1] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
