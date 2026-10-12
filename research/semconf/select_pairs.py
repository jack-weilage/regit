"""Select overlapping merged agent-PR pairs in Python repos. python3 -I select_pairs.py <data_dir> <out_csv>"""
import sys
sys.path.insert(0, '/root/.local/lib/python3.13/site-packages')
import numpy as np, pandas as pd
D = sys.argv[1].rstrip('/') + '/'
pr = pd.read_parquet(D + 'pull_request.parquet', columns=['id','number','agent','created_at','merged_at','repo_id'])
repo = pd.read_parquet(D + 'repository.parquet')
py = repo[(repo.language == 'Python') & (~repo.is_forked)]
pr = pr[pr.repo_id.isin(py.id) & pr.merged_at.notna()].copy()
pr['c'] = pd.to_datetime(pr.created_at).astype('int64') // 10**9; pr['m'] = pd.to_datetime(pr.merged_at).astype('int64') // 10**9
out = []
for rid, g in pr.groupby('repo_id'):
    if len(g) < 2: continue
    c, m = g.c.values, g.m.values
    A, B = np.triu_indices(len(g), 1)
    ok = (np.maximum(c[A], c[B]) < np.minimum(m[A], m[B]))
    A, B = A[ok], B[ok]
    if len(A) == 0: continue
    out.append(pd.DataFrame(dict(repo_id=rid, a=g.number.values[A], b=g.number.values[B], agent_a=g.agent.values[A], agent_b=g.agent.values[B],
        overlap_h=(np.minimum(m[A], m[B]) - np.maximum(c[A], c[B])) / 3600, n_merged_repo=len(g))))
df = pd.concat(out).merge(py[['id','full_name','stars']].rename(columns={'id':'repo_id'}), on='repo_id')
df.to_csv(sys.argv[2], index=False)
s = df.groupby(['full_name','stars','n_merged_repo']).size().sort_values(ascending=False)
print(len(df), 'pairs in', df.repo_id.nunique(), 'repos')
print(s.head(80).to_string())
print(df.groupby('agent_a').size())
