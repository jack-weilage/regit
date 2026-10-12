"""Pilot semantic-conflict runner.
python3 -I run_pairs.py <semconf_dir> <full_name> <max_pairs> [extra pip args...]
For each overlapping merged agent-PR pair in the repo: fetch PR heads, merge-base, textual merge of B into A,
run pytest (junit) on A, B, A+B; semantic conflict = tests failing in A+B that pass in A and in B
(or pass in the only state where they exist). Results appended to results.jsonl."""
import sys, os, json, subprocess as sp, csv, xml.etree.ElementTree as ET, shutil, time
ROOT = sys.argv[1].rstrip('/'); FN = sys.argv[2]; MAXP = int(sys.argv[3]); PIP = sys.argv[4:]
NAME = FN.replace('/', '_'); R = f'{ROOT}/repos/{NAME}'; V = f'{ROOT}/venvs/{NAME}'; J = f'{ROOT}/junit/{NAME}'
os.makedirs(J, exist_ok=True)
LOG = open(f'{ROOT}/logs_{NAME}.txt', 'a')
def git(*a, check=True):
    p = sp.run(['git', '-C', R, *a], capture_output=True, text=True)
    if check and p.returncode: raise RuntimeError(' '.join(a) + ': ' + p.stderr[-500:])
    return p
def log(*a): print(*a, file=LOG, flush=True); print(NAME, *a, flush=True)
pairs = [r for r in csv.DictReader(open(f'{ROOT}/pairs_all.csv')) if r['full_name'] == FN]
nums = sorted({int(r['a']) for r in pairs} | {int(r['b']) for r in pairs})
for i in range(0, len(nums), 50):
    git('fetch', '-q', 'origin', *[f'+refs/pull/{n}/head:refs/remotes/pr/{n}' for n in nums[i:i+50]], check=False)
have = {int(l.split('/')[-1]) for l in git('for-each-ref', '--format=%(refname)', 'refs/remotes/pr/').stdout.split()}
def files(a, b): return set(git('diff', '--name-only', a, b).stdout.split())
cand = []
for r in pairs:
    a, b = int(r['a']), int(r['b'])
    if a not in have or b not in have: continue
    ha, hb = f'pr/{a}', f'pr/{b}'
    mb = git('merge-base', ha, hb, check=False).stdout.strip()
    if not mb: continue
    if git('merge-base', '--is-ancestor', ha, hb, check=False).returncode == 0 or git('merge-base', '--is-ancestor', hb, ha, check=False).returncode == 0:
        continue  # stacked PRs
    fa, fb = files(mb, ha), files(mb, hb)
    pya = {f for f in fa if f.endswith('.py')}; pyb = {f for f in fb if f.endswith('.py')}
    if not pya or not pyb: continue  # both must touch python code
    da = {os.path.dirname(f) for f in pya}; db = {os.path.dirname(f) for f in pyb}
    cand.append(dict(r, mb=mb, sha_a=git('rev-parse', ha).stdout.strip(), sha_b=git('rev-parse', hb).stdout.strip(),
                     shared_files=sorted(fa & fb), shared_pydirs=sorted(da & db), nfa=len(fa), nfb=len(fb)))
cand.sort(key=lambda c: (-len(c['shared_files']) > 0, -len(c['shared_pydirs']), -len(c['shared_files'])))
cand.sort(key=lambda c: (len(c['shared_files']) == 0, len(c['shared_pydirs']) == 0))
log('pairs in data', len(pairs), 'with refs+py+nonstacked', len(cand))
cand = cand[:MAXP]
# venv: install at the newest head among selected states (deps rarely change within days)
if cand and not os.path.exists(V):
    sp.run(['uv', 'venv', '-q', '--python', '3.12', V], check=True)
    newest = max((c['sha_a'] for c in cand), key=lambda s: int(git('show', '-s', '--format=%ct', s).stdout))
    git('checkout', '-q', '-f', newest); git('clean', '-qfdx')
    env = dict(os.environ, VIRTUAL_ENV=V)
    reqs = []
    for f in ['requirements.txt', 'requirements-dev.txt']:
        if os.path.exists(f'{R}/{f}'): reqs += ['-r', f'{R}/{f}']
    extras, extra_pkgs = [], []
    try:
        import tomllib
        t = tomllib.load(open(f'{R}/pyproject.toml', 'rb'))
        od = t.get('project', {}).get('optional-dependencies', {})
        extras = [k for k in od if any(w in k.lower() for w in ('test', 'dev', 'all'))]
        for g, deps in t.get('dependency-groups', {}).items():
            if any(w in g.lower() for w in ('test', 'dev')): extra_pkgs += [d for d in deps if isinstance(d, str)]
        for g, gd in t.get('tool', {}).get('poetry', {}).get('group', {}).items():
            if any(w in g.lower() for w in ('test', 'dev')): extra_pkgs += [k for k in gd.get('dependencies', {}) if k != 'python']
        extra_pkgs += [k for k in t.get('tool', {}).get('poetry', {}).get('dev-dependencies', {}) if k != 'python']
    except Exception as e:
        log('pyproject parse', e)
    RX = R + ('[' + ','.join(extras) + ']' if extras else '')
    reqs += extra_pkgs
    inst = ['-e', RX] if (os.path.exists(f'{R}/pyproject.toml') or os.path.exists(f'{R}/setup.py')) else []
    p = sp.run(['uv', 'pip', 'install', '-q', '--python', f'{V}/bin/python', *inst, *reqs, 'pytest', 'pytest-timeout', *PIP], capture_output=True, text=True, env=env, timeout=900)
    if p.returncode and inst:
        p = sp.run(['uv', 'pip', 'install', '-q', '--python', f'{V}/bin/python', *reqs, 'pytest', 'pytest-timeout', *PIP], capture_output=True, text=True, env=env, timeout=900)
    log('install rc', p.returncode, p.stderr[-800:])
cache = {}
def run_tests(sha, tag):
    key = (sha, tag)
    if key in cache: return cache[key]
    git('checkout', '-q', '-f', sha); git('clean', '-qfdx', '-e', '*.egg-info')
    xml = f'{J}/{sha[:10]}_{tag}.xml'
    t0 = time.time()
    try:
        p = sp.run([f'{V}/bin/python', '-m', 'pytest', '-q', '-p', 'no:cacheprovider', '--timeout=60', '--continue-on-collection-errors', f'--junitxml={xml}', '-o', 'addopts=', *os.environ.get('SEMCONF_TESTPATHS', '').split()],
                   cwd=R, capture_output=True, text=True, timeout=300, env=dict(os.environ, VIRTUAL_ENV=V, PYTHONDONTWRITEBYTECODE='1'))
        rc = p.returncode; tail = p.stdout[-1500:]
    except sp.TimeoutExpired:
        rc = 'timeout'; tail = ''
    passed, failed = set(), set()
    if os.path.exists(xml):
        for tc in ET.parse(xml).getroot().iter('testcase'):
            tid = tc.get('classname', '') + '::' + tc.get('name', '')
            if tc.find('failure') is not None or tc.find('error') is not None: failed.add(tid)
            elif tc.find('skipped') is None: passed.add(tid)
    res = dict(rc=rc, passed=passed, failed=failed, secs=round(time.time() - t0), tail=tail)
    cache[key] = res; return res
for c in cand:
    out = {k: c[k] for k in ['full_name', 'a', 'b', 'agent_a', 'agent_b', 'overlap_h', 'mb', 'sha_a', 'sha_b', 'shared_files', 'shared_pydirs', 'nfa', 'nfb']}
    git('checkout', '-q', '-f', c['sha_a']); git('clean', '-qfdx')
    m = git('merge', '--no-edit', '--no-ff', '-q', c['sha_b'], check=False)
    if m.returncode:
        out['textual_conflict'] = True
        out['conflict_files'] = git('diff', '--name-only', '--diff-filter=U', check=False).stdout.split()
        git('merge', '--abort', check=False)
    else:
        out['textual_conflict'] = False
        out['sha_ab'] = git('rev-parse', 'HEAD').stdout.strip()
    ra, rb = run_tests(c['sha_a'], 'r1'), run_tests(c['sha_b'], 'r1')
    out.update(a_rc=ra['rc'], b_rc=rb['rc'], a_npass=len(ra['passed']), b_npass=len(rb['passed']), a_nfail=len(ra['failed']), b_nfail=len(rb['failed']))
    if not out['textual_conflict']:
        rab = run_tests(out['sha_ab'], 'r1')
        allA = ra['passed'] | ra['failed']; allB = rb['passed'] | rb['failed']
        def okprior(t):
            ins = [s for s in (('A', ra, allA), ('B', rb, allB)) if t in s[2]]
            return bool(ins) and all(t in s[1]['passed'] for s in ins)
        newfail = sorted(t for t in rab['failed'] if okprior(t))
        if newfail:  # rerun A, B, AB once to exclude flakes
            ra2, rb2, rab2 = run_tests(c['sha_a'], 'r2'), run_tests(c['sha_b'], 'r2'), run_tests(out['sha_ab'], 'r2')
            newfail = [t for t in newfail if t in rab2['failed'] and t not in ra2['failed'] and t not in rb2['failed']]
        out.update(ab_rc=rab['rc'], ab_npass=len(rab['passed']), ab_nfail=len(rab['failed']), semantic_fail=newfail,
                   ab_tail=rab['tail'][-600:] if newfail else '')
    out['usable'] = (ra['rc'] != 'timeout' and rb['rc'] != 'timeout' and len(ra['passed']) > 0 and len(rb['passed']) > 0
                     and (out['textual_conflict'] or out.get('ab_rc') != 'timeout'))
    log(json.dumps({k: v for k, v in out.items() if k not in ('ab_tail',)})[:600])
    with open(f'{ROOT}/results.jsonl', 'a') as f: f.write(json.dumps(out) + '\n')
log('DONE')
