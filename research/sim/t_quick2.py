import sys, time
sys.path.insert(0, '/tmp/claude-0/-home-user-regit/478c86f8-c32f-5134-80d4-cc7972999be8/scratchpad/research/sim')
from landing_sim import simulate
def show(tag, **kw):
    t=time.time(); r=simulate(**kw)
    print(f"{tag:34s} thr={r['throughput_h']:8.1f}/h (off {r['offered_h']:.1f}) p50={r['lat_p50']:6.1f} p95={r['lat_p95']:6.1f} ci/land={r['ci_min_per_land']:6.1f} red={r['red_frac']:.3f}/{r['red_share']:.3f} ttd={r['ttd_mean']:.0f} unst={r['unstable']} rej={r['rej']} ({time.time()-t:.1f}s)")
b=dict(T=15,p=0.1,flake=0.01,s_repo=1e-4)
show("serial 50/d", **b, lam_day=50, sim_hours=24*30, warm_hours=48)
show("race 50/d", **b, strategy='race', lam_day=50, sim_hours=24*30, warm_hours=48)
show("spec N=32 500/d", **b, N=32, lam_day=500, sim_hours=72, warm_hours=12)
show("spec N=32 5000/d", **b, N=32, lam_day=5000, sim_hours=12, warm_hours=3)
show("part K=100 tia N=8 5000/d", **b, K=100, partitioned=True, tia=True, N=8, x_cross=0.05, lam_day=5000, sim_hours=12, warm_hours=3)
show("part K=100 tia N=8 50k/d leak.01", **b, K=100, partitioned=True, tia=True, N=8, x_cross=0.05, leak=0.01, lam_day=50000, sim_hours=8, warm_hours=2)
show("part K=1000 tia N=8 500k/d", **b, K=1000, partitioned=True, tia=True, N=8, x_cross=0.05, lam_day=500000, sim_hours=4, warm_hours=1)
show("pushrebase K=1 5000/d", **b, strategy='pushrebase', lam_day=5000, sim_hours=12, warm_hours=3)
show("pushrebase K=1 50/d", **b, strategy='pushrebase', lam_day=50, sim_hours=24*30, warm_hours=48)
show("pushrebase nopre K=1 50/d", **b, strategy='pushrebase', presubmit=False, lam_day=50, sim_hours=24*30, warm_hours=48)
