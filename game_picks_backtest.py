#!/usr/bin/env python3
"""Walk-forward score baseline audit. Uses only earlier completed regular-season weeks."""
import json
from pathlib import Path
import pandas as pd
import nflreadpy
from game_picks import frame,team_rates,score_projection
from game_context import team_context, matchup_context, adjusted_projection, residual_context

ROOT=Path(__file__).resolve().parent
def main():
    rows=[]
    for season in (2024,2025,2026):
        sch=frame(nflreadpy.load_schedules([season]))
        pbp=frame(nflreadpy.load_pbp([season])).to_dict('records')
        reg=sch[(pd.to_numeric(sch.season,errors='coerce')==season)&(sch.game_type.astype(str).str.upper()=='REG')].copy()
        reg['week_num']=pd.to_numeric(reg.week,errors='coerce')
        for _,game in reg.iterrows():
            week=int(game.week_num)
            if week<5 or pd.isna(game.home_score) or pd.isna(game.away_score):continue
            past=reg[(reg.week_num<week)&reg.home_score.notna()&reg.away_score.notna()]
            h=team_rates(past,str(game.home_team))
            a=team_rates(past,str(game.away_team))
            baseline_h,baseline_a=score_projection(h,a)
            context=matchup_context(team_context(pbp,season,week,str(game.home_team)),
                                    team_context(pbp,season,week,str(game.away_team)))
            hp,ap=adjusted_projection(baseline_h,baseline_a,context)
            home_actual=float(game.home_score)
            away_actual=float(game.away_score)
            context=residual_context(game,str(game.home_team),str(game.away_team))
            rows.append({'season':season,'week':week,'game_id':str(game.game_id),
                'home':str(game.home_team),'away':str(game.away_team),
                'projected_home':hp,'projected_away':ap,'projected_total':round(hp+ap,1),
                'baseline_home':baseline_h,'baseline_away':baseline_a,
                'actual_home':home_actual,'actual_away':away_actual,
                'actual_total':home_actual+away_actual,'baseline_margin':round(baseline_h-baseline_a,1),
                'baseline_total':round(baseline_h+baseline_a,1),
                'projected_margin':round(hp-ap,1),
                'actual_margin':home_actual-away_actual,**context})
    if not rows:raise RuntimeError('No historical games were graded')
    def report(sub,prefix='projected'):
        if not sub:return None
        n=len(sub)
        return {'games':n,
          'total_mae':round(sum(abs(r[prefix+'_total']-r['actual_total']) for r in sub)/n,2),
          'margin_mae':round(sum(abs(r[prefix+'_margin']-r['actual_margin']) for r in sub)/n,2),
          'winner_accuracy':round(sum((r[prefix+'_margin']>0)==(r['actual_margin']>0) for r in sub if r['actual_margin']!=0)/max(1,sum(r['actual_margin']!=0 for r in sub)),4),
          'total_bias':round(sum(r[prefix+'_total']-r['actual_total'] for r in sub)/n,2)}
    out={'model_version':'score-baseline-pbp-v2','method':'Walk-forward, target week excluded; scoring baseline plus shrunk offense-vs-defense EPA/success adjustment from completed PBP only. Probabilities and ATS are not validated.',
         'overall':{'matchup_adjusted':report(rows),'scoring_baseline':report(rows,'baseline')},
         'by_season':{str(s):{'matchup_adjusted':report([r for r in rows if r['season']==s]),
                              'scoring_baseline':report([r for r in rows if r['season']==s],'baseline')} for s in (2024,2025,2026)},
         'records':rows}
    target=ROOT/'data'/'game_picks_backtest.json'
    target.write_text(json.dumps(out,indent=2))
    print(json.dumps({'overall':out['overall'],'by_season':out['by_season']},indent=2))
if __name__=='__main__':main()
