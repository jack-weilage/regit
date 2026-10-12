"""Flag pairs where one PR head already contains the other's landed (squash/merge) commit on the default branch.
python3 -I check_seq.py <semconf_dir>  -> writes seqflags.json"""
import json, sys, subprocess as sp, re
ROOT = sys.argv[1].rstrip('/')
seen = {}
for l in open(f'{ROOT}/results.jsonl'):
    d = json.loads(l); seen[(d['full_name'], d['a'], d['b'])] = d
landed = {}
def land(repo, n):
    R = f"{ROOT}/repos/{repo.replace('/', '_')}"
    if repo not in landed:
        out = sp.run(['git', '-C', R, 'log', '--format=%H %s', 'origin/HEAD'], capture_output=True, text=True).stdout
        landed[repo] = out.splitlines()
    for l in landed[repo]:
        h, s = l.split(' ', 1)
        if re.search(rf'\(#{n}\)\s*$', s) or s.startswith(f'Merge pull request #{n} '): return h
    return None
flags = {}
for (repo, a, b), d in seen.items():
    R = f"{ROOT}/repos/{repo.replace('/', '_')}"
    f = {}
    for x, y, sy in [(a, b, d['sha_b']), (b, a, d['sha_a'])]:
        h = land(repo, x)
        f[f'landed_{x}'] = h
        if h: f[f'{y}_contains_{x}'] = sp.run(['git', '-C', R, 'merge-base', '--is-ancestor', h, sy]).returncode == 0
    f['sequential'] = any(v is True for k, v in f.items() if '_contains_' in k)
    flags[f'{repo}#{a}#{b}'] = f
json.dump(flags, open(f'{ROOT}/seqflags.json', 'w'), indent=1)
print(sum(v['sequential'] for v in flags.values()), 'sequential of', len(flags), '; landed-commit found for', sum(bool(v[k]) for v in flags.values() for k in v if k.startswith('landed_')), 'PR sides')
