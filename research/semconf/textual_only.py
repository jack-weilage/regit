"""Textual-only merge check for all overlapping pairs in a repo (no tests). python3 -I textual_only.py <semconf_dir> <full_name> [cross_only]"""
import sys, csv, json, subprocess as sp
ROOT, FN = sys.argv[1].rstrip('/'), sys.argv[2]; CROSS = len(sys.argv) > 3
R = f"{ROOT}/repos/{FN.replace('/', '_')}"
def git(*a): return sp.run(['git', '-C', R, *a], capture_output=True, text=True)
pairs = [r for r in csv.DictReader(open(f'{ROOT}/pairs_all.csv')) if r['full_name'] == FN and (not CROSS or r['agent_a'] != r['agent_b'])]
nums = sorted({int(r['a']) for r in pairs} | {int(r['b']) for r in pairs})
git('fetch', '-q', 'origin', *[f'+refs/pull/{n}/head:refs/remotes/pr/{n}' for n in nums])
landed = git('log', '--format=%H %s', 'origin/HEAD').stdout.splitlines()
import re
def land(n):
    for l in landed:
        h, s = l.split(' ', 1)
        if re.search(rf'\(#{n}\)\s*$', s) or s.startswith(f'Merge pull request #{n} '): return h
for r in pairs:
    a, b = f"pr/{r['a']}", f"pr/{r['b']}"
    if git('rev-parse', '-q', '--verify', a).returncode or git('rev-parse', '-q', '--verify', b).returncode: continue
    if git('merge-base', '--is-ancestor', a, b).returncode == 0 or git('merge-base', '--is-ancestor', b, a).returncode == 0: continue
    m = git('merge-tree', '--write-tree', '--name-only', a, b)
    seq = False
    for x, y in [(r['a'], b), (r['b'], a)]:
        h = land(x)
        if h and git('merge-base', '--is-ancestor', h, y).returncode == 0: seq = True
    out = dict(full_name=FN, a=r['a'], b=r['b'], agent_a=r['agent_a'], agent_b=r['agent_b'], textual_conflict=m.returncode == 1,
               conflict_files=m.stdout.split('\n')[1:6] if m.returncode == 1 else [], sequential=seq, overlap_h=r['overlap_h'])
    print(json.dumps(out))
    with open(f'{ROOT}/textual_only.jsonl', 'a') as f: f.write(json.dumps(out) + '\n')
