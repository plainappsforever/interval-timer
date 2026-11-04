#!/usr/bin/env python3
"""CSV referee (SPEC §12 A11): Python's own csv module parses our history export back.

Usage: csv_check.py <export.csv> <expected.json>
expected.json = {"header": [...], "rows": [[...], ...], "numericColumns": [...]} — the cells our writer meant to write
(after the formula guard). Checks: UTF-8 BOM, CRLF row ends, RFC 4180 parse-back equals the expected rows exactly,
no cell outside the numeric columns starts with = + - @ TAB CR (formula guard), numeric cells are plain integers or empty.
Prints differences; exit status 1 when there is any.
"""
import csv
import io
import json
import re
import sys

NUMERIC = re.compile(r"^-?[0-9]*$")
DANGER = ("=", "+", "-", "@", "\t", "\r")


def main() -> int:
    path, expected_path = sys.argv[1], sys.argv[2]
    raw = open(path, "rb").read()
    expected = json.load(open(expected_path, encoding="utf-8"))
    problems = []
    if not raw.startswith(b"\xef\xbb\xbf"):
        problems.append("no UTF-8 BOM")
    text = raw.decode("utf-8-sig")
    if not text.endswith("\r\n"):
        problems.append("last row does not end with CRLF")
    rows = list(csv.reader(io.StringIO(text, newline=""), strict=True))
    if rows[0] != expected["header"]:
        problems.append(f"header differs: {rows[0]}")
    body = rows[1:]
    if len(body) != len(expected["rows"]):
        problems.append(f"{len(body)} rows instead of {len(expected['rows'])}")
    numeric_idx = {expected["header"].index(c) for c in expected["numericColumns"]}
    for i, (got, want) in enumerate(zip(body, expected["rows"]), start=1):
        if got != want:
            problems.append(f"row {i} differs: {got} != {want}")
        for j, cell in enumerate(got):
            if j in numeric_idx:
                if not NUMERIC.match(cell):
                    problems.append(f"row {i} col {j}: numeric cell {cell!r} is not a plain integer")
            elif cell.startswith(DANGER):
                problems.append(f"row {i} col {j}: cell {cell!r} starts with a formula character")
    for p in problems:
        print(p)
    if problems:
        return 1
    print(f"OK: {len(body)} rows parse back exactly")
    return 0


if __name__ == "__main__":
    sys.exit(main())
