"""Reference implementation of the share-family tamper operations (README "share").

    python3 -I -B share_tamper.py <op> '<link produced by the engine for the case timer>'

prints the tampered link (one line).  Ops that need no engine link (emptyD, notJson, badUtf8, emptyObject) still take
the engine's link so that the prefix (scheme, host, path, '?') is the engine's own.  Ops 'none', 'file' and
'encodeInvalid' are not tampering and are handled by the adapter (README).
"""

import base64
import json
import sys


def split(link):
    i = link.index("d=")
    j = link.find("&", i)
    return link[:i + 2], link[i + 2:] if j < 0 else link[i + 2:j], "" if j < 0 else link[j:]


def b64d(p):
    return base64.urlsafe_b64decode(p + "=" * (-len(p) % 4))


def b64e(b):
    return base64.urlsafe_b64encode(b).decode("ascii").rstrip("=")


def walk(v, f_obj=None, f_str=None, f_num=None, f_arr=None):
    if isinstance(v, dict):
        out = {k: walk(x, f_obj, f_str, f_num, f_arr) for k, x in v.items()}
        return f_obj(out) if f_obj else out
    if isinstance(v, list):
        out = [walk(x, f_obj, f_str, f_num, f_arr) for x in v]
        return f_arr(out) if f_arr else out
    if isinstance(v, str):
        return f_str(v) if f_str else v
    if isinstance(v, bool) or v is None:
        return v
    return f_num(v) if f_num else v


def tamper(op, link):
    head, p, tail = split(link)
    js = lambda v: b64e(json.dumps(v, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))  # noqa: E731
    if op == "emptyD":
        return head + tail
    if op == "notJson":
        return head + b64e(b"plain intervals") + tail
    if op == "badUtf8":
        return head + b64e(b"\xff\xfe\xfd") + tail
    if op == "emptyObject":
        return head + b64e(b"{}") + tail
    if op == "truncateHalf":
        return head + p[:len(p) // 2] + tail
    text = b64d(p).decode("utf-8")
    if op == "deepNest":
        return head + b64e(("[" * 5000 + text + "]" * 5000).encode("utf-8")) + tail
    v = json.loads(text)
    if op == "addKeyEverywhere":
        v = walk(v, f_obj=lambda o: dict(o, zzUnknownB2=0))
    elif op == "stringsTo41":
        v = walk(v, f_str=lambda s: "x" * 41)
    elif op == "numbersTo6000":
        v = walk(v, f_num=lambda n: 6000)
    elif op == "repeatArrays25":
        v = walk(v, f_arr=lambda a: [a[0]] * 25 if a else a)
    else:
        raise SystemExit("unknown op " + op)
    return head + js(v) + tail


if __name__ == "__main__":
    print(tamper(sys.argv[1], sys.argv[2]))
