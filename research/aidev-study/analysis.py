"""Session-link vs merge outcome study on AIDev-pop (hao-li/AIDev @ 7840b6e).
Run: python3 -I analysis.py <data_dir> <out_dir>
"""
import sys
sys.path.insert(0, '/root/.local/lib/python3.13/site-packages')
import re, json
import numpy as np
import pandas as pd
import statsmodels.formula.api as smf

D = sys.argv[1].rstrip('/') + '/'
OUT = sys.argv[2].rstrip('/') + '/'
rng = np.random.default_rng(20261012)
NBOOT = 400

# ---------------------------------------------------------------- load
pr = pd.read_parquet(D + 'pull_request.parquet')
repo = pd.read_parquet(D + 'repository.parquet')
rev = pd.read_parquet(D + 'pr_reviews.parquet', columns=['pr_id', 'user', 'user_type', 'state'])
cm = pd.read_parquet(D + 'pr_commits.parquet', columns=['pr_id', 'message'])
pr['body'] = pr.body.fillna('')

# ---------------------------------------------------------------- link classification
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
ATTRIB = {
    'cc_generated_with': r'Generated with \[Claude Code\]',
    'co_authored_claude': r'Co-Authored-By: Claude',
}
for k, p in {**SESSION, **ATTRIB}.items():
    pr['b_' + k] = pr.body.str.contains(p, regex=True, case=(k != 'co_authored_claude'))
cm['message'] = cm.message.fillna('')
for k, p in {**SESSION, **ATTRIB}.items():
    hit = cm[cm.message.str.contains(p, regex=True, case=(k != 'co_authored_claude'))].pr_id.unique()
    pr['c_' + k] = pr.id.isin(hit)
pr['has_link'] = pr[['b_' + k for k in SESSION]].any(axis=1)
pr['has_link_any'] = pr['has_link'] | pr[['c_' + k for k in SESSION]].any(axis=1)

link_counts = []
for ag, g in pr.groupby('agent'):
    row = {'agent': ag, 'N': len(g)}
    for k in list(SESSION) + list(ATTRIB):
        row['body:' + k] = int(g['b_' + k].sum())
        row['commit:' + k] = int(g['c_' + k].sum())
    row['any_session_link_body'] = int(g.has_link.sum())
    row['any_session_link_body_or_commit'] = int(g.has_link_any.sum())
    link_counts.append(row)
link_counts = pd.DataFrame(link_counts).set_index('agent').T
link_counts['Total'] = link_counts.sum(axis=1)
link_counts.to_csv(OUT + 'link_counts.csv')

# samples for regex validation
samples = {}
for k, p in SESSION.items():
    s = pr[pr['b_' + k]]
    out = []
    for b in s.body.sample(min(5, len(s)), random_state=7):
        m = re.search(p, b)
        out.append(b[max(0, m.start() - 60): m.end() + 60])
    samples[k] = {'n': len(s), 'examples': out}
json.dump(samples, open(OUT + 'link_samples.json', 'w'), indent=1)

# ---------------------------------------------------------------- covariates
pr['created'] = pd.to_datetime(pr.created_at)
pr['closed'] = pd.to_datetime(pr.closed_at)
pr['merged_t'] = pd.to_datetime(pr.merged_at)
pr['month'] = pr.created_at.str[:7]
pr['is_closed'] = pr.state.eq('closed')
pr['merged'] = pr.merged_at.notna()
pr['ttm_h'] = (pr.merged_t - pr.created).dt.total_seconds() / 3600
pr['ttc_h'] = (pr.closed - pr.created).dt.total_seconds() / 3600
pr['body_len_nourl'] = pr.body.str.replace(r'https?://\S+', '', regex=True).str.len()
repo['owner'] = repo.full_name.str.split('/').str[0].str.lower()
pr = pr.merge(repo[['id', 'stars', 'owner', 'full_name']].rename(columns={'id': 'repo_id'}), on='repo_id', how='left')
pr['author_is_owner'] = pr.user.str.lower().eq(pr.owner)
pr['log_stars'] = np.log1p(pr.stars.fillna(0))
pr['log_body'] = np.log1p(pr.body_len_nourl)

# human review by someone other than the PR author
rv = rev.merge(pr[['id', 'user']].rename(columns={'id': 'pr_id', 'user': 'author'}), on='pr_id')
is_bot = rv.user_type.fillna('').str.lower().eq('bot') | rv.user.fillna('').str.contains(r'\[bot\]|copilot', case=False, regex=True)
hr = rv[(~is_bot) & (rv.user.str.lower() != rv.author.str.lower())]
pr['human_review'] = pr.id.isin(hr.pr_id.unique())
pr['human_approve'] = pr.id.isin(hr[hr.state == 'APPROVED'].pr_id.unique())

# ---------------------------------------------------------------- stat helpers
def wilson(k, n, z=1.96):
    if n == 0:
        return (np.nan, np.nan)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (c - h, c + h)


def cluster_boot(df, stat, nboot=NBOOT):
    """Bootstrap resampling repos (clusters) with replacement."""
    groups = df.groupby('repo_id').indices
    keys = np.array(list(groups.keys()))
    idx_lists = [groups[k] for k in keys]
    vals = []
    for _ in range(nboot):
        pick = rng.integers(0, len(keys), len(keys))
        idx = np.concatenate([idx_lists[i] for i in pick])
        v = stat(df.iloc[idx])
        if v is not None and not np.isnan(v):
            vals.append(v)
    return np.percentile(vals, [2.5, 97.5]) if vals else (np.nan, np.nan)


def merge_diff(d):
    a = d[d.has_link].merged.mean(); b = d[~d.has_link].merged.mean()
    return a - b


def med_diff(col):
    def f(d):
        a = d[d.has_link][col].dropna(); b = d[~d.has_link][col].dropna()
        if len(a) < 5 or len(b) < 5:
            return np.nan
        return a.median() - b.median()
    return f


def compare(d, label):
    """d: closed PRs only."""
    L, N = d[d.has_link], d[~d.has_link]
    row = {'subset': label, 'n_link': len(L), 'n_nolink': len(N),
           'repos': d.repo_id.nunique()}
    if len(L) < 10 or len(N) < 10:
        row['note'] = 'too few'
        return row
    for nm, g in [('link', L), ('nolink', N)]:
        k = int(g.merged.sum()); n = len(g)
        lo, hi = wilson(k, n)
        row[f'merge_{nm}'] = f'{k/n:.3f} [{lo:.3f},{hi:.3f}]'
        row[f'medTTM_h_{nm}'] = round(g[g.merged].ttm_h.median(), 2)
        row[f'medTTC_unmerged_h_{nm}'] = round(g[~g.merged].ttc_h.median(), 2)
    dd = merge_diff(d)
    lo, hi = cluster_boot(d, merge_diff)
    row['merge_diff_pp'] = f'{100*dd:+.1f} [{100*lo:+.1f},{100*hi:+.1f}]'
    dm = d[d.merged]
    if dm.has_link.sum() >= 5 and (~dm.has_link).sum() >= 5:
        md = med_diff('ttm_h')(dm)
        lo, hi = cluster_boot(dm, med_diff('ttm_h'))
        row['medTTM_diff_h'] = f'{md:+.2f} [{lo:+.2f},{hi:+.2f}]'
    du = d[~d.merged]
    if du.has_link.sum() >= 5 and (~du.has_link).sum() >= 5:
        md = med_diff('ttc_h')(du)
        lo, hi = cluster_boot(du, med_diff('ttc_h'))
        row['medTTC_unmerged_diff_h'] = f'{md:+.2f} [{lo:+.2f},{hi:+.2f}]'
    return row

# ---------------------------------------------------------------- comparisons
closed = pr[pr.is_closed].reset_index(drop=True)
TOP_USERS = closed.user.value_counts().head(2).index.tolist()  # bulk single-user repos
# Windows where the agent's PR template already inserted the link (avoid template-era confound)
WINDOW = {'OpenAI_Codex': '2025-06', 'Cursor': '2025-07', 'Devin': '2024-12', 'Google_Jules': '2025-09'}

rows = []
rows.append(compare(closed, 'ALL agents, all closed PRs (confounded by agent)'))
for ag, start in WINDOW.items():
    g = closed[closed.agent == ag]
    rows.append(compare(g, f'{ag}: all months'))
    gw = g[g.month >= start]
    rows.append(compare(gw, f'{ag}: months >= {start} (link template era)'))
    rows.append(compare(gw[gw.human_review], f'{ag}: >= {start}, with non-author human review'))
    rows.append(compare(gw[~gw.author_is_owner], f'{ag}: >= {start}, author != repo owner'))
    rows.append(compare(gw[~gw.user.isin(TOP_USERS)], f'{ag}: >= {start}, excl. top-2 bulk users'))
res = pd.DataFrame(rows)
res.to_csv(OUT + 'comparisons.csv', index=False)

# ---------------------------------------------------------------- regressions
reg_rows = []
an = closed[closed.agent.isin(WINDOW)].copy()
an = an[an.apply(lambda r: r.month >= WINDOW[r.agent], axis=1)].copy()
an['link'] = an.has_link.astype(int)
an['y'] = an.merged.astype(int)
an['hrev'] = an.human_review.astype(int)
an['own'] = an.author_is_owner.astype(int)


def fit_logit(df, formula, label):
    try:
        m = smf.logit(formula, df).fit(disp=0, cov_type='cluster', cov_kwds={'groups': pd.factorize(df.repo_id)[0]}, maxiter=200)
        b = m.params['link']; lo, hi = m.conf_int().loc['link']
        reg_rows.append({'model': label, 'N': int(m.nobs), 'OR_link': round(np.exp(b), 3),
                         'CI95': f'[{np.exp(lo):.3f},{np.exp(hi):.3f}]', 'p': round(m.pvalues['link'], 4)})
    except Exception as e:
        reg_rows.append({'model': label, 'error': repr(e)[:120]})


base = 'y ~ link + C(agent) + C(month) + log_stars + log_body + own'
fit_logit(an, base, 'Logit pooled 4 agents (template eras), agent+month FE, stars, body len, owner; repo-clustered SE')
fit_logit(an, base + ' + hrev', '  + human-review indicator')
fit_logit(an[an.human_review], base, '  restricted to PRs with non-author human review')
for ag in WINDOW:
    sub = an[an.agent == ag]
    f = 'y ~ link + C(month) + log_stars + log_body + own'
    if ag in ('Devin', 'Google_Jules'):
        f = 'y ~ link + C(month) + log_stars + log_body'  # author is a bot account
    fit_logit(sub, f, f'Logit {ag} only')

# Linear probability model with repo x agent fixed effects (within-repo comparison)
def lpm_fe(df, label):
    df = df.copy()
    df['g'] = df.repo_id.astype(str) + '_' + df.agent
    # keep groups with variation in link
    v = df.groupby('g').link.agg(['min', 'max'])
    keep = v[v['min'] != v['max']].index
    df = df[df.g.isin(keep)]
    if len(df) < 50:
        reg_rows.append({'model': label, 'N': len(df), 'error': 'too few'}); return
    cols = ['y', 'link', 'log_body']
    for c in cols:
        df[c + '_dm'] = df[c] - df.groupby('g')[c].transform('mean')
    mon = pd.get_dummies(df.month, prefix='m', drop_first=True).astype(float)
    mon = mon - mon.groupby(df.g).transform('mean')
    X = pd.concat([df[['link_dm', 'log_body_dm']], mon], axis=1)
    import statsmodels.api as sm
    m = sm.OLS(df.y_dm, X).fit(cov_type='cluster', cov_kwds={'groups': pd.factorize(df.repo_id)[0]})
    b = m.params['link_dm']; lo, hi = m.conf_int().loc['link_dm']
    reg_rows.append({'model': label, 'N': len(df), 'repo_groups': df.g.nunique(),
                     'LPM_link_pp': f'{100*b:+.1f}', 'CI95': f'[{100*lo:+.1f},{100*hi:+.1f}]', 'p': round(m.pvalues['link_dm'], 4)})


lpm_fe(an, 'LPM repo x agent FE (+month, body len), pooled 4 agents, repos with both kinds')
for ag in WINDOW:
    lpm_fe(an[an.agent == ag], f'LPM repo FE, {ag}')
lpm_fe(an[an.human_review], 'LPM repo x agent FE, only human-reviewed PRs')

# time-to-merge regression (log hours) among merged
def ols_ttm(df, label):
    d = df[df.merged & (df.ttm_h > 0)].copy()
    d['lt'] = np.log(d.ttm_h)
    m = smf.ols('lt ~ link + C(agent) + C(month) + log_stars + log_body + own + hrev', d).fit(
        cov_type='cluster', cov_kwds={'groups': pd.factorize(d.repo_id)[0]})
    b = m.params['link']; lo, hi = m.conf_int().loc['link']
    reg_rows.append({'model': label, 'N': int(m.nobs), 'TTM_ratio_link': round(np.exp(b), 3),
                     'CI95': f'[{np.exp(lo):.3f},{np.exp(hi):.3f}]', 'p': round(m.pvalues['link'], 4)})


ols_ttm(an, 'OLS log(time-to-merge), merged PRs, same controls + human review')
ols_ttm(an[an.human_review], 'OLS log(time-to-merge), merged + human-reviewed only')
pd.DataFrame(reg_rows).to_csv(OUT + 'regressions.csv', index=False)

# ---------------------------------------------------------------- descriptives
desc = closed.groupby('agent').agg(N_closed=('id', 'size'), merge_rate=('merged', 'mean'),
                                   link_share=('has_link', 'mean'), human_review_share=('human_review', 'mean'),
                                   author_is_owner_share=('author_is_owner', 'mean'), repos=('repo_id', 'nunique'))
desc.to_csv(OUT + 'descriptives.csv')
meta = {'N_pr': len(pr), 'N_closed': len(closed), 'N_open': int((~pr.is_closed).sum()),
        'created_min': pr.created_at.min(), 'created_max': pr.created_at.max(),
        'top_users': TOP_USERS, 'top_user_counts': closed.user.value_counts().head(2).to_dict(),
        'N_reviews': len(rev), 'N_human_reviewed_PRs': int(pr.human_review.sum()),
        'analysis_sample_N': len(an)}
json.dump(meta, open(OUT + 'meta.json', 'w'), indent=1, default=str)
pd.set_option('display.width', 250); pd.set_option('display.max_columns', 30); pd.set_option('display.max_colwidth', 80)
print(json.dumps(meta, indent=1, default=str))
print(link_counts.to_string())
print(desc.to_string())
print(res.to_string())
print(pd.DataFrame(reg_rows).to_string())
