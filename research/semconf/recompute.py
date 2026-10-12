"""Post-hoc recompute of semantic failures from junit XMLs, counting AB collection errors of modules that ran in A/B.
python3 -I recompute.py <semconf_dir>"""
import json, sys, os, xml.etree.ElementTree as ET
ROOT = sys.argv[1].rstrip('/')
def load(repo, sha, tag='r1'):
    f = f"{ROOT}/junit/{repo.replace('/', '_')}/{sha[:10]}_{tag}.xml"
    if not os.path.exists(f): return None
    P, Fl, CE = set(), set(), set()
    try: root = ET.parse(f).getroot()
    except Exception: return None
    for tc in root.iter('testcase'):
        cn, nm = tc.get('classname', ''), tc.get('name', '')
        bad = tc.find('failure') is not None or tc.find('error') is not None
        if cn == '' and bad: CE.add(nm); continue
        if bad: Fl.add(cn + '::' + nm)
        elif tc.find('skipped') is None: P.add(cn + '::' + nm)
    return P, Fl, CE
def sem(repo, a, b, ab, tag='r1'):
    A, B, AB = load(repo, a, tag), load(repo, b, tag), load(repo, ab, tag)
    if None in (A, B, AB): return None
    out = []
    for t in AB[1]:
        ins = [X for X in (A, B) if t in X[0] | X[1]]
        if ins and all(t in X[0] for X in ins): out.append(t)
    for m in AB[2]:
        ran = [X for X in (A, B) if any(t.startswith(m + '.') or t.startswith(m + '::') for t in X[0])]
        if ran and not any(m in X[2] for X in (A, B)): out.append('COLLECTION:' + m)
    return sorted(out)
seen = {}
for l in open(f'{ROOT}/results.jsonl'):
    d = json.loads(l); seen[(d['full_name'], d['a'], d['b'])] = d
res = {}
for (r, a, b), d in seen.items():
    if d['textual_conflict'] or not d['usable']: continue
    s1 = sem(r, d['sha_a'], d['sha_b'], d['sha_ab'])
    s2 = sem(r, d['sha_a'], d['sha_b'], d['sha_ab'], 'r2')
    res[f'{r}#{a}#{b}'] = dict(r1=s1, r2=s2, runner=d.get('semantic_fail'))
    if s1: print(r, a, b, 'r1', s1[:6], 'r2', None if s2 is None else s2[:6], 'runner', d.get('semantic_fail'))
json.dump(res, open(f'{ROOT}/recompute.json', 'w'), indent=1)
print('pairs checked', len(res), 'with r1 semantic', sum(bool(v['r1']) for v in res.values()))
