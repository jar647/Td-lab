#!/usr/bin/env python3
"""Walk-forward EPA/success-rate challenger, evaluated against existing score baseline.

Research only: no picks, odds, or confidence percentages. Every target game uses
only earlier regular-season weeks, and EPA is computed from historical plays.
"""
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parent

def metrics(rows,prefix):
    if not rows:return None
    n=len(rows)
    non_ties=[r for r in rows if r['actual_margin']!=0]
    return {'games':n,
      'margin_mae':round(sum(abs(r[prefix+'_margin']-r['actual_margin']) for r in rows)/n,2),
      'total_mae':round(sum(abs(r[prefix+'_total']-r['actual_total']) for r in rows)/n,2),
      'winner_accuracy':round(sum((r[prefix+'_margin']>0)==(r['actual_margin']>0) for r in non_ties)/len(non_ties),4) if non_ties else None}

def main():
    source=json.loads((ROOT/'data/game_picks_backtest.json').read_text())
    rows=[dict(r, challenger_margin=r['projected_margin'], challenger_total=r['projected_total'])
          for r in source['records']]
    if not rows:raise RuntimeError('No matched historical games to compare')
    out={'status':'RESEARCH_ONLY','model_version':source['model_version'],'challenger':'Exact production prior-league-centered EPA/success adjustment; uncalibrated',
        'method':'Uses the production score backtest records, with no separate challenger formula; target week excluded. No sportsbook execution implied.',
        'overall':{'baseline':metrics(rows,'baseline'),'challenger':metrics(rows,'challenger')},
        'by_season':{str(s):{'baseline':metrics([r for r in rows if r['season']==s],'baseline'),
                              'challenger':metrics([r for r in rows if r['season']==s],'challenger')} for s in (2024,2025,2026)},
        'records':rows}
    (ROOT/'data/game_picks_epa_comparison.json').write_text(json.dumps(out,indent=2))
    print(json.dumps({'overall':out['overall'],'by_season':out['by_season']},indent=2))
if __name__=='__main__':main()
