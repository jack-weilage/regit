"""Robustness: stream full AIDev all_pull_request.parquet (2.7M PRs, all repos), flag session links,
compare merge rates within agent and template era. Run: python3 -I full_scan.py <data_dir> <out_dir>"""
import sys
sys.path.insert(0, '/root/.local/lib/python3.13/site-packages')
import numpy as np, pandas as pd, pyarrow.parquet as pq, json
import statsmodels.api as sm

D = sys.argv[1].rstrip('/') + '/'; OUT = sys.argv[2].rstrip('/') + '/'
SESSION = {
    'codex_task': r'chatgpt\.com/codex/tasks/task_',
    'codex_share': r'chatgpt\.com/s/cd_',
    'cursor_agent': r'cursor\.com/(?:background-agent\?bcId=|agents\?id=)',
    'devin_session': r'app\.devin\.ai/sessions/[0-9a-f]',
    'jules_task': r'jules\.google\.com/task/\d',
    'claude_session': r'claude\.ai/code/session_|Claude-Session:',
    'amp_thread': r'ampcode\.com/threads/|Amp-Thread',
    'copilot_session': r'/agent-sessions/|github\.com/copilot/tasks/',
}
parts = []
pf = pq.ParquetFile(D + 'all_pull_request.parquet')
for batch in pf.iter_batches(batch_size=200_000, columns=['id', 'agent', 'user', 'state', 'created_at', 'closed_at', 'merged_at', 'repo_id', 'body']):
    df = batch.to_pandas()
    b = df.body.fillna('')
    for k, p in SESSION.items():
        df[k] = b.str.contains(p, regex=True)
    df['blen'] = b.str.replace(r'https?://\S+', '', regex=True).str.len()
    parts.append(df.drop(columns=['body']))
pr = pd.concat(parts, ignore_index=True)
pr['has_link'] = pr[list(SESSION)].any(axis=1)
repo = pd.read_parquet(D + 'all_repository.parquet', columns=['id', 'full_name', 'stars'])
repo['owner'] = repo.full_name.str.split('/').str[0].str.lower()
pr = pr.merge(repo.rename(columns={'id': 'repo_id'})[['repo_id', 'owner', 'stars']], on='repo_id', how='left')
pr['own'] = pr.user.str.lower().eq(pr.owner).astype(float)
pr['month'] = pr.created_at.str[:7]
pr['merged'] = pr.merged_at.notna().astype(float)
pr['ttm_h'] = (pd.to_datetime(pr.merged_at) - pd.to_datetime(pr.created_at)).dt.total_seconds() / 3600

counts = pr.groupby('agent')[list(SESSION) + ['has_link']].sum()
counts['N'] = pr.groupby('agent').size()
counts.to_csv(OUT + 'full_link_counts.csv')

WINDOW = {'OpenAI_Codex': '2025-06', 'Cursor': '2025-07', 'Devin': '2024-12', 'Google_Jules': '2025-09'}
closed = pr[pr.state == 'closed']
rows = []
for ag, start in WINDOW.items():
    for lab, g in [('all months', closed[closed.agent == ag]),
                   (f'>= {start}', closed[(closed.agent == ag) & (closed.month >= start)])]:
        L, N = g[g.has_link], g[~g.has_link]
        r = {'agent': ag, 'window': lab, 'n_link': len(L), 'n_nolink': len(N),
             'merge_link': round(L.merged.mean(), 3), 'merge_nolink': round(N.merged.mean(), 3),
             'raw_diff_pp': round(100 * (L.merged.mean() - N.merged.mean()), 1),
             'medTTM_h_link': round(L[L.merged == 1].ttm_h.median(), 2),
             'medTTM_h_nolink': round(N[N.merged == 1].ttm_h.median(), 2)}
        if lab != 'all months' and len(N) > 50:
            # LPM: merged ~ link + month FE + owner + log body + log stars, repo-clustered SE
            d = g.copy()
            X = pd.concat([d[['has_link']].astype(float), d[['own']].fillna(0),
                           np.log1p(d.blen).rename('lb'), np.log1p(d.stars.fillna(0)).rename('ls'),
                           pd.get_dummies(d.month, drop_first=True).astype(float)], axis=1)
            X = sm.add_constant(X)
            m = sm.OLS(d.merged, X).fit(cov_type='cluster', cov_kwds={'groups': pd.factorize(d.repo_id.fillna(-1))[0]})
            lo, hi = m.conf_int().loc['has_link']
            r['adj_diff_pp'] = f"{100*m.params['has_link']:+.1f} [{100*lo:+.1f},{100*hi:+.1f}]"
            # within-repo: demean by repo
            d['g'] = d.repo_id
            v = d.groupby('g').has_link.agg(['min', 'max']); keep = v[v['min'] != v['max']].index
            d = d[d.g.isin(keep)]
            if len(d) > 50:
                cols = pd.concat([d[['merged']], d[['has_link']].astype(float), np.log1p(d.blen).rename('lb'),
                                  pd.get_dummies(d.month, drop_first=True).astype(float)], axis=1)
                cols = cols - cols.groupby(d.g.values).transform('mean')
                m2 = sm.OLS(cols.merged, cols.drop(columns=['merged'])).fit(cov_type='cluster', cov_kwds={'groups': pd.factorize(d.repo_id.fillna(-1))[0]})
                lo, hi = m2.conf_int().loc['has_link']
                r['within_repo_pp'] = f"{100*m2.params['has_link']:+.1f} [{100*lo:+.1f},{100*hi:+.1f}]"
                r['within_repo_N'] = len(d); r['within_repo_repos'] = d.g.nunique()
        rows.append(r)
res = pd.DataFrame(rows); res.to_csv(OUT + 'full_comparisons.csv', index=False)
meta = {'N': len(pr), 'N_closed': len(closed), 'created_min': pr.created_at.min(), 'created_max': pr.created_at.max()}
json.dump(meta, open(OUT + 'full_meta.json', 'w'), indent=1, default=str)
pd.set_option('display.width', 250); pd.set_option('display.max_columns', 30)
print(meta); print(counts.to_string()); print(res.to_string())
