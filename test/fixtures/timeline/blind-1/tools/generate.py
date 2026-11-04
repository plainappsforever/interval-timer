"""Writes the blind set from tools/cases.py (inputs) and tools/oracle.py (every expected value).
Usage: python3 -I tools/generate.py <set-folder>
Timeline cases -> timers/<id>.json + expected/<id>.json (FORMAT.md shape, read by `npm run blind`).
Every other family -> cases/<id>.json (input) + answers/<id>.json (expected). index.json lists all."""

import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def load(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, name + ".py"))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


oracle = load("oracle")
cases = load("cases")


def expected_for(c, readings):
    f, i = c["family"], c["input"]
    if f == "timeline":
        return oracle.build_timeline(i["timer"], i["settings"], i.get("nextAt"), readings)
    if f == "cuesBetween":
        return oracle.cues_between_case(i["timer"], i["settings"], i.get("nextAt"), i["windows"], readings)
    if f == "runner":
        return oracle.run_script(i["timer"], i["settings"], i["script"], readings)
    if f == "recovery":
        return oracle.evaluate_recovery(i, readings)
    if f == "validation":
        return oracle.validate(i["timer"], readings)
    if f == "format":
        return oracle.format_case(i)
    if f == "share":
        if i["op"] == "import":
            return {"ok": [False] * len(i["links"])}
        return oracle.share_case(i, readings)
    if f == "stats":
        return oracle.stats_case(i, readings)
    if f == "csv":
        return oracle.csv_case(i)
    if f == "backup":
        return oracle.backup_case(i, readings)
    raise ValueError(f)


def dump(path, obj):
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(obj, ensure_ascii=False, indent=1) + "\n")


def main(root):
    for d in ("timers", "expected", "cases", "answers"):
        os.makedirs(os.path.join(root, d), exist_ok=True)
    index = []
    seen = set()
    for c in cases.CASES:
        assert c["id"] not in seen, c["id"]
        seen.add(c["id"])
        readings = set(c["manualReadings"])
        exp = expected_for(c, readings)
        flagged = sorted(r.rstrip("!") for r in readings if r.endswith("!"))
        noted = sorted(r for r in readings if not r.endswith("!"))
        meta = {"id": c["id"], "family": c["family"], "title": c["title"], "adversarial": c["adversarial"],
                "ambiguous": bool(flagged), "readings": flagged, "readingsNoted": noted}
        if c["family"] == "timeline":
            inp_path, exp_path = f"timers/{c['id']}.json", f"expected/{c['id']}.json"
            dump(os.path.join(root, inp_path), c["input"])
        else:
            inp_path, exp_path = f"cases/{c['id']}.json", f"answers/{c['id']}.json"
            dump(os.path.join(root, inp_path), dict(meta, input=c["input"]))
        dump(os.path.join(root, exp_path), exp)
        index.append(dict(meta, input=inp_path, expected=exp_path))
    dump(os.path.join(root, "index.json"), {"set": "intervals-b1", "count": len(index), "cases": index})
    fam = {}
    for e in index:
        k = fam.setdefault(e["family"], [0, 0, 0])
        k[0] += 1; k[1] += e["adversarial"]; k[2] += e["ambiguous"]
    for f, (n, a, m) in fam.items():
        print(f"{f:12s} {n:3d} cases  {a:3d} adversarial  {m:3d} ambiguous")
    print(f"total {len(index)} cases, {sum(e['adversarial'] for e in index)} adversarial, "
          f"{sum(e['ambiguous'] for e in index)} ambiguous")


if __name__ == "__main__":
    main(sys.argv[1])
