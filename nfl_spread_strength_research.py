#!/usr/bin/env python3
"""Compare independent NFL strength and drive margin forecasts, research only.
The reused 2026 diagnostic must not be interpreted as a new blind holdout.
No sportsbook features. Only earlier completed games fit the ratings.
"""
import json
import numpy as np
import pandas as pd
from nfl_drive_research import drives, fit as drive_fit, simulate
from nfl_multifactor_calibration import load_schedules, load_plays
from nfl_score_model import fit as rating_fit, predict
from nfl_drive_pace_research import spread_metrics

WEIGHTS=(0.,.25,.5,.75,1.)
def main():
    schedules=pd.concat([load_schedules(year) for year in (2023,2024,2025,2026)],ignore_index=True)
    schedules=schedules.drop_duplicates(subset=['game_id'])
    if not {2023,2024,2025,2026}.issubset(set(schedules.season)):
        raise ValueError('Historical schedule seasons missing')
    schedules=schedules[(schedules.game_type=='REG')&schedules.home_score.notna()&schedules.away_score.notna()]
    rows=[]; skipped=[]
    for season in (2024,2025,2026):
        s=schedules[schedules.season==season]
        d=drives(load_plays(season),set(s.game_id.astype(str)))
        for week in sorted(s.week.unique()):
            if week<5:continue
            history=s[s.week<week]; prior=d[d.week<week]
            drive_model=drive_fit(prior)
            rating=rating_fit(schedules,season,int(week))
            for g in s[s.week==week].itertuples():
                try:
                    r=simulate(prior,history,g.home_team,g.away_team,model=drive_model,return_margins=True)
                    h,a=predict(rating,g.home_team,g.away_team,neutral=str(getattr(g,'location','')).lower()=='neutral')
                    raw=r['margins']; actual=float(g.home_score-g.away_score)
                    # Shift the existing distribution toward an independent
                    # strength estimate; retain shape. Not a discrete score model.
                    metrics={}
                    for w in WEIGHTS:
                        m=raw+w*((h-a)-raw.mean())
                        metrics[str(w)]={'margin_mae':abs(float(m.mean())-actual),**spread_metrics(m,actual)}
                    rows.append({'season':season,'metrics':metrics})
                except ValueError as e:skipped.append({'game':str(g.game_id),'reason':str(e)})
    def summary(rs):
        if not rs:raise ValueError('Empty evaluation split')
        return {str(w):{k:float(np.mean([r['metrics'][str(w)][k] for r in rs])) for k in rs[0]['metrics'][str(w)]} for w in WEIGHTS}
    dev=[r for r in rows if r['season']<2026]; diagnostic=[r for r in rows if r['season']==2026]
    training=summary(dev); test=summary(diagnostic)
    selected=min(WEIGHTS,key=lambda w:training[str(w)]['margin_mae'])
    print(json.dumps({'status':'RESEARCH_ONLY','model':'drive-strength-margin-v1','development_games':len(dev),'diagnostic_games':len(diagnostic),
        'development_selected_weight':selected,'development':training,'reused_2026_diagnostic':test,'skipped':skipped,
        'limits':'Continuous margin-only distribution shift; not a legal-score simulator. QB uses last observed prior starter, not historical pregame injury/lineup snapshots. No live promotion or independent validation.'},indent=2))
if __name__=='__main__':main()
