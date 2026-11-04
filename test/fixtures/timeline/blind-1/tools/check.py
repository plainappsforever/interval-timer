"""Scores an engine dump against intervals-b1.
Usage: python3 -I tools/check.py <set-folder> <dump.json> [--json <report.json>] [--all-mismatches]
dump.json = {"engine": "<free text, e.g. git commit>", "results": {"<case id>": <output>, ...}}
Output shapes per family: README.md "Dump interface". Exit 0 = every non-ambiguous case passes."""

import base64
import csv
import io
import json
import os
import re
import sys
from collections import Counter

FORMULA_START = ("=", "+", "-", "@", "\t", "\r")
LINK_PREFIX = "plainintervals://t?d="
SESSION_KEYS = ("timerName", "startedAt", "endedAt", "plannedS", "actualS", "completed",
                "skippedIntervals", "pauses", "note")
INTERVAL_KEYS = ("name", "seconds", "type", "color", "cueStart", "halfwayCue", "countdownCue", "openTickS")
PREF_KEYS = ("prepSeconds", "endCue", "repeatWhole", "vibrate")
MISSING = "<missing>"


def same(a, b):
    if isinstance(a, bool) or isinstance(b, bool):
        return type(a) is type(b) and a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a == b
    return type(a) is type(b) and a == b


def sub(exp, act, path, errs):
    """exp's dict keys must exist in act and match; lists must match element by element."""
    if isinstance(exp, dict):
        if not isinstance(act, dict):
            errs.append(f"{path}: expected an object, got {short(act)}"); return
        for k, v in exp.items():
            if k not in act:
                errs.append(f"{path}.{k}: missing (expected {short(v)})")
            else:
                sub(v, act[k], f"{path}.{k}", errs)
    elif isinstance(exp, list):
        if not isinstance(act, list):
            errs.append(f"{path}: expected a list, got {short(act)}"); return
        if len(exp) != len(act):
            errs.append(f"{path}: length {len(act)}, expected {len(exp)}")
        for n, (e, a) in enumerate(zip(exp, act)):
            sub(e, a, f"{path}[{n}]", errs)
    elif not same(exp, act):
        errs.append(f"{path}: {short(act)}, expected {short(exp)}")


def short(v):
    s = json.dumps(v, ensure_ascii=False)
    return s if len(s) <= 120 else s[:117] + "..."


def skey(x):
    return json.dumps(x, sort_keys=True, ensure_ascii=False)


def proj_timer(t, with_name=True, with_notes=False):
    if not isinstance(t, dict):
        return MISSING
    out = {}
    if with_name:
        out["name"] = t.get("name", MISSING)
    out["color"] = t.get("color", MISSING)
    if with_notes:
        out["notes"] = t.get("notes", MISSING)
    out["blocks"] = [{"name": b.get("name", MISSING), "rounds": b.get("rounds", MISSING),
                      "restBetweenRoundsS": b.get("restBetweenRoundsS", MISSING),
                      "intervals": [{k: i.get(k, MISSING) for k in INTERVAL_KEYS} for i in b.get("intervals", [])]}
                     for b in t.get("blocks", []) if isinstance(b, dict)]
    p = t.get("prefs", {}) if isinstance(t.get("prefs"), dict) else {}
    out["prefs"] = {k: p.get(k, MISSING) for k in PREF_KEYS}
    return out


def proj_session(s):
    return {k: s.get(k, MISSING) for k in SESSION_KEYS} if isinstance(s, dict) else MISSING


def multiset(exp_list, act_list, label, errs):
    e, a = Counter(skey(x) for x in exp_list), Counter(skey(x) for x in act_list)
    if e != a:
        miss, extra = e - a, a - e
        for k in list(miss)[:3]:
            errs.append(f"{label}: missing {short(json.loads(k))}")
        for k in list(extra)[:3]:
            errs.append(f"{label}: unexpected {short(json.loads(k))}")
        if not miss and not extra:
            errs.append(f"{label}: multiplicities differ")


# ---------------------------------------------------------------- family checks -> (status, errors)
def chk_generic(case, exp, act):
    errs = []
    sub(exp, act, "$", errs)
    return errs


def chk_validation(case, exp, act):
    errs = []
    if not isinstance(act, dict):
        return ["$: not an object"]
    if not same(exp["valid"], act.get("valid")):
        errs.append(f"$.valid: {short(act.get('valid'))}, expected {exp['valid']}")
    rules = act.get("rules")
    if not isinstance(rules, list) or sorted(set(map(str, rules))) != exp["rules"]:
        errs.append(f"$.rules: {short(rules)}, expected {exp['rules']}")
    return errs


def chk_stats(case, exp, act):
    errs = chk_generic(case, exp, act)
    for k in ("perDay", "perWeek", "perMonth", "mostUsed"):
        if isinstance(act, dict) and isinstance(act.get(k), dict):
            extra = sorted(set(act[k]) - set(exp[k]))
            if extra:
                errs.append(f"$.{k}: unexpected keys {extra}")
    return errs


def b64url_json(payload):
    if not re.fullmatch(r"[A-Za-z0-9_-]+={0,2}", payload or ""):
        return None, "payload is not base64url (RFC 4648 section 5 alphabet)"
    try:
        raw = base64.urlsafe_b64decode(payload.rstrip("=") + "=" * (-len(payload.rstrip("=")) % 4))
        return json.loads(raw.decode("utf-8")), None
    except Exception as e:  # noqa: BLE001
        return None, f"payload does not decode to UTF-8 JSON ({type(e).__name__})"


def chk_share(case, exp, act):
    op = case["input"]["op"]
    errs = []
    if not isinstance(act, dict):
        return ["$: not an object"]
    if op == "roundtrip":
        link = act.get("link")
        if not isinstance(link, str) or not link.startswith(LINK_PREFIX):
            errs.append(f"$.link: does not start with {LINK_PREFIX}: {short(link)}")
        else:
            payload = re.split(r"[&#]", link[len(LINK_PREFIX):], maxsplit=1)[0]
            obj, why = b64url_json(payload)
            if why:
                errs.append(f"$.link: {why}")
            elif not isinstance(obj, (dict, list)):
                errs.append("$.link: payload JSON is not an object/array")
        for k in ("linkTimer", "fileTimer"):
            sub(exp["timer"], act.get(k), f"$.{k}", errs)
    elif op == "unknownField":
        if not same(True, act.get("ok")):
            errs.append(f"$.ok: {short(act.get('ok'))}, expected true")
        sub(exp["timer"], act.get("timer"), "$.timer", errs)
    elif op == "tamper":
        if act.get("markerCount") != 1:
            return "n/a", [f"marker '{case['input']['find']}' found {act.get('markerCount')} times in the decoded "
                           f"JSON (the case cannot be applied to this encoding)"]
        if not same(exp["ok"], act.get("ok")):
            errs.append(f"$.ok: {short(act.get('ok'))}, expected {exp['ok']}")
    elif op == "import":
        sub(exp["ok"], act.get("ok"), "$.ok", errs)
    return errs


def record_terminators_ok(text):
    q = False
    for i, c in enumerate(text):
        if c == '"':
            q = not q
        elif not q and c == "\n" and (i == 0 or text[i - 1] != "\r"):
            return False
        elif not q and c == "\r" and (i + 1 >= len(text) or text[i + 1] != "\n"):
            return False
    return True


def cell_ok(spec, cell):
    v = spec["value"]
    if not spec["guard"]:
        return cell == v
    return len(cell) == len(v) + 1 and cell.endswith(v) and not cell.startswith(FORMULA_START)


def chk_csv(case, exp, act):
    if not isinstance(act, dict) or not isinstance(act.get("csv"), str):
        return ["$.csv: missing CSV text"]
    text = act["csv"]
    errs = []
    if not record_terminators_ok(text):
        errs.append("$.csv: a record is not terminated by CRLF (RFC 4180 2.1) or a quote is unbalanced")
    try:
        rows = list(csv.reader(io.StringIO(text, newline=""), strict=True))
    except csv.Error as e:
        return errs + [f"$.csv: Python csv cannot parse it ({e})"]
    if not rows:
        return errs + ["$.csv: empty"]
    widths = Counter(len(r) for r in rows)
    if len(widths) != 1:
        errs.append(f"$.csv: rows of different widths {dict(widths)}")
    if len(rows) - exp["dataRows"] not in (0, 1):
        errs.append(f"$.csv: {len(rows)} records for {exp['dataRows']} sessions (+1 header allowed)")
    used = set()
    for n, want in enumerate(exp["rows"]):
        hit = None
        for r, row in enumerate(rows):
            if r in used:
                continue
            pool = list(row)
            ok = True
            for spec in want["cells"]:
                k = next((j for j, c in enumerate(pool) if cell_ok(spec, c)), None)
                if k is None:
                    ok = False
                    break
                pool.pop(k)
            if ok:
                hit = r
                break
        if hit is None:
            errs.append(f"$.csv: no row holds session {n} cells " +
                        short([("guarded " if s["guard"] else "") + s["value"] for s in want["cells"]]))
        else:
            used.add(hit)
    return errs


def chk_backup(case, exp, act):
    errs = []
    if not isinstance(act, dict):
        return ["$: not an object"]
    if not same(exp["ok"], act.get("ok")):
        errs.append(f"$.ok: {short(act.get('ok'))}, expected {exp['ok']}")
    timers = act.get("timers") if isinstance(act.get("timers"), list) else []
    sessions = act.get("sessions") if isinstance(act.get("sessions"), list) else []
    if "timers" in exp:
        multiset(exp["timers"], [proj_timer(t) for t in timers], "$.timers", errs)
    if "timerCount" in exp:
        if len(timers) != exp["timerCount"]:
            errs.append(f"$.timers: {len(timers)} timers, expected {exp['timerCount']}")
        multiset(exp["timersWithoutName"], [proj_timer(t, with_name=False) for t in timers],
                 "$.timers (definitions without names)", errs)
        have = Counter(t.get("name") for t in timers if isinstance(t, dict))
        need = Counter(exp["namesPresent"])
        if need - have:
            errs.append(f"$.timers: names missing {sorted((need - have).elements())}")
    multiset(exp["sessions"], [proj_session(s) for s in sessions], "$.sessions", errs)
    if "settings" in exp:
        sub(exp["settings"], act.get("settings"), "$.settings", errs)
    return errs


CHECKS = {"timeline": chk_generic, "cuesBetween": chk_generic, "runner": chk_generic, "recovery": chk_generic,
          "validation": chk_validation, "format": chk_generic, "share": chk_share, "stats": chk_stats,
          "csv": chk_csv, "backup": chk_backup}


def load_set(root):
    with open(os.path.join(root, "index.json"), encoding="utf-8") as fh:
        index = json.load(fh)["cases"]
    out = []
    for e in index:
        with open(os.path.join(root, e["expected"]), encoding="utf-8") as fh:
            exp = json.load(fh)
        with open(os.path.join(root, e["input"]), encoding="utf-8") as fh:
            inp = json.load(fh)
        if e["family"] != "timeline":
            inp = inp["input"]
        out.append((e, inp, exp))
    return out


def check_case(meta, inp, exp, results):
    if meta["id"] not in results:
        return "missing", ["no output in the dump"]
    try:
        r = CHECKS[meta["family"]]({"input": inp, "meta": meta}, exp, results[meta["id"]])
    except Exception as e:  # noqa: BLE001 - a malformed output is a failure, never a crash
        return "fail", [f"checker could not read the output ({type(e).__name__}: {e})"]
    if isinstance(r, tuple):
        return r
    return ("pass", []) if not r else ("fail", r)


def score(root, dump):
    results = dump.get("results", {})
    rows = []
    for meta, inp, exp in load_set(root):
        st, errs = check_case(meta, inp, exp, results)
        rows.append({"id": meta["id"], "family": meta["family"], "adversarial": meta["adversarial"],
                     "ambiguous": meta["ambiguous"], "readings": meta["readings"], "status": st, "errors": errs})
    return rows


def summarize(rows):
    def tally(sel):
        sel = [r for r in sel if r["status"] != "n/a"]
        return sum(r["status"] == "pass" for r in sel), len(sel)
    fams = sorted({r["family"] for r in rows}, key=lambda f: list(CHECKS).index(f))
    lines = [f"{'family':12s} {'non-ambiguous':>15s} {'ambiguous':>11s} {'adversarial':>13s} {'n/a':>4s}"]
    for f in fams + ["ALL"]:
        rs = [r for r in rows if f == "ALL" or r["family"] == f]
        p1, n1 = tally([r for r in rs if not r["ambiguous"]])
        p2, n2 = tally([r for r in rs if r["ambiguous"]])
        p3, n3 = tally([r for r in rs if r["adversarial"]])
        na = sum(r["status"] == "n/a" for r in rs)
        lines.append(f"{f:12s} {p1:>7d} / {n1:<5d} {p2:>4d} / {n2:<4d} {p3:>5d} / {n3:<5d} {na:>4d}")
    tl = [r for r in rows if r["family"] == "timeline" and not r["ambiguous"]]
    lines.append(f"A1 timeline exactness (non-ambiguous): {sum(r['status'] == 'pass' for r in tl)} / {len(tl)} "
                 f"cases, {sum(r['status'] != 'pass' for r in tl)} mismatching")
    return lines


def main(argv):
    if len(argv) < 3:
        print(__doc__); return 2
    root, dump_path = argv[1], argv[2]
    with open(dump_path, encoding="utf-8") as fh:
        dump = json.load(fh)
    rows = score(root, dump)
    print(f"intervals-b1 check of engine: {dump.get('engine', '?')}")
    for line in summarize(rows):
        print(line)
    limit = None if "--all-mismatches" in argv else 4
    for r in rows:
        if r["status"] not in ("pass",):
            tag = "AMBIGUOUS " + ",".join(r["readings"]) if r["ambiguous"] else "non-ambiguous"
            print(f"- {r['status'].upper()} {r['id']} ({tag})")
            for e in r["errors"][:limit]:
                print(f"    {e}")
            if limit and len(r["errors"]) > limit:
                print(f"    ... {len(r['errors']) - limit} more")
    known = {r["id"] for r in rows}
    unknown = sorted(set(dump.get("results", {})) - known)
    if unknown:
        print(f"note: {len(unknown)} result ids are not in the set and were ignored: {unknown[:5]}")
    if "--json" in argv:
        with open(argv[argv.index("--json") + 1], "w", encoding="utf-8") as fh:
            json.dump({"engine": dump.get("engine"), "rows": rows}, fh, ensure_ascii=False, indent=1)
    bad = [r for r in rows if not r["ambiguous"] and r["status"] in ("fail", "missing")]
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
