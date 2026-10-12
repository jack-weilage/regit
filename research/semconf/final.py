"""Final aggregation: python3 -I final.py <semconf_dir>  (run check_seq.py and recompute.py first)."""
import json, sys, math, collections, os, subprocess as sp
sys.argv = [sys.argv[0], sys.argv[1]]
ROOT = sys.argv[1].rstrip('/')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
def wilson(k, n, z=1.96):
    if n == 0: return (float('nan'), float('nan'))
    p = k / n; d = 1 + z*z/n; c = (p + z*z/(2*n)) / d; h = z * math.sqrt(p*(1-p)/n + z*z/(4*n*n)) / d
    return (max(0, c - h), min(1, c + h))
import xml.etree.ElementTree as ET
def passed(repo, sha):
    f = f"{ROOT}/junit/{repo.replace('/', '_')}/{sha[:10]}_r1.xml"
    if not os.path.exists(f): return set()
    P = set()
    for tc in ET.parse(f).getroot().iter('testcase'):
        if tc.find('failure') is None and tc.find('error') is None and tc.find('skipped') is None: P.add(tc.get('classname') + '::' + tc.get('name'))
    return P
seen = {}
for l in open(f'{ROOT}/results.jsonl'):
    d = json.loads(l); seen[(d['full_name'], d['a'], d['b'])] = d
F = json.load(open(f'{ROOT}/seqflags.json')); RC = json.load(open(f'{ROOT}/recompute.json'))
rows = []
for (r, a, b), d in seen.items():
    k = f'{r}#{a}#{b}'
    d['sequential'] = F.get(k, {}).get('sequential')
    d['shared_pass'] = len(passed(r, d['sha_a']) & passed(r, d['sha_b']))
    R_ = f"{ROOT}/repos/{r.replace('/', '_')}"
    fa = sp.run(['git', '-C', R_, 'diff', '--name-only', d['mb'], d['sha_a']], capture_output=True, text=True).stdout.split()
    fb = sp.run(['git', '-C', R_, 'diff', '--name-only', d['mb'], d['sha_b']], capture_output=True, text=True).stdout.split()
    d['touch_tests'] = any('test' in f.lower() for f in fa + fb)
    rc = RC.get(k)
    if not d['textual_conflict'] and d['usable']:
        sem1 = rc['r1'] if rc else d.get('semantic_fail')
        sem2 = rc['r2'] if rc else None
        d['sem_final'] = [t for t in (sem1 or []) if sem2 is None or t in sem2] if sem1 else []
        d['sem_r1_only'] = [t for t in (sem1 or []) if t not in d['sem_final']]
    rows.append(d)
U = [d for d in rows if d['usable']]
def report(name, sub):
    tc = sum(d['textual_conflict'] for d in sub); clean = [d for d in sub if not d['textual_conflict']]
    sem = sum(bool(d['sem_final']) for d in clean)
    w1 = wilson(tc, len(sub)); w2 = wilson(sem, len(clean))
    print(f"| {name} | {len(sub)} | {len({d['full_name'] for d in sub})} | {tc} ({tc/max(1,len(sub)):.0%}; {w1[0]:.0%}-{w1[1]:.0%}) | {len(clean)} | {sem} ({sem/max(1,len(clean)):.1%}; {w2[0]:.1%}-{w2[1]:.1%}) |")
print('attempted pairs', len(rows), 'repos', len({d['full_name'] for d in rows}))
A = rows
tcA = sum(d['textual_conflict'] for d in A); print('textual conflicts among ALL attempted merges', tcA, len(A), wilson(tcA, len(A)))
print('usable', len(U), 'repos', len({d['full_name'] for d in U}))
print('| subset | pairs | repos | textual conflict (95% CI) | clean merges | semantic conflict (95% Wilson CI) |')
print('|---|---|---|---|---|---|')
report('All usable', U)
report('Truly concurrent (neither head contains the other\'s landed commit)', [d for d in U if d['sequential'] is False])
report('... and share >=1 changed file', [d for d in U if d['sequential'] is False and d['shared_files']])
report('... and >=20 tests pass in both A and B', [d for d in U if d['sequential'] is False and d['shared_pass'] >= 20])
report('Overlap >= 1 h (by AIDev timestamps)', [d for d in U if float(d['overlap_h']) >= 1])
print('sequential', sum(bool(d['sequential']) for d in U), 'unknown', sum(d['sequential'] is None for d in U))
print('agents usable', collections.Counter(d['agent_a'] if d['agent_a'] == d['agent_b'] else 'cross' for d in U))
print('cross-agent attempted', sum(d['agent_a'] != d['agent_b'] for d in rows))
print('overlap_h median', sorted(float(d['overlap_h']) for d in U)[len(U)//2] if U else None, 'frac <0.1h', sum(float(d['overlap_h']) < 0.1 for d in U) / max(1, len(U)))
print('flaky-excluded (r1 only):', [(d['full_name'], d['a'], d['b'], d['sem_r1_only']) for d in U if d.get('sem_r1_only')])
print('SEMANTIC:', [(d['full_name'], d['a'], d['b'], d['sem_final']) for d in U if d.get('sem_final')])
print('\nper repo:')
for r, g in sorted(collections.groupby(sorted(rows, key=lambda d: d['full_name']), key=lambda d: d['full_name']) if False else []): pass
byr = collections.defaultdict(list)
for d in rows: byr[d['full_name']].append(d)
print('| repo | agent(s) | attempted | usable | textual | clean | sem | median tests passing in both |')
print('|---|---|---|---|---|---|---|---|')
for r, g in sorted(byr.items()):
    u = [d for d in g if d['usable']]
    sp_ = sorted(d['shared_pass'] for d in u)
    print(f"| {r} | {'/'.join(sorted({d['agent_a'] for d in g} | {d['agent_b'] for d in g}))} | {len(g)} | {len(u)} | {sum(d['textual_conflict'] for d in g)} | {sum(not d['textual_conflict'] for d in u)} | {sum(bool(d.get('sem_final')) for d in u)} | {sp_[len(sp_)//2] if sp_ else '-'} |")
print('\nunusable:')
for d in rows:
    if not d['usable']: print(' ', d['full_name'], d['a'], d['b'], 'rcA', d['a_rc'], 'passA', d['a_npass'], 'TC', d['textual_conflict'])
print('\ntextual conflicts:')
for d in rows:
    if d['textual_conflict']: print(' ', d['full_name'], d['a'], d['b'], d['agent_a'], d['conflict_files'][:4], 'seq', d['sequential'], 'usable', d['usable'])
json.dump(rows, open(f'{ROOT}/final_rows.json', 'w'), indent=1, default=str)
