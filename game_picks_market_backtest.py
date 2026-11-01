#!/usr/bin/env python3
"""Historical market benchmark for frozen walk-forward score predictions.

Historical schedule odds are treated as closing-line proxies, NOT executable
real-time prices. ATS uses the documented nflverse home-margin sign convention.
"""
import json
from pathlib import Path
import pandas as pd
import nflreadpy
from game_picks import frame
from game_market import schedule_market

ROOT=Path(__file__).resolve().parent
def numeric(v):
    try:
        n=float(v)
        return n if pd.notna(n) else None
    except (TypeError,ValueError):return None

def american_profit(odds):
    if odds is None or odds==0 or abs(odds)<100:return None
    return round(odds/100 if odds>0 else 100/abs(odds),6)

def moneyline_roi(rows,model):
    wins=losses=pushes=0
    net=0.0
    by_season={}
    for row in rows:
        margin=row[model+'_margin']
        actual=row['actual_margin']
        side='home' if margin>0 else 'away' if margin<0 else None
        if side is None:continue
        odds=row.get(side+'_moneyline')
        payout=american_profit(odds)
        if payout is None:continue
        season=str(row['season'])
        b=by_season.setdefault(season,{'bets':0,'profit_units':0.0})
        b['bets']+=1
        if actual==0:
            pushes+=1
        elif (actual>0)==(side=='home'):
            wins+=1
            net+=payout
            b['profit_units']+=payout
        else:
            losses+=1
            net-=1
            b['profit_units']-=1
    bets=wins+losses+pushes
    for v in by_season.values():
        v['profit_units']=round(v['profit_units'],2)
        v['roi']=round(v['profit_units']/v['bets'],4) if v['bets'] else None
    return {'bets':bets,'wins':wins,'losses':losses,'pushes':pushes,
            'net_units':round(net,2),'roi':round(net/bets,4) if bets else None,
            'by_season':by_season}

def evaluate(rows):
    outcomes={}
    for model in ('baseline','challenger'):
        totals={'OVER':{'wins':0,'losses':0,'pushes':0},'UNDER':{'wins':0,'losses':0,'pushes':0}}
        ml={'HOME':{'wins':0,'losses':0,'pushes':0},'AWAY':{'wins':0,'losses':0,'pushes':0}}
        for row in rows:
            predicted=row[model+'_total']
            line=row.get('market_total')
            actual=row['actual_total']
            if line is not None:
                side='OVER' if predicted>line else 'UNDER' if predicted<line else None
                if side:
                    outcome='pushes' if actual==line else 'wins' if ((actual>line)==(side=='OVER')) else 'losses'
                    totals[side][outcome]+=1
            pm=row[model+'_margin']
            am=row['actual_margin']
            side='HOME' if pm>0 else 'AWAY' if pm<0 else None
            if side:
                outcome='pushes' if am==0 else 'wins' if ((am>0)==(side=='HOME')) else 'losses'
                ml[side][outcome]+=1
        def aggregate(x):
            w=sum(v['wins'] for v in x.values());l=sum(v['losses'] for v in x.values());p=sum(v['pushes'] for v in x.values())
            return {'wins':w,'losses':l,'pushes':p,'hit_rate':round(w/(w+l),4) if w+l else None}
        outcomes[model]={'total_direction':aggregate(totals),'winner_direction':aggregate(ml)}
    return outcomes

def main():
    source=json.loads((ROOT/'data/game_picks_backtest.json').read_text())
    rows=[dict(r, challenger_margin=r['projected_margin'], challenger_total=r['projected_total']) for r in source['records']]
    by_id={r['game_id']:r for r in rows}
    coverage={'games':len(rows),'total_lines':0,'home_spread_lines':0,'moneyline_prices':0}
    for season in sorted({r['season'] for r in rows}):
        sch=frame(nflreadpy.load_schedules([season]))
        for _,g in sch.iterrows():
            row=by_id.get(str(g.get('game_id')))
            if row is None:continue
            row.update(schedule_market(g))
            coverage['total_lines']+=row['market_total'] is not None
            coverage['home_spread_lines']+=row['market_home_spread'] is not None
            coverage['moneyline_prices']+=row['home_moneyline'] is not None and row['away_moneyline'] is not None
    results=evaluate(rows)
    for model in ('baseline','challenger'):
        results[model]['moneyline_flat_stake']=moneyline_roi(rows,model)
    # ATS evaluated using the verified, normalized home handicap.
    for model in ('baseline','challenger'):
        w=l=p=0
        for row in rows:
            line=row.get('market_home_spread')
            if line is None:continue
            edge=row[model+'_margin']+line
            actual=row['actual_margin']+line
            if edge==0:continue
            if actual==0:p+=1
            elif (edge>0)==(actual>0):w+=1
            else:l+=1
        results[model]['ats']={'wins':w,'losses':l,'pushes':p,'hit_rate':round(w/(w+l),4) if w+l else None}
    out={'status':'HISTORICAL_RESEARCH_ONLY','model_version':source['model_version'],'method':'2024-26 prior-week walk-forward projections compared to historical schedule market totals. Historical lines may reflect closing prices. Moneyline returns use historical schedule prices and 1-unit flat stakes; these are NOT verified pregame executable odds. No calibrated confidence. ATS converts documented nflverse spread_line to the home handicap; conflicting fields fail validation.',
      'coverage':coverage,'results':results,'records':rows}
    (ROOT/'data/game_picks_market_comparison.json').write_text(json.dumps(out,indent=2))
    print(json.dumps({'coverage':coverage,'results':results},indent=2))
if __name__=='__main__':main()
