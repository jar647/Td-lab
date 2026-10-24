#!/usr/bin/env python3
"""Walk-forward EPA/success-rate challenger, evaluated against existing score baseline.

Research only: no picks, odds, or confidence percentages. Every target game uses
only earlier regular-season weeks, and EPA is computed from historical plays.
"""
import json
from pathlib import Path
import pandas as pd
import nflreadpy
from game_picks import frame, team_rates, score_projection

ROOT=Path(__file__).resolve().parent

def make_team_week(pbp):
    required={'season','week','posteam','defteam','epa','play_type'}
    missing=required-set(pbp.columns)
    if missing:raise ValueError('PBP columns missing: '+str(sorted(missing)))
    p=pbp.copy()
    if 'season_type' in p:p=p[p.season_type.astype(str)=='REG']
    if 'no_play' in p:p=p[pd.to_numeric(p.no_play,errors='coerce').fillna(0)==0]
    p=p[p.play_type.isin(['run','pass'])].copy()
    p['epa']=pd.to_numeric(p.epa,errors='coerce')
    p=p[p.epa.notna()&p.posteam.notna()&p.defteam.notna()]
    p['success']=(p.epa>0).astype(float)
    off=p.groupby(['season','week','posteam'],as_index=False).agg(off_epa=('epa','mean'),off_success=('success','mean'),off_plays=('epa','size')).rename(columns={'posteam':'team'})
    defense=p.groupby(['season','week','defteam'],as_index=False).agg(def_epa_allowed=('epa','mean'),def_success_allowed=('success','mean'),def_plays=('epa','size')).rename(columns={'defteam':'team'})
    return off.merge(defense,on=['season','week','team'],how='outer')

def prior_rates(weekly,season,week,team):
    w=weekly[(weekly.season==season)&(weekly.week<week)&(weekly.team==team)]
    if w.empty:return None
    # Prior season-to-date EPA and success; do not leak target week.
    out={}
    for key,weight in [('off_epa','off_plays'),('def_epa_allowed','def_plays'),('off_success','off_plays'),('def_success_allowed','def_plays')]:
        valid=w[[key,weight]].dropna()
        if valid.empty:return None
        total=valid[weight].sum()
        if total<=0:return None
        out[key]=float((valid[key]*valid[weight]).sum()/total)
    return out

def challenger_score(hp,ap,home,away,epa_weight=5.0,success_weight=12.0):
    # Adjust both teams' points symmetrically, keeping mean total stable
    # only when both team strengths balance. Coefficients are hypotheses,
    # not fitted against held-out data.
    hdelta=epa_weight*(home['off_epa']-away['def_epa_allowed'])+success_weight*(home['off_success']-away['def_success_allowed'])
    adelta=epa_weight*(away['off_epa']-home['def_epa_allowed'])+success_weight*(away['off_success']-home['def_success_allowed'])
    return round(max(0,hp+hdelta),1),round(max(0,ap+adelta),1)

def metrics(rows,prefix):
    if not rows:return None
    n=len(rows)
    non_ties=[r for r in rows if r['actual_margin']!=0]
    return {'games':n,
      'margin_mae':round(sum(abs(r[prefix+'_margin']-r['actual_margin']) for r in rows)/n,2),
      'total_mae':round(sum(abs(r[prefix+'_total']-r['actual_total']) for r in rows)/n,2),
      'winner_accuracy':round(sum((r[prefix+'_margin']>0)==(r['actual_margin']>0) for r in non_ties)/len(non_ties),4) if non_ties else None}

def main():
    rows=[]
    for season in (2024,2025,2026):
        sch=frame(nflreadpy.load_schedules([season]))
        pbp=frame(nflreadpy.load_pbp([season]))
        weekly=make_team_week(pbp)
        reg=sch[(pd.to_numeric(sch.season,errors='coerce')==season)&(sch.game_type.astype(str).str.upper()=='REG')].copy()
        reg['week_num']=pd.to_numeric(reg.week,errors='coerce')
        for _,game in reg.iterrows():
            week=int(game.week_num)
            if week<5 or pd.isna(game.home_score) or pd.isna(game.away_score):continue
            history=reg[(reg.week_num<week)&reg.home_score.notna()&reg.away_score.notna()]
            home,away=str(game.home_team),str(game.away_team)
            h=prior_rates(weekly,season,week,home)
            a=prior_rates(weekly,season,week,away)
            if h is None or a is None:continue
            bh,ba=score_projection(team_rates(history,home),team_rates(history,away))
            ch,ca=challenger_score(bh,ba,h,a)
            actual_h,actual_a=float(game.home_score),float(game.away_score)
            rows.append({'season':season,'week':week,'game_id':str(game.game_id),
                'actual_margin':actual_h-actual_a,'actual_total':actual_h+actual_a,
                'baseline_margin':round(bh-ba,1),'baseline_total':round(bh+ba,1),
                'challenger_margin':round(ch-ca,1),'challenger_total':round(ch+ca,1)})
    if not rows:raise RuntimeError('No matched historical games to compare')
    out={'status':'RESEARCH_ONLY','challenger':'EPA and success rate; coefficients are hypotheses, not calibrated',
        'method':'Matched walk-forward games, weeks 5+, season-to-date prior weeks only; excludes unplayed games. No sportsbook prices or ROI.',
        'overall':{'baseline':metrics(rows,'baseline'),'challenger':metrics(rows,'challenger')},
        'by_season':{str(s):{'baseline':metrics([r for r in rows if r['season']==s],'baseline'),
                              'challenger':metrics([r for r in rows if r['season']==s],'challenger')} for s in (2024,2025,2026)},
        'records':rows}
    (ROOT/'data/game_picks_epa_comparison.json').write_text(json.dumps(out,indent=2))
    print(json.dumps({'overall':out['overall'],'by_season':out['by_season']},indent=2))
if __name__=='__main__':main()
