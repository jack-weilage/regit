import sys, time
sys.path.insert(0, '/tmp/claude-0/-home-user-regit/478c86f8-c32f-5134-80d4-cc7972999be8/scratchpad/research/sim')
from landing_sim import simulate
def show(tag, **kw):
    t=time.time(); r=simulate(**kw)
    print(f"{tag:40s} thr={r['throughput_h']:8.2f}/h p50={r['lat_p50']:7.1f} p95={r['lat_p95']:7.1f} ci/land={r['ci_min_per_land']:7.1f} red={r['red_frac']:.3f} unst={r['unstable']} rej={r['rej']} ({time.time()-t:.1f}s)")
base=dict(T=15,p=0.1,flake=0,s_repo=0,saturate=True,sim_hours=60,warm_hours=5)
show("serial sat (exp 3.6)", **base, N=1)
for N in (4,16,64,256):
    show(f"spec N={N} sat (exp {0.9*(1-0.9**N)/0.1*4:.1f})", **base, N=N)
for B in (4,8,16):
    show(f"batch B={B} sat", **base, B=B)
show("race sat n=50 (exp ~4)", **base, strategy='race', contenders=50)
