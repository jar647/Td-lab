#!/usr/bin/env python3
"""Freeze exact PR166 NFL margin candidates; no market inputs.
Prior weeks only. Research draws are 10,000; live UI remains 100,000.
"""
import json
from datetime import datetime, timezone
import numpy as np
import pandas as pd
from nfl_drive_research import drives, fit as drive_fit, simulate
from nfl_multifactor_calibration import load_schedules, load_plays
from nfl_score_model import fit as rating_fit, predict

THRESHOLDS=(-14.5,-7.5,-3.5,.5,3.5,7.5,14.5)
VERSION='nfl-drive-strength-prospective-v1'
def timestamp(value):
    return datetime.fromisoformat(value.replace('Z','+00:00'))

def distribution(m):
    return {'margin':float(np.mean(m)),
            'probabilities':[float(np.mean(m>t)) for t in THRESHOLDS],
            'interval80':[float(x) for x in np.quantile(m,[.1,.9])]}

def capture(slate, results, now):
    records=[]; failures=[]
    season=int(slate['season']); week=int(slate['week'])
    fresh=timestamp(slate['generated_at'])
    if not 0<=(now-fresh).total_seconds()<=86400:
        return {'forecasts':[],'finals':{},'failures':['Stale verified NFL slate']}
    schedules=pd.concat([load_schedules(y) for y in (season-1,season)],ignore_index=True).drop_duplicates('game_id')
    complete=schedules[(schedules.game_type=='REG')&schedules.home_score.notna()&schedules.away_score.notna()]
    finals={str(g.game_id):{'home':g.home_team,'away':g.away_team,'home_points':float(g.home_score),'away_points':float(g.away_score)}
            for g in complete.itertuples() if str(g.game_id) in results.get('games',{})}
    if week<5:
        return {'forecasts':[],'finals':finals,'failures':['Fewer than four prior weeks']}
    history=complete[(complete.season==season)&(complete.week<week)]
    d=drives(load_plays(season),set(history.game_id.astype(str)))
    d=d[d.week<week]
    drive=drive_fit(d); rating=rating_fit(complete,season,week)
    for g in slate.get('games',[]):
        gid=str(g['game_id'])
        try:
            kickoff=timestamp(g['kickoff_at'])
            if not 0<(kickoff-now).total_seconds()<=48*3600:continue
            if g.get('model_inputs',{}).get('trust',{}).get('source_status')!='RECONCILED':raise ValueError('Unreconciled slate')
            match=schedules[schedules.game_id.astype(str)==gid]
            if len(match)!=1:raise ValueError('Missing schedule identity')
            match=match.iloc[0]
            if (match.home_team,match.away_team)!=(g['home'],g['away']) or pd.notna(match.home_score) or pd.notna(match.away_score):
                raise ValueError('Schedule identity or pregame status mismatch')
            raw=simulate(d,history,g['home'],g['away'],model=drive,return_margins=True)['margins']
            h,a=predict(rating,g['home'],g['away'],neutral=str(match.get('location','')).lower()=='neutral')
            challenger=raw+.5*(h-a-raw.mean())
            captured=datetime.now(timezone.utc)
            if captured>=kickoff:raise ValueError('Kickoff crossed during calculation')
            records.append({'sport':'NFL','game_id':gid,'version':VERSION,'home':g['home'],'away':g['away'],
                'start':g['kickoff_at'],'captured_at':captured.isoformat(),'draws':len(raw),
                'source_at':slate['generated_at'],'baseline':distribution(raw),'candidate':distribution(challenger)})
        except (ValueError,KeyError,TypeError) as e:failures.append({'game_id':gid,'reason':str(e)})
    return {'forecasts':records,'finals':finals,'failures':failures}

if __name__=='__main__':
    with open('data/game_picks.json') as f:slate=json.load(f)
    with open('data/game_score_results.json') as f:results=json.load(f)
    print(json.dumps(capture(slate,results,datetime.now(timezone.utc)),allow_nan=False))
