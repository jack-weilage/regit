"""Addendum: within-repo time-to-merge models + Codex no-link body inspection. python3 -I addendum.py <data_dir>"""
import sys
sys.path.insert(0, '/root/.local/lib/python3.13/site-packages')
import numpy as np, pandas as pd, statsmodels.api as sm
D = sys.argv[1].rstrip('/') + '/'
pr = pd.read_parquet(D + 'pull_request.parquet'); pr['body'] = pr.body.fillna('')
rev = pd.read_parquet(D + 'pr_reviews.parquet', columns=['pr_id', 'user', 'user_type'])
P = r'chatgpt\.com/(?:codex/tasks/task_|s/cd_)|cursor\.com/(?:background-agent\?bcId=|agents\?id=)|app\.devin\.ai/sessions/[0-9a-f]|jules\.google\.com/task/\d'
pr['link'] = pr.body.str.contains(P, regex=True).astype(float)
pr['month'] = pr.created_at.str[:7]
W = {'OpenAI_Codex': '2025-06', 'Cursor': '2025-07', 'Devin': '2024-12', 'Google_Jules': '2025-09'}
pr = pr[pr.agent.isin(W) & (pr.state == 'closed')]
pr = pr[pr.apply(lambda r: r.month >= W[r.agent], axis=1)]
rv = rev.merge(pr[['id', 'user']].rename(columns={'id': 'pr_id', 'user': 'a'}), on='pr_id')
bot = rv.user_type.fillna('').str.lower().eq('bot') | rv.user.fillna('').str.contains(r'\[bot\]|copilot', case=False, regex=True)
pr['hrev'] = pr.id.isin(rv[~bot & (rv.user.str.lower() != rv.a.str.lower())].pr_id)
pr['lb'] = np.log1p(pr.body.str.replace(r'https?://\S+', '', regex=True).str.len())
m = pr[pr.merged_at.notna()].copy()
m['lt'] = np.log(((pd.to_datetime(m.merged_at) - pd.to_datetime(m.created_at)).dt.total_seconds() / 3600).clip(lower=1 / 60))
m['self_fast'] = (np.exp(m['lt']) <= 5 / 60)


def fe(df, label):
    df = df.copy(); df['g'] = df.repo_id.astype(str) + df.agent
    v = df.groupby('g').link.agg(['min', 'max']); df = df[df.g.isin(v[v['min'] != v['max']].index)]
    X = pd.concat([df[['lt', 'link', 'lb']], pd.get_dummies(df.month, drop_first=True).astype(float)], axis=1)
    X = X - X.groupby(df.g.values).transform('mean')
    r = sm.OLS(X['lt'], X.drop(columns=['lt'])).fit(cov_type='cluster', cov_kwds={'groups': pd.factorize(df.repo_id)[0]})
    lo, hi = r.conf_int().loc['link']
    print(f"{label}: N={len(df)} groups={df.g.nunique()} TTM ratio={np.exp(r.params['link']):.3f} [{np.exp(lo):.3f},{np.exp(hi):.3f}] p={r.pvalues['link']:.4f}")


fe(m, 'within repo x agent, all merged')
fe(m[m.hrev], 'within repo x agent, merged + human-reviewed')
for ag in ['OpenAI_Codex', 'Cursor', 'Devin']:
    fe(m[m.agent == ag], f'within repo, {ag}, all merged')
print('share merged within 5 min of creation (self-merge proxy) by agent x link:')
print(m.groupby(['agent', 'link']).self_fast.agg(['mean', 'size']).round(3).to_string())
print('share with human review by agent x link (closed):')
print(pr.groupby(['agent', 'link']).hrev.agg(['mean', 'size']).round(3).to_string())
c = pr[(pr.agent == 'OpenAI_Codex') & (pr.link == 0)]
print('Codex no-link (>=2025-06) N', len(c), 'has "## Summary"', c.body.str.contains('## Summary').mean().round(3),
      'has "## Testing"', c.body.str.contains('## Testing').mean().round(3), 'empty', (c.body.str.len() < 5).mean().round(3))
c2 = pr[(pr.agent == 'OpenAI_Codex') & (pr.link == 1)]
print('Codex link: "## Summary"', c2.body.str.contains('## Summary').mean().round(3))
cu = pr[pr.agent == 'Cursor']
print('Cursor link vs nolink, mention "Cursor Agent"/"Background Agent":', cu.groupby('link').body.apply(lambda s: s.str.contains('Cursor Agent|Background Agent|background agent', regex=True).mean()).round(3).to_dict())

# size control: number of commits in the PR
nc = pd.read_parquet(D + 'pr_commits.parquet', columns=['pr_id']).groupby('pr_id').size().rename('nc')
m = m.merge(nc, left_on='id', right_index=True, how='left'); m['nc'] = np.log1p(m.nc.fillna(1))
def fe2(df, label):
    df = df.copy(); df['g'] = df.repo_id.astype(str) + df.agent
    v = df.groupby('g').link.agg(['min', 'max']); df = df[df.g.isin(v[v['min'] != v['max']].index)]
    X = pd.concat([df[['lt', 'link', 'lb', 'nc']], pd.get_dummies(df.month, drop_first=True).astype(float)], axis=1)
    X = X - X.groupby(df.g.values).transform('mean')
    r = sm.OLS(X['lt'], X.drop(columns=['lt'])).fit(cov_type='cluster', cov_kwds={'groups': pd.factorize(df.repo_id)[0]})
    lo, hi = r.conf_int().loc['link']
    print(f"{label} (+log n_commits): N={len(df)} groups={df.g.nunique()} TTM ratio={np.exp(r.params['link']):.3f} [{np.exp(lo):.3f},{np.exp(hi):.3f}] p={r.pvalues['link']:.4f}")
fe2(m, 'within repo x agent, all merged')
fe2(m[m.hrev], 'within repo x agent, merged + human-reviewed')
print('median commits per merged PR by agent x link:', m.assign(n=np.expm1(m.nc)).groupby(['agent', 'link']).n.median().to_dict())
