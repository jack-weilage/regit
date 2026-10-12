"""Thin wrapper over the git CLI, plus readable ids (stand-ins for ULIDs)."""
import itertools
import os
import subprocess
from datetime import datetime, timezone

# Isolate from the user's git config (hooks paths, signing, templates) so runs are reproducible.
BASE_ENV = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_TERMINAL_PROMPT": "0", "GIT_AUTHOR_NAME": "forge", "GIT_AUTHOR_EMAIL": "forge@demo.dev",
            "GIT_COMMITTER_NAME": "forge", "GIT_COMMITTER_EMAIL": "forge@demo.dev"}
for _k in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"):
    BASE_ENV.pop(_k, None)


class GitError(RuntimeError):
    pass


def run(cwd, *args, input=None, env=None):
    """Run git and return the CompletedProcess; the caller checks returncode."""
    return subprocess.run(["git", *map(str, args)], cwd=cwd, input=input, text=True,
                          capture_output=True, env={**BASE_ENV, **(env or {})})


def git(cwd, *args, input=None, env=None):
    """Run git, raise GitError on failure, return stripped stdout."""
    p = run(cwd, *args, input=input, env=env)
    if p.returncode:
        raise GitError(f"git {' '.join(map(str, args))}: {(p.stderr or p.stdout).strip()}")
    return p.stdout.strip()


def who(name, email, committer=True):
    env = {"GIT_AUTHOR_NAME": name, "GIT_AUTHOR_EMAIL": email}
    if committer:
        env.update(GIT_COMMITTER_NAME=name, GIT_COMMITTER_EMAIL=email)
    return env


_ids = itertools.count(1)


def new_id(prefix):
    return f"{prefix}_{next(_ids):03d}"


def short(sha):
    return (sha or "")[:7]


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
