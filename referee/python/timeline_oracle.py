#!/usr/bin/env python3
"""Independent timeline oracle (SPEC §13 O1, A1). Reads a fixture timer JSON (test/fixtures/timeline/FORMAT.md) and
prints the expected timeline JSON: segments (startMs, endMs, type, label) and cues (atMs, kind, text), totalMs.
Written from the rules in FORMAT.md / D29 only, without the TypeScript engine.

Usage: timeline_oracle.py <timer.json>            → prints expected JSON
       timeline_oracle.py --dir <set>             → writes <set>/expected/<name>.json for every <set>/timers/<name>.json
"""
import json
import os
import sys

KIND_ORDER = {"round": 0, "start": 1, "halfway": 2, "countdown": 3, "end": 5}


def steps(timer):
    """Logical steps without offsets: (type, label, seconds|None, cue_start, halfway, countdown, is_first_of_round, round_n, rounds)."""
    out = []
    prefs = timer["prefs"]
    if prefs.get("prepSeconds", 0) > 0:
        out.append(dict(type="prep", label="Get ready", seconds=prefs["prepSeconds"], cue="both", halfway=False, countdown=True, first=False, n=0, rounds=1))
    for _ in range(prefs.get("repeatWhole", 1)):
        for block in timer["blocks"]:
            rounds = block["rounds"]
            for r in range(rounds):
                for i, iv in enumerate(block["intervals"]):
                    is_open = iv["type"] == "open"
                    out.append(dict(
                        type=iv["type"], label=iv["name"], seconds=None if is_open else iv["seconds"],
                        cue=iv.get("cueStart", "both"), halfway=bool(iv.get("halfwayCue", False)) and not is_open,
                        countdown=bool(iv.get("countdownCue", True)) and not is_open,
                        first=(i == 0 and rounds > 1), n=r + 1, rounds=rounds))
                rest = block.get("restBetweenRoundsS", 0)
                if rest > 0 and r < rounds - 1:
                    out.append(dict(type="rest", label="Rest", seconds=rest, cue="both", halfway=False, countdown=True, first=False, n=r + 1, rounds=rounds))
    return out


def oracle(fixture):
    timer = fixture["timer"]
    cf = fixture.get("settings", {}).get("countdownFrom", 3)
    next_at = list(fixture.get("nextAt", []))
    segments, cues = [], []
    at = 0
    open_pending = False
    for s in steps(timer):
        if open_pending:
            break
        start = at
        if s["seconds"] is None:
            if next_at:
                end = max(next_at.pop(0), start)
            else:
                end = None
                open_pending = True
        else:
            end = start + s["seconds"] * 1000
        segments.append(dict(startMs=start, endMs=end, type=s["type"], label=s["label"]))
        if s["first"]:
            cues.append(dict(atMs=start, kind="round", text=f"Round {s['n']} of {s['rounds']}"))
        if s["cue"] != "none":
            cues.append(dict(atMs=start, kind="start", text=s["label"]))
        if end is not None and s["seconds"] is not None:
            if s["halfway"] and s["seconds"] >= 10:
                cues.append(dict(atMs=start + s["seconds"] * 500, kind="halfway", text="Halfway"))
            if s["countdown"]:
                for k in range(cf, 0, -1):
                    t = end - k * 1000
                    if t > start:
                        cues.append(dict(atMs=t, kind="countdown", text=str(k)))
        if end is not None:
            at = end
    total = None if (open_pending or not segments) else at
    if total is not None and timer["prefs"].get("endCue", "both") != "none":
        cues.append(dict(atMs=total, kind="end", text="Done"))
    cues.sort(key=lambda c: (c["atMs"], KIND_ORDER[c["kind"]]))
    return dict(totalMs=total, segments=segments, cues=cues)


def main(argv):
    if argv[1:2] == ["--dir"]:
        root = argv[2]
        tdir, edir = os.path.join(root, "timers"), os.path.join(root, "expected")
        os.makedirs(edir, exist_ok=True)
        n = 0
        for name in sorted(os.listdir(tdir)):
            if not name.endswith(".json"):
                continue
            with open(os.path.join(tdir, name), encoding="utf-8") as f:
                fixture = json.load(f)
            with open(os.path.join(edir, name), "w", encoding="utf-8") as f:
                json.dump(oracle(fixture), f, ensure_ascii=False, indent=1)
                f.write("\n")
            n += 1
        print(f"wrote {n} expected files to {edir}")
        return 0
    with open(argv[1], encoding="utf-8") as f:
        print(json.dumps(oracle(json.load(f)), ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
