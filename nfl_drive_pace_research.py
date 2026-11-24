#!/usr/bin/env python3
"""Second NFL drive challenger: matchup pace and observed unmodeled points.
No odds. No target scores in training. The previously evaluated 2026 games
are a reused diagnostic set, not a fresh untouched validation set.
"""
import json
import numpy as np
from nfl_drive_research import drives, fit, rates, simulate
from nfl_multifactor_calibration import load_schedules, load_plays
from game_picks import team_rates, score_projection

def prepare(prior, history):
    counts=prior.groupby(['game_id','off']).size().unstack(fill_value=0)
    recorded=prior.assign(points=prior.outcome.map({'td':7,'fg':3,'zero':0})).groupby(['game_id','off']).points.sum().unstack(fill_value=0)
    rows=[]
    for g in history.itertuples():
        gid=str(g.game_id); h,a=g.home_team,g.away_team
        if gid not in counts.index or h not in counts or a not in counts:
            continue
        hn,an=int(counts.loc[gid,h]),int(counts.loc[gid,a])
        if not 5<=min(hn,an) or max(hn,an)>25:
            continue
        rows.append((h,a,hn,an,float(g.home_score-recorded.loc[gid,h]),float(g.away_score-recorded.loc[gid,a])))
    if len(rows)<20:
        raise ValueError('Insufficient reconciled historical drive games')
    return rows

def simulate_v2(prior, history, home, away, draws=10000, seed=6472026, model=None, prepared=None):
    rows=prepare(prior,history) if prepared is None else prepared
    model=fit(prior) if model is None else model
    rng=np.random.default_rng(seed)
    volume=np.asarray([(r[2],r[3]) for r in rows])
    extras=np.asarray([(r[4],r[5]) for r in rows])
    league=float(volume.mean())
    def team_pace(t):
        vals=[(hn+an)/2 for h,a,hn,an,_,_ in rows if t in (h,a)]
        return (sum(vals)+6*league)/(len(vals)+6)
    target=(team_pace(home)+team_pace(away))/2
    # Favor previously observed paired game tempos near this matchup.
    weights=np.exp(-.5*((volume.mean(axis=1)-target)/2.5)**2)
    chosen=rng.choice(len(rows),size=draws,p=weights/weights.sum())
    n=volume[chosen]; residual=extras[chosen]
    def points(count, p):
        td=rng.binomial(count,p[0])
        fg=rng.binomial(count-td,p[1]/(1-p[0]))
        return 7*td+3*fg
    # Reuse signed empirical residuals for points not represented by 7/3/0:
    # variable PATs, special teams/defense, OT and source classification gaps.
    # This is an aggregate proxy, not a simulated special-teams event.
    h=np.maximum(0,points(n[:,0],rates(model,home,away))+residual[:,0])
    a=np.maximum(0,points(n[:,1],rates(model,away,home))+residual[:,1])
    return {'home':float(h.mean()),'away':float(a.mean()),'target_drives':target,
            'mean_unmodeled_points':extras.mean(axis=0).tolist(),'margins':h-a}

# Fixed synthetic thresholds, not sportsbook prices or historical lines.
THRESHOLDS = (-14.5,-7.5,-3.5,0.5,3.5,7.5,14.5)
def spread_metrics(margins, actual):
    margins=np.asarray(margins,dtype=float)
    probs=np.asarray([(margins>t).mean() for t in THRESHOLDS])
    realized=np.asarray([actual>t for t in THRESHOLDS])
    return {'spread_brier':float(np.mean((probs-realized)**2)),
            'margin_bias':float(margins.mean()-actual),
            'interval80_covered':float(np.quantile(margins,.1)<=actual<=np.quantile(margins,.9))}

def main():
    rows=[]; skipped=[]
    for season in (2024,2025,2026):
        s=load_schedules(season)
        s=s[(s.season==season)&(s.game_type=='REG')&s.home_score.notna()&s.away_score.notna()]
        d=drives(load_plays(season),set(s.game_id.astype(str)))
        for week in sorted(s.week.unique()):
            if week<5:continue
            prior=d[d.week<week]; history=s[s.week<week]
            model=fit(prior); prepared=prepare(prior,history)
            for g in s[s.week==week].itertuples():
                try:
                    old=simulate(prior,history,g.home_team,g.away_team,model=model,return_margins=True)
                    new=simulate_v2(prior,history,g.home_team,g.away_team,model=model,prepared=prepared)
                    bh,ba=score_projection(team_rates(history,g.home_team),team_rates(history,g.away_team))
                    def errors(h,a):
                        return [abs(h-a-g.home_score+g.away_score),abs(h+a-g.home_score-g.away_score)]
                    rows.append({'season':season,'baseline':errors(bh,ba),'drive_v1':errors(old['home'],old['away']),
                                 'drive_v2':errors(new['home'],new['away']),
                                 'spread_v1':spread_metrics(old['margins'],g.home_score-g.away_score),
                                 'spread_v2':spread_metrics(new['margins'],g.home_score-g.away_score)})
                except ValueError as e:skipped.append({'game':str(g.game_id),'reason':str(e)})
    def summary(rs):
        if not rs:raise ValueError('Empty historical split')
        return {'games':len(rs),**{k:dict(zip(('margin_mae','total_mae'),np.mean([r[k] for r in rs],axis=0).tolist()))
                                    for k in ('baseline','drive_v1','drive_v2')},
                **{k:{metric:float(np.mean([r[k][metric] for r in rs])) for metric in rs[0][k]} for k in ('spread_v1','spread_v2')}}
    development=summary([r for r in rows if r['season']<2026])
    selected=min(('drive_v1','drive_v2'),key=lambda k:development[k]['margin_mae'])
    print(json.dumps({'status':'RESEARCH_ONLY','model':'drive-pace-residual-v2',
        'selection_objective':'minimum development margin MAE; synthetic-threshold Brier and interval coverage reported separately',
        'development_selected':selected,'synthetic_margin_thresholds':THRESHOLDS,
        'development':summary([r for r in rows if r['season']<2026]),
        'reused_2026_diagnostic':summary([r for r in rows if r['season']==2026]),'skipped':skipped,
        'limits':'Paired prior drive counts and empirical residuals; no event-specific ST/defensive scoring, game clock, field position, or live QB/injury effects. 2026 set reused from previous experiments; no promotion.'},indent=2))
if __name__=='__main__':main()
