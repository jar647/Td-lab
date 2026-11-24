#!/usr/bin/env python3
"""Replay the actual browser NFL matchup score-center adjustments, without odds.

This is a score-center experiment, not a replay of live injury reports, yardage
distributions or calibrated win probabilities. Select a scale on 2024–25 only;
evaluate it once on completed 2026 games. Never modify live model weights.
"""
import json
import subprocess
import sys
from pathlib import Path

import nflreadpy
import pandas as pd
from game_picks import frame, team_rates, score_projection
from nfl_matchup_research import build_matchup_research

ROOT = Path(__file__).resolve().parent
SCALES = (0.0, 0.5, 1.0, 1.5)

def load_schedules(season):
    try:
        return frame(nflreadpy.load_schedules([season]))
    except (ConnectionError, OSError) as error:
        print(f'Schedule parquet unavailable: {error}; trying upstream CSV', file=sys.stderr)
        return pd.read_csv('https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv', low_memory=False)

def load_plays(season):
    try:
        return frame(nflreadpy.load_pbp([season]))
    except (ConnectionError, OSError) as error:
        print(f'PBP parquet unavailable: {error}; trying upstream CSV', file=sys.stderr)
        return pd.read_csv(f'https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{season}.csv.gz', low_memory=False)

def candidates():
    records = []
    for season in (2024, 2025, 2026):
        schedules = load_schedules(season)
        schedules = schedules[(schedules.season == season) &
            (schedules.game_type == 'REG') & schedules.home_score.notna() &
            schedules.away_score.notna()].copy()
        plays = load_plays(season)
        for week in sorted(schedules.week.unique()):
            week = int(week)
            if week < 5:
                continue
            history = schedules[schedules.week < week]
            ids = set(history.game_id.astype(str))
            earlier = plays[(plays.week < week) & plays.game_id.astype(str).isin(ids)].to_dict('records')
            for game in schedules[schedules.week == week].itertuples():
                home, away = str(game.home_team), str(game.away_team)
                h, a = score_projection(team_rates(history, home), team_rates(history, away))
                evidence = build_matchup_research({}, earlier, {}, {}, home, away, season, week)
                records.append(dict(season=season, week=week, game_id=str(game.game_id),
                    home=home, away=away, baseline_home=h, baseline_away=a,
                    actual_home=float(game.home_score), actual_away=float(game.away_score),
                    evidence=evidence))
    return records

def metrics(rows, scale):
    if not rows:
        return None
    margin, total = [], []
    for r in rows:
        h = max(0, r['baseline_home'] + scale*r['home_shift'])
        a = max(0, r['baseline_away'] + scale*r['away_shift'])
        margin.append(abs(h-a-r['actual_home']+r['actual_away']))
        total.append(abs(h+a-r['actual_home']-r['actual_away']))
    return dict(games=len(rows), margin_mae=sum(margin)/len(rows),
                total_mae=sum(total)/len(rows))

def evaluate(rows):
    development = [r for r in rows if r['season'] in (2024, 2025)]
    holdout = [r for r in rows if r['season'] == 2026]
    if not development or not holdout:
        raise ValueError('Both development and held-out seasons required')
    training = {str(s): metrics(development,s) for s in SCALES}
    selected = min(SCALES, key=lambda s: (training[str(s)]['margin_mae']+
                                          training[str(s)]['total_mae'], s))
    return dict(status='RESEARCH_ONLY', selection_seasons=[2024,2025],
        holdout_season=2026, selected_scale=selected, development=training,
        holdout=dict(baseline=metrics(holdout,0), current=metrics(holdout,1),
                     selected=metrics(holdout,selected)),
        live_weights_changed=False,
        scope='Exact browser matchup score-center component on historical scoring baseline; no live QB/injury or distribution replay.')

def main():
    records = candidates()
    proc = subprocess.run(['node', '-e', """
const fs=require('node:fs');
const engine=require('./nfl_matchup_scenario.js');
const rows=JSON.parse(fs.readFileSync(0,'utf8'));
const results=[], skipped=[];
for(const {evidence,...r} of rows){
  try {
    const model=engine.evaluate(evidence,r.home,r.away,r.week);
    results.push({...r,home_shift:model.home.pointsShift,away_shift:model.away.pointsShift});
  } catch(error){skipped.push({game_id:r.game_id,season:r.season,reason:error.message});}
}
console.log(JSON.stringify({version:engine.VERSION,results,skipped}));
"""], input=json.dumps(records, allow_nan=False), text=True, capture_output=True,
        check=True, cwd=ROOT)
    replay=json.loads(proc.stdout)
    result=evaluate(replay['results'])
    result.update(model=replay['version'], attempted_games=len(records),
                  skipped_games=replay['skipped'])
    print(json.dumps(result,indent=2))

if __name__ == '__main__':
    main()
