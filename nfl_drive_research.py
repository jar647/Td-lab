#!/usr/bin/env python3
"""NFL drive-level challenger. Historical research only; never reads odds.
Scores are offensive TD (7 assumed), FG (3), or zero. No defensive/ST scores,
PAT variation, clock transitions or overtime model. Draw paired regulation-like
drive counts from completed prior games; no target-week plays enter the fit.
"""
import json
import numpy as np
import pandas as pd
from nfl_multifactor_calibration import load_schedules, load_plays
from game_picks import team_rates, score_projection

VERSION = 'nfl-drive-research-v1'
OUTCOMES = ('td', 'fg', 'zero')

def drives(plays, completed_ids):
    required = {'game_id','week','posteam','defteam','fixed_drive','fixed_drive_result','play_type'}
    if not required <= set(plays.columns):
        raise ValueError('Missing drive evidence: '+str(sorted(required-set(plays.columns))))
    p = plays[plays.game_id.astype(str).isin(completed_ids)].copy()
    if 'season_type' in p:
        p = p[p.season_type == 'REG']
    if 'qtr' in p:
        p = p[p.qtr.between(1,4)]
    # Count only drives with observed scrimmage or field-goal plays; exclude
    # kickoff-only possessions, and reject ambiguous team/result records.
    out = []
    for (gid, drive), group in p.dropna(subset=['fixed_drive']).groupby(['game_id','fixed_drive'], sort=False):
        g = group[group.play_type.isin(['pass','run','field_goal','punt'])]
        if g.empty:
            continue
        off, defense = g.posteam.dropna().unique(), g.defteam.dropna().unique()
        results = {str(x).strip().lower() for x in group.fixed_drive_result.dropna()}
        if len(off)!=1 or len(defense)!=1 or len(results)!=1 or off[0]==defense[0]:
            continue
        result = next(iter(results))
        if result in ('touchdown','offensive touchdown'):
            kind='td'
        elif result in ('field goal','made field goal'):
            kind='fg'
        elif result in ('punt','turnover','downs','turnover on downs','interception','fumble',
                        'missed field goal','blocked field goal','blocked punt','end of half',
                        'end of game','safety','defensive touchdown','end of regulation'):
            kind='zero'
        else:
            continue
        out.append((str(gid),int(g.week.iloc[0]),str(off[0]),str(defense[0]),kind))
    return pd.DataFrame(out,columns=['game_id','week','off','def','outcome'])

def fit(prior, penalty=30):
    if prior.empty:
        raise ValueError('No prior drives')
    teams=sorted(set(prior.off)|set(prior['def']))
    index={t:i for i,t in enumerate(teams)}
    n=len(teams)
    grouped=prior.groupby(['off','def','outcome']).size().unstack(fill_value=0).reindex(columns=OUTCOMES,fill_value=0)
    x=np.zeros((len(grouped),1+2*n)); x[:,0]=1
    for i,(off,defense) in enumerate(grouped.index):
        x[i,1+index[off]]=1; x[i,1+n+index[defense]]=1
    counts=grouped.to_numpy(dtype=float); w=counts.sum(axis=1)
    reg=np.diag([1e-6]+[penalty]*(2*n))
    beta=np.linalg.solve(x.T@(w[:,None]*x)+reg,x.T@counts)
    return index,beta

def rates(model,off,defense):
    index,beta=model
    n=len(index)
    if off not in index or defense not in index:
        raise ValueError('Unknown team')
    p=np.maximum(.001,beta[0]+beta[1+index[off]]+beta[1+n+index[defense]])
    return p/p.sum()

def simulate(prior,history,home,away,draws=10000,seed=6472026,model=None,return_margins=False):
    if not isinstance(draws,int) or draws<1:
        raise ValueError('Invalid draw count')
    model=fit(prior) if model is None else model
    # Match each historical game to both teams' observed drive counts, preserving
    # shared tempo. No invented drive counts from target games.
    counts=prior.groupby(['game_id','off']).size().unstack(fill_value=0)
    paired=[]
    for g in history.itertuples():
        if str(g.game_id) in counts.index and g.home_team in counts and g.away_team in counts:
            pair=counts.loc[str(g.game_id),[g.home_team,g.away_team]].to_numpy(dtype=int)
            if min(pair)>=5 and max(pair)<=25:
                paired.append(pair)
    if len(paired)<20:
        raise ValueError('Insufficient paired historical drive counts')
    rng=np.random.default_rng(seed); volume=np.asarray(paired)[rng.integers(len(paired),size=draws)]
    ph,pa=rates(model,home,away),rates(model,away,home)
    def score(n,p):
        # First draw TDs, then FGs conditional on no TD: multinomial equivalent.
        td=rng.binomial(n,p[0]); fg=rng.binomial(n-td,p[1]/(1-p[0]))
        return td*7+fg*3
    h,a=score(volume[:,0],ph),score(volume[:,1],pa)
    return {'home':float(h.mean()),'away':float(a.mean()),'home_win':float(np.mean(h>a)),
            'tie':float(np.mean(h==a)),'drive_games':len(paired),'home_rates':ph.tolist(),'away_rates':pa.tolist(),**({'margins':h-a} if return_margins else {})}

def main():
    rows=[]; skipped=[]
    for season in (2024,2025,2026):
        sch=load_schedules(season)
        sch=sch[(sch.season==season)&(sch.game_type=='REG')&sch.home_score.notna()&sch.away_score.notna()]
        plays=load_plays(season)
        d=drives(plays,set(sch.game_id.astype(str)))
        for week in sorted(sch.week.unique()):
            if week<5: continue
            history=sch[sch.week<week]; prior=d[d.week<week]
            for g in sch[sch.week==week].itertuples():
                try:
                    result=simulate(prior,history,g.home_team,g.away_team)
                except ValueError as error:
                    skipped.append({'game':str(g.game_id),'reason':str(error)});continue
                bh,ba=score_projection(team_rates(history,g.home_team),team_rates(history,g.away_team))
                h,a=g.home_score,g.away_score
                rows.append({'season':season,'game':str(g.game_id),
                    'margin_error':abs(result['home']-result['away']-(h-a)),
                    'total_error':abs(result['home']+result['away']-(h+a)),
                    'baseline_margin_error':abs(bh-ba-(h-a)),
                    'baseline_total_error':abs(bh+ba-(h+a))})
    def summary(rs):
        return {'games':len(rs),**{k:float(np.mean([r[k] for r in rs])) for k in
            ('margin_error','total_error','baseline_margin_error','baseline_total_error')}} if rs else {'games':0}
    if not any(r['season']==2026 for r in rows):
        raise ValueError('No held-out drive predictions; inspect source drive classifications')
    print(json.dumps({'model':VERSION,'status':'RESEARCH_ONLY','development':summary([r for r in rows if r['season']<2026]),
        'holdout':summary([r for r in rows if r['season']==2026]),'skipped':skipped,
        'limitations':'Fixed 7/3/0 offensive points, historical paired drives, no game clock, field position, defensive/ST scoring or live injury effects. Not a live model.'},indent=2))

if __name__=='__main__':main()
