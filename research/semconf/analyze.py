"""Aggregate results.jsonl. python3 -I analyze.py <results.jsonl>"""
import json, sys, math, collections
def wilson(k, n, z=1.96):
    if n == 0: return (float('nan'),) * 2
    p = k / n; d = 1 + z*z/n; c = (p + z*z/(2*n)) / d; h = z * math.sqrt(p*(1-p)/n + z*z/(4*n*n)) / d
    return (max(0, c - h), min(1, c + h))
seen = {}
for l in open(sys.argv[1]):
    d = json.loads(l); seen[(d['full_name'], d['a'], d['b'])] = d
import os
F = json.load(open(os.path.join(os.path.dirname(sys.argv[1]), 'seqflags.json')))
for (r, a, b), d in seen.items(): d['sequential'] = F.get(f'{r}#{a}#{b}', {}).get('sequential', None)
R = list(seen.values()); U = [d for d in R if d['usable']]
print('sequential (one head already contains the other landed commit):', sum(bool(d['sequential']) for d in U), 'of usable')
print('attempted', len(R), 'repos', len({d['full_name'] for d in R}), 'usable', len(U), 'usable repos', len({d['full_name'] for d in U}))
for name, sub in [('all usable', U), ('usable & truly concurrent', [d for d in U if d['sequential'] is False]), ('share >=1 file', [d for d in U if d['shared_files']]), ('overlap >= 1h', [d for d in U if float(d['overlap_h']) >= 1])]:
    tc = sum(d['textual_conflict'] for d in sub); clean = [d for d in sub if not d['textual_conflict']]
    sem = sum(bool(d['semantic_fail']) for d in clean)
    print(f"{name}: N={len(sub)} textual={tc} ({tc/max(1,len(sub)):.1%}, CI {wilson(tc,len(sub))[0]:.1%}-{wilson(tc,len(sub))[1]:.1%}); clean={len(clean)} semantic={sem} ({sem/max(1,len(clean)):.1%}, Wilson95 {wilson(sem,len(clean))[0]:.1%}-{wilson(sem,len(clean))[1]:.1%})")
print('agents', collections.Counter(tuple(sorted((d['agent_a'], d['agent_b']))) for d in U))
print('per repo usable', collections.Counter(d['full_name'] for d in U))
print('unusable reasons:')
for d in R:
    if not d['usable']: print('  ', d['full_name'], d['a'], d['b'], 'A', d['a_rc'], d['a_npass'], 'B', d['b_rc'], d['b_npass'], 'AB', d.get('ab_rc'))
