#!/usr/bin/env python3
"""Forward-only projection ledger from frozen pregame snapshots.

Never overwrite a projection after kickoff. Grade only verified appearances
in completed games. Missing stats remain ungraded, not red.
"""
import json
from pathlib import Path
import pandas as pd
import nflreadpy

ROOT=Path(__file__).resolve().parent
HISTORY=ROOT/'data'/'history'
MARKETS={
 'PASS':('playerPassYards','recent3PassYards','defPassYardsAllowed','passYards'),
 'RUSH':('playerRushYards','recent3RushYards','defRushYardsAllowed','rushYards'),
 'REC':('playerRecYards','recent3RecYards','defRecYardsAllowed','recYards'),
 'CATCH':('playerReceptions','recent3Receptions','defReceptionsAllowed','receptions'),
}
def frame(v):return v.to_pandas() if hasattr(v,'to_pandas') else pd.DataFrame(v)
def projection(r,market):
    season,recent,defense,_=MARKETS[market]
    a=r.get(season)
    if a is None:return None
    a=float(a)
    if a<=0:return None
    b=r.get(recent)
    blend=.7*a+.3*float(b) if b is not None else a
    d=r.get(defense)
    factor=max(.85,min(1.15,float(d)/a)) if d is not None and float(d)>0 else 1
    return round(blend*(.75+.25*factor),2)
def main():
    records=[]
    snapshots=sorted(HISTORY.glob('*-week-*.json'))
    seasons=sorted({int(p.name.split('-')[0]) for p in snapshots if '-results' not in p.name})
    for season in seasons:
        pbp=frame(nflreadpy.load_pbp([season]))
        sch=frame(nflreadpy.load_schedules([season]))
        snaps=frame(nflreadpy.load_snap_counts([season]))
        if 'season_type' in pbp:pbp=pbp[pbp.season_type.astype(str)=='REG']
        if 'no_play' in pbp:pbp=pbp[pd.to_numeric(pbp.no_play,errors='coerce').fillna(0)==0]
        if 'season' in snaps:snaps=snaps[snaps.season==season]
        for path in snapshots:
            if not path.name.startswith(str(season)+'-') or '-results' in path.name:continue
            frozen=json.loads(path.read_text())
            week=int(frozen['week'])
            captured=pd.to_datetime(frozen.get('captured_at'),utc=True,errors='coerce')
            games=sch[(sch.week==week)&(sch.game_type.astype(str).str.upper()=='REG')]
            first=pd.to_datetime(games.gameday,utc=True,errors='coerce').min()
            if pd.isna(captured) or pd.isna(first) or captured>=first:continue
            weekplays=pbp[pbp.week==week]
            for r in frozen.get('players',[]):
                if r.get('availability')!='ROSTER_ACTIVE' or not r.get('player_id'):continue
                pid=str(r['player_id'])
                team=str(r.get('team',''))
                opponent=str(r.get('opp',''))
                game=games[((games.home_team==team)&(games.away_team==opponent))|((games.away_team==team)&(games.home_team==opponent))]
                if len(game)!=1:continue
                g=game.iloc[0]
                gameid=str(g.game_id)
                completed=pd.notna(g.get('home_score')) and pd.notna(g.get('away_score')) and gameid in set(weekplays.game_id.astype(str))
                # Snap counts confirm an appearance, including zero-stat games.
                appeared=bool(completed and not snaps[(snaps.week==week)&(snaps.game_id.astype(str)==gameid)&(snaps.player.astype(str)==pid)].empty) if {'week','game_id','player'}.issubset(snaps.columns) else False
                plays=weekplays[weekplays.game_id.astype(str)==gameid]
                for market,(_,_,_,key) in MARKETS.items():
                    if market=='PASS' and r.get('pos')!='QB':continue
                    if market in ('REC','CATCH') and r.get('pos')=='QB':continue
                    pred=projection(r,market)
                    if pred is None:continue
                    actual=None
                    if appeared:
                        id_col={'PASS':'passer_player_id','RUSH':'rusher_player_id','REC':'receiver_player_id','CATCH':'receiver_player_id'}[market]
                        value_col={'PASS':'passing_yards','RUSH':'rushing_yards','REC':'receiving_yards','CATCH':'complete_pass'}[market]
                        if {id_col,value_col}.issubset(plays.columns):
                            p=plays[plays[id_col].astype(str)==pid]
                            if market=='CATCH':p=p[pd.to_numeric(p.complete_pass,errors='coerce')==1]
                            actual=round(float(pd.to_numeric(p[value_col],errors='coerce').fillna(0).sum()),2)
                    records.append({'season':season,'week':week,'game_id':gameid,'player_id':pid,'player':r.get('player'),'team':team,'opponent':opponent,'market':market,'projection':pred,'actual':actual,'status':'PENDING' if actual is None else ('GREEN' if actual>=pred else 'RED'),'error':None if actual is None else round(actual-pred,2)})
    graded=[r for r in records if r['actual'] is not None]
    summary={}
    for market in MARKETS:
        subset=[r for r in graded if r['market']==market]
        summary[market]={'graded':len(subset),'green':sum(r['status']=='GREEN' for r in subset),'red':sum(r['status']=='RED' for r in subset),'mae':round(sum(abs(r['error']) for r in subset)/len(subset),2) if subset else None}
    out={'method':'Frozen pregame projections only; snap-verified appearances; green means actual >= projection, NOT sportsbook profit. Red means below projection. Missing/inactive games remain pending.','summary':summary,'records':records}
    target=ROOT/'data'/'projection_tracker.json'
    target.parent.mkdir(exist_ok=True)
    target.write_text(json.dumps(out,indent=2))
    print('Projection tracker:',json.dumps(summary))
if __name__=='__main__':main()
