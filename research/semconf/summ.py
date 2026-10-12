import json, sys
seen = {}
for l in open(sys.argv[1]):
    d = json.loads(l); seen[(d['full_name'], d['a'], d['b'])] = d
for d in seen.values():
    print(d['full_name'][:28].ljust(28), d['a'], d['b'], d['agent_a'][:6], d['agent_b'][:6], 'TC' if d['textual_conflict'] else 'ok', 'A', d['a_rc'], d['a_npass'], d['a_nfail'], 'B', d['b_npass'], d['b_nfail'], 'AB', d.get('ab_rc'), d.get('ab_npass'), d.get('ab_nfail'), 'SEM', d.get('semantic_fail'), 'U' if d['usable'] else 'X', 'sf', len(d['shared_files']))
