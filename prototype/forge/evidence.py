"""Signed, content-addressed evidence (spec section 8).

Stand-ins: HMAC-SHA256 over the DSSE pre-auth encoding replaces Ed25519; the evidence/ev
directory replaces R2 keys `ev/<sha256>`; by-tree.json replaces the D1 evidence index.
"""
import base64
import hashlib
import hmac
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from .gitx import git

PAYLOAD_TYPE = "application/vnd.in-toto+json"
TEST_CMD = [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v"]


def canon(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))


def pae(payload_type, body):
    return f"DSSEv1 {len(payload_type)} {payload_type} {len(body)} ".encode() + body


def run_suite(repo, commit):
    """Check out `commit` into a clean temporary worktree and run the project's tests there."""
    tmp = Path(tempfile.mkdtemp(prefix="forge-run-"))
    wt = tmp / "wt"
    git(repo, "worktree", "add", "-q", "--detach", wt, commit)
    try:
        p = subprocess.run(TEST_CMD, cwd=wt, capture_output=True, text=True, timeout=300,
                           env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
    finally:
        git(repo, "worktree", "remove", "--force", wt)
        shutil.rmtree(tmp, ignore_errors=True)
    out = p.stderr + p.stdout
    cases = dict(re.findall(r"^(test\w* \([\w.]+\)) \.\.\. (ok|FAIL|ERROR|skipped.*)$", out, re.M))
    ran = re.search(r"Ran (\d+) test", out)
    return {"pass": p.returncode == 0, "ran": int(ran.group(1)) if ran else 0,
            "failed": sorted(k for k, v in cases.items() if v in ("FAIL", "ERROR")), "tail": out[-1500:]}


class EvidenceStore:
    def __init__(self, root, key):
        self.root = Path(root)
        (self.root / "ev").mkdir(parents=True, exist_ok=True)
        self._key = key  # held by the Lander/forge process only; never given to a thread
        self.keyid = "lander-hmac-" + hashlib.sha256(key).hexdigest()[:8]
        self.by_tree, self.runs, self.reuses = {}, 0, 0

    def _path(self, h):
        return self.root / "ev" / (h.split(":", 1)[1] + ".json")

    def put(self, obj):
        """Content-address any JSON object; identical content gets the identical key."""
        data = canon(obj).encode()
        h = "sha256:" + hashlib.sha256(data).hexdigest()
        self._path(h).write_bytes(data)  # idempotent: same key, same bytes
        return h

    def get(self, h):
        return json.loads(self._path(h).read_text())

    def mac(self, text):
        return hmac.new(self._key, text.encode(), hashlib.sha256).hexdigest()

    def sign(self, statement):
        body = canon(statement).encode()
        sig = hmac.new(self._key, pae(PAYLOAD_TYPE, body), hashlib.sha256).hexdigest()
        return self.put({"payloadType": PAYLOAD_TYPE, "payload": base64.b64encode(body).decode(),
                         "signatures": [{"keyid": self.keyid, "sig": sig}]})

    def statement(self, h):
        return json.loads(base64.b64decode(self.get(h)["payload"]))

    def verify(self, h):
        """Recheck the content hash and the signature (GET /api/evidence/:hash/verify)."""
        try:
            raw = self._path(h).read_bytes()
        except FileNotFoundError:
            return False
        if "sha256:" + hashlib.sha256(raw).hexdigest() != h:
            return False
        env = json.loads(raw)
        want = hmac.new(self._key, pae(env["payloadType"], base64.b64decode(env["payload"])), hashlib.sha256).hexdigest()
        return any(hmac.compare_digest(s["sig"], want) for s in env["signatures"])

    def test_commit(self, repo, commit):
        """Signed test evidence for the tree of `commit`; reused when this exact tree was already proven."""
        tree = git(repo, "rev-parse", f"{commit}^{{tree}}")
        h = self.by_tree.get(tree)
        if h and self.verify(h):
            self.reuses += 1
            return h, self.statement(h)["predicate"]["result"], True
        self.runs += 1
        result = run_suite(repo, commit)
        h = self.sign({"_type": "https://in-toto.io/Statement/v1",
                       "subject": [{"name": "tree", "digest": {"gitTree": tree}}],
                       "predicateType": "https://forge.demo/evidence/v1",
                       "predicate": {"kind": "tests", "command": "python -m unittest discover -s tests -v",
                                     "inputs": {"gitTree": tree, "firstSeenCommit": git(repo, "rev-parse", commit)},
                                     "producer": {"role": "forge-runner", "runner": "local clean worktree"},
                                     "result": result}})
        self.by_tree[tree] = h
        (self.root / "by-tree.json").write_text(json.dumps(self.by_tree, indent=1))
        return h, result, False
