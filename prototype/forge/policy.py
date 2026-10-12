"""Per-path policy (.forge/policy.yaml): a YAML-lite parser and the lane evaluator (spec section 5).

The parser covers the subset the spec's policy file uses: block mappings, block lists of
mappings ("- match: ..."), flow collections ({a: b} and [x, y]), quoted or bare scalars, comments.
"""
import re

LANE_RANK = {"auto": 0, "flag": 1, "decide": 2}


def _strip_comment(line):
    quote = None
    for i, ch in enumerate(line):
        if quote:
            quote = None if ch == quote else quote
        elif ch in "\"'":
            quote = ch
        elif ch == "#" and (i == 0 or line[i - 1].isspace()):
            return line[:i].rstrip()
    return line.rstrip()


def _scalar(s):
    s = s.strip()
    if len(s) >= 2 and s[0] == s[-1] and s[0] in "\"'":
        return s[1:-1]
    if re.fullmatch(r"-?\d+", s):
        return int(s)
    return {"true": True, "false": False, "null": None, "~": None}.get(s, s)


def _flow(s, i=0):
    """Parse one flow value starting at s[i]; return (value, next index)."""
    while s[i] == " ":
        i += 1
    if s[i] in "[{":
        close, out = ("]", []) if s[i] == "[" else ("}", {})
        i += 1
        while True:
            while s[i] in " ,":
                i += 1
            if s[i] == close:
                return out, i + 1
            if close == "]":
                v, i = _flow(s, i)
                out.append(v)
            else:
                k, i = _flow(s, i)
                while s[i] == " ":
                    i += 1
                if s[i] != ":":
                    raise ValueError(f"expected ':' in {s!r}")
                v, i = _flow(s, i + 1)
                out[k] = v
    if s[i] in "\"'":
        j = s.index(s[i], i + 1)
        return s[i + 1:j], j + 1
    j = i
    while j < len(s) and s[j] not in ",]}" and not (s[j] == ":" and (j + 1 == len(s) or s[j + 1] == " ")):
        j += 1
    return _scalar(s[i:j]), j


def _block(lines, i, ind):
    if lines[i][1].startswith("- "):
        out = []
        while i < len(lines) and lines[i][0] == ind and lines[i][1].startswith("- "):
            rest, sub, j = lines[i][1][2:], [(ind + 2, lines[i][1][2:])], i + 1
            while j < len(lines) and lines[j][0] > ind:
                sub.append(lines[j])
                j += 1
            is_map = re.match(r"^[\w\"'@.-]+\s*:(\s|$)", rest)
            out.append(_block(sub, 0, ind + 2)[0] if is_map else _flow(rest)[0])
            i = j
        return out, i
    out = {}
    while i < len(lines) and lines[i][0] == ind:
        key, _, rest = lines[i][1].partition(":")
        key, rest, i = _scalar(key), rest.strip(), i + 1
        if rest:
            out[key] = _flow(rest)[0]
        elif i < len(lines) and lines[i][0] > ind:
            out[key], i = _block(lines, i, lines[i][0])
        else:
            out[key] = None
    return out, i


def parse(text):
    lines = [(len(ln) - len(ln.lstrip()), ln.strip()) for ln in map(_strip_comment, text.splitlines()) if ln.strip()]
    return _block(lines, 0, lines[0][0])[0] if lines else {}


def glob_match(pattern, path):
    """picomatch-style globbing: ** crosses directories, * and ? do not."""
    rx, i = "", 0
    while i < len(pattern):
        if pattern.startswith("**/", i):
            rx, i = rx + "(?:.*/)?", i + 3
        elif pattern.startswith("**", i):
            rx, i = rx + ".*", i + 2
        elif pattern[i] == "*":
            rx, i = rx + "[^/]*", i + 1
        elif pattern[i] == "?":
            rx, i = rx + "[^/]", i + 1
        else:
            rx, i = rx + re.escape(pattern[i]), i + 1
    return re.fullmatch(rx, path) is not None


def evaluate(policy, paths, base_sha, have=("tests", "combined-tests")):
    """Strictest lane over all changed paths wins; `require` lists are unioned (spec section 5)."""
    rank, matched, required, decide_paths, approvers = 0, set(), set(), set(), []
    default = dict(policy.get("default") or {"lane": "flag", "require": ["tests"]}, match=["(default)"])
    for path in paths:
        hits = [r for r in policy.get("rules", []) if any(glob_match(m, path) for m in r["match"])] or [default]
        for r in hits:
            matched.add(",".join(r["match"]))
            required.update(r.get("require", []))
            rank = max(rank, LANE_RANK[r["lane"]])
            if r["lane"] == "decide":
                decide_paths.add(path)
                approvers.append(r.get("approvers") or {"count": 1, "from": []})
    groups = policy.get("groups") or {}
    names = sorted({g for a in approvers for g in a["from"]})
    return {"lane": next(k for k, v in LANE_RANK.items() if v == rank),
            "matchedRules": sorted(matched), "required": sorted(required),
            "missing": sorted(required - set(have)), "policyBaseSha": base_sha,
            "decidePaths": sorted(decide_paths),
            "approvers": {"count": max(a.get("count", 1) for a in approvers), "from": names,
                          "eligible": sorted({e for g in names for e in groups.get(g, [g])})} if approvers else None}
