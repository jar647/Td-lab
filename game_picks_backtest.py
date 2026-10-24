#!/usr/bin/env python3
"""Walk-forward score baseline audit. Uses only earlier completed regular-season weeks."""
import json
from pathlib import Path
import pandas as pd
import nflreadpy
from game_picks import frame,team_rates,score_projection

ROOT=Path(__file__).resolve().parent
def main():
    rows=[]
    for season in (2024,2025,2026):
        sch=frame(nflreadpy.load_schedules([season]))
        reg=sch[(pd.to_numeric(sch.season,errors='coerce')==season)&(sch.game_type.astype(str).str.upper()=='REG')].copy()
        reg['week_num']=pd.to_numeric(reg.week,errors='coerce')
        for _,game in reg.iterrows():
            week=int(game.week_num)
            if week<5 or pd.isna(game.home_score) or pd.isna(game.away_score):continue
            past=reg[(reg.week_num<week)&reg.home_score.notna()&reg.away_score.notna()]
            h=team_rates(past,str(game.home_team))
            a=team_rates(past,str(game.away_team))
            hp,ap=score_projection(h,a)
            home_actual=float(game.home_score)
            away_actual=float(game.away_score)
            rows.append({'season':season,'week':week,'game_id':str(game.game_id),
                'home':str(game.home_team),'away':str(game.away_team),
                'projected_home':hp,'projected_away':ap,'projected_total':round(hp+ap,1),
                'actual_home':home_actual,'actual_away':away_actual,
                'actual_total':home_actual+away_actual,'projected_margin':round(hp-ap,1),
                'actual_margin':home_actual-away_actual})
    if not rows:raise RuntimeError('No historical games were graded')
    def report(sub):
        if not sub:return None
        n=len(sub)
        return {'games':n,
          'total_mae':round(sum(abs(r['projected_total']-r['actual_total']) for r in sub)/n,2),
          'margin_mae':round(sum(abs(r['projected_margin']-r['actual_margin']) for r in sub)/n,2),
          'winner_accuracy':round(sum((r['projected_margin']>0)==(r['actual_margin']>0) for r in sub if r['actual_margin']!=0)/max(1,sum(r['actual_margin']!=0 for r in sub)),4),
          'total_bias':round(sum(r['projected_total']-r['actual_total'] for r in sub)/n,2)}
    out={'model_version':'score-baseline-v1','method':'Walk-forward; each game uses earlier weeks only. Week 5+ regular-season games with final scores. No sportsbook lines; no ATS/total betting ROI claims.',
         'overall':report(rows),'by_season':{str(s):report([r for r in rows if r['season']==s]) for s in (2024,2025,2026)},
         'records':rows}
    target=ROOT/'data'/'game_picks_backtest.json'
    target.write_text(json.dumps(out,indent=2))
    print(json.dumps({'overall':out['overall'],'by_season':out['by_season']},indent=2))
if __name__=='__main__':main()
