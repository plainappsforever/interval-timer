"""Builds blind set B2 from b2_cases.py with b2_oracle.py.  Usage: python3 -I oracle/build_set.py <set-dir>

Writes timers/<id>.json + expected/<id>.json (FORMAT.md shape) for the timeline family and cases/<family>.json
(input + expected per case) for every other family.  Deterministic: running it twice gives identical bytes.
"""

import json
import os
import sys

sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import b2_cases as C  # noqa: E402
import b2_oracle as O  # noqa: E402

SHARE_FIELDS_TIMER = ("name", "color")
SHARE_FIELDS_PREFS = ("prepSeconds", "endCue", "repeatWhole")


def share_projection(timer):
    return {
        "name": timer["name"], "color": timer["color"],
        "blocks": timer["blocks"],
        "prefs": {k: timer["prefs"][k] for k in SHARE_FIELDS_PREFS},
    }


def expected_for(c):
    f = c["family"]
    if f == "timeline":
        return O.build_timeline(c)
    if f == "format":
        return O.format_duration(c["seconds"])
    if f == "validation":
        ok, reasons = O.validate(c["timer"])
        return {"valid": ok, "reasons": reasons}
    if f == "clamp":
        return O.clamp_name(c["input"])
    if f == "runner":
        views, _ = O.run_steps(c)
        return views
    if f == "recovery":
        return O.recover(c)
    if f == "cuesBetween":
        return O.cues_between(O.layout(c["timer"], c["settings"]), c["frm"], c["to"])
    if f == "nextCueAfter":
        return O.next_cue_after(O.layout(c["timer"], c["settings"]), c["after"])
    if f == "backup":
        return O.backup_expected(c)
    if f == "csv":
        return {"rows": len(c["sessions"]),
                "cells": [O.csv_guard(s[c["check"]]) for s in c["sessions"]]}
    if f == "share":
        if c["expect"] == "ok":
            return {"outcome": "ok", "timer": share_projection(c["timer"])}
        if c["op"] == "encodeInvalid":
            ok, _ = O.validate(c["timer"])
            assert not ok, c["id"]
        return {"outcome": c["expect"]}
    if f == "statsKeys":
        return O.bucket_keys(c["atMs"], c["tz"])
    if f == "statsTotals":
        return O.totals(c["sessions"], c["tz"], c["period"])
    if f == "streak":
        return O.streak(c["sessions"], c["tz"], c["nowMs"])
    if f == "templates":
        blocks, prep = C.TPL[c["keyword"]]
        return {"totalMs": O.template_total_ms(blocks, prep)}
    if f == "templateRestore":
        kws = list(C.TPL.keys())
        lib = [{"kw": k, "name": k, "renamed": False} for k in kws]          # symbolic names
        lib = [t for t in lib if t["kw"] not in c["deleteKeywords"]]
        for t in lib:
            if t["kw"] == c["renameKeyword"]:
                t["renamed"] = True
        present = {t["kw"] for t in lib if not t["renamed"]}
        for k in kws:                                                       # D28: re-add missing names
            if k not in present:
                lib.append({"kw": k, "name": k, "renamed": False})
        per = {k: sum(1 for t in lib if t["kw"] == k) for k in kws}
        return {"count": len(lib), "perKeyword": per, "editedKeyword": c["editKeyword"],
                "editedFirstIntervalSeconds": c["editFirstIntervalSeconds"]}
    raise ValueError(f)


def text(obj):
    return json.dumps(obj, ensure_ascii=True, indent=1, sort_keys=False) + "\n"


def render():
    """All set files as {relative path: text}; main() writes them, selftest.py compares them with the disk."""
    ids = [c["id"] for c in C.CASES]
    assert len(ids) == len(set(ids)), "duplicate ids"
    files = {}

    def dump(obj, rel):
        files[rel] = text(obj)

    fams = {}
    for c in C.CASES:
        exp = expected_for(c)
        meta = {k: c[k] for k in ("id", "family", "adversarial", "ambiguous", "why")}
        if c["family"] == "timeline":
            tdoc = {"timer": c["timer"], "settings": c["settings"]}
            if "nextAt" in c:
                tdoc["nextAt"] = c["nextAt"]
            dump(tdoc, "timers/%s.json" % c["id"])
            dump(exp, "expected/%s.json" % c["id"])
            meta["timerFile"] = "timers/%s.json" % c["id"]
            meta["expectedFile"] = "expected/%s.json" % c["id"]
            fams.setdefault("timeline", []).append(meta)
        else:
            entry = dict(meta)
            entry["input"] = {k: v for k, v in c.items() if k not in meta}
            entry["expected"] = exp
            fams.setdefault(c["family"], []).append(entry)
    for fam, lst in fams.items():
        dump(lst, "cases/%s.json" % fam)
    return files, fams


def main(out):
    files, fams = render()
    for rel, body in files.items():
        os.makedirs(os.path.dirname(os.path.join(out, rel)), exist_ok=True)
        with open(os.path.join(out, rel), "w", encoding="ascii") as fh:
            fh.write(body)
    n = len(C.CASES)
    adv = sum(1 for c in C.CASES if c["adversarial"])
    amb = sum(1 for c in C.CASES if c["ambiguous"])
    print("cases %d, adversarial %d, ambiguous %d" % (n, adv, amb))
    for fam, lst in fams.items():
        print("  %-16s %3d" % (fam, len(lst)))


if __name__ == "__main__":
    main(sys.argv[1])
