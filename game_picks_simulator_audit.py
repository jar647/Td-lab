#!/usr/bin/env python3
"""Out-of-sample audit of the current Monte Carlo score-distribution assumptions.

2024 is used to estimate residual spread; 2025+ is untouched holdout.
The production simulator uses fixed 13.0 margin and 13.5 total standard
deviations; this audit evaluates those exact assumptions, without tuning them.
"""
import json, math
from pathlib import Path

ROOT=Path(__file__).resolve().parent
rows=json.loads((ROOT/'data/game_picks_backtest.json').read_text())['records']
market=json.loads((ROOT/'data/game_picks_market_comparison.json').read_text())['records']
markets={str(r['game_id']):r for r in market}

def cdf(x):
    return .5*(1+math.erf(x/math.sqrt(2)))
def assess(sub):
    probs=[]; outs=[]; total_probs=[]; total_outs=[]; ats_probs=[];ats_outs=[]
    for r in sub:
        margin=float(r['projected_margin']);actual=float(r['actual_margin'])
        # Ties are excluded from binary winner scoring.
        if actual!=0:
            probs.append(cdf(margin/13))
            outs.append(int(actual>0))
        m=markets.get(str(r['game_id']),{})
        line=m.get('market_total')
        if line is not None and float(r['actual_total'])!=float(line):
            total_probs.append(cdf((float(r['projected_total'])-float(line))/13.5))
            total_outs.append(int(float(r['actual_total'])>float(line)))
        home_spread=m.get('market_home_spread')
        if home_spread is not None and actual+float(home_spread)!=0:
            ats_probs.append(cdf((margin+float(home_spread))/13))
            ats_outs.append(int(actual+float(home_spread)>0))
    def score(p,y):
        if not p:return {'games':0,'brier':None,'accuracy':None,'bins':[]}
        bins=[]
        for lo in range(0,100,10):
            indexes=[i for i,v in enumerate(p) if lo/100<=v<(lo+10)/100 or (lo==90 and v==1)]
            if indexes:bins.append({'range':f'{lo}-{lo+10}%', 'n':len(indexes),'predicted':round(sum(p[i] for i in indexes)/len(indexes),3),'actual':round(sum(y[i] for i in indexes)/len(indexes),3)})
        return {'games':len(p),'brier':round(sum((v-z)**2 for v,z in zip(p,y))/len(p),4),'accuracy':round(sum((v>=.5)==bool(z) for v,z in zip(p,y))/len(p),4),'bins':bins}
    return {'home_win':score(probs,outs),'over_total':score(total_probs,total_outs),'home_cover':score(ats_probs,ats_outs)}

train=[r for r in rows if int(r['season'])==2024]
holdout=[r for r in rows if int(r['season'])>=2025]
if not train or not holdout:raise RuntimeError('Train/holdout historical games missing')
def sd(values):
    mean=sum(values)/len(values)
    return round(math.sqrt(sum((x-mean)**2 for x in values)/len(values)),2)
output={
 'status':'ASSUMPTION_AUDIT_NOT_CALIBRATED',
 'method':'2024 reference period; 2025-2026 out-of-sample audit. Normal-score CDF approximates simulator score uncertainty; exact rounded-score Monte Carlo tie rates are not replicated.',
 'production_assumptions':{'margin_sd':13,'total_sd':13.5},
 'reference_2024':{'games':len(train),'observed_margin_residual_sd':sd([float(r['actual_margin'])-float(r['projected_margin']) for r in train]),'observed_total_residual_sd':sd([float(r['actual_total'])-float(r['projected_total']) for r in train])},
 'holdout':{'games':len(holdout),**assess(holdout)},
 'limits':['Historical schedule lines may be closing-line proxies','Missing ATS home-spread signs are excluded','No historical sportsbook execution is implied','Normal CDF approximates, but is not identical to, rounded-score Monte Carlo','No parameter fitting was performed on the holdout']
}
# Evaluate a conservative market-anchored total forecast on untouched holdout.
# The market is the reference; blending is NOT proof of a betting advantage.
def total_test(sub,weight):
    brier=0.0;correct=0;n=0; mae=0.0
    for r in sub:
        m=markets.get(str(r['game_id']),{})
        line=m.get('market_total')
        if line is None:continue
        line=float(line);actual=float(r['actual_total'])
        if actual==line:continue
        projection=float(r['projected_total'])
        adjusted=weight*projection+(1-weight)*line
        p=cdf((adjusted-line)/13.5)
        y=int(actual>line)
        brier+=(p-y)**2
        correct+=(p>=.5)==bool(y)
        mae+=abs(adjusted-actual)
        n+=1
    return {'games':n,'brier':round(brier/n,4) if n else None,
            'direction_accuracy':round(correct/n,4) if n else None,
            'total_mae':round(mae/n,3) if n else None}
output['total_market_comparison']={
 'market_only':total_test(holdout,0),
 'model_only':total_test(holdout,1),
 'market_anchored_25pct_model':total_test(holdout,.25),
 'note':'The market-only over probability is 50% at the line, not a profitable selection rule. Compare Brier and MAE; directional accuracy alone is not sufficient.'
}
# The app should not recommend totals until a held-out improvement is demonstrated.
a=output['total_market_comparison']
output['total_recommendation_enabled']=bool(
 a['market_anchored_25pct_model']['brier']<a['market_only']['brier'] and
 a['market_anchored_25pct_model']['total_mae']<a['market_only']['total_mae']
)
path=ROOT/'data/game_picks_simulator_audit.json'
path.write_text(json.dumps(output,indent=2)+'\n')
print(json.dumps({k:v for k,v in output.items() if k!='holdout'},indent=2))
