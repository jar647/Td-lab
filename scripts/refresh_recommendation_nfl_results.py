#!/usr/bin/env python3
"""Fetch official final NFL boxes with independent offensive-snap participation.
Missing rows stay unresolved; never infer zero or DNP from absent data.
"""
import datetime,json,pathlib,sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
ROOT=pathlib.Path(__file__).resolve().parents[1]

def main():
    import pandas as pd,nflreadpy
    from historical_participation import snap_verified_weekly
    ledger=ROOT/'data/recommendations/ledger.json'
    picks=json.loads(ledger.read_text()).get('picks',[]) if ledger.exists() else []
    now=datetime.datetime.now(datetime.timezone.utc)
    nfl=[p for p in picks if p.get('sport')=='NFL' and datetime.datetime.fromisoformat(p['startsAt'].replace('Z','+00:00'))+datetime.timedelta(hours=3)<now]
    target=ROOT/'data/recommendations/nfl_results.json'
    if target.exists():
        previous=json.loads(target.read_text())
        try:
            if now-datetime.datetime.fromisoformat(previous['generatedAt'].replace('Z','+00:00'))<datetime.timedelta(hours=1):return
        except (KeyError,ValueError):pass
    if not nfl:return
    targets={p['gameId'] for p in nfl}
    seasons={int(g.split('_')[0]) for g in targets}
    games=[]
    frame=lambda x:x.to_pandas() if hasattr(x,'to_pandas') else pd.DataFrame(x)
    for season in seasons:
        schedules=frame(nflreadpy.load_schedules([season]))
        final=schedules.loc[schedules.game_id.isin(targets)&schedules.home_score.notna()&schedules.away_score.notna()]
        if final.empty:continue
        weekly=frame(nflreadpy.load_player_stats(seasons=[season],summary_level='week'))
        snaps=frame(nflreadpy.load_snap_counts([season]))
        rosters=frame(nflreadpy.load_rosters([season]))
        appearances=snap_verified_weekly(weekly,rosters,snaps,schedules,season)
        # A player with independently verified snaps and no weekly box may have
        # zero prop counts, as in the existing NFL forward probability grader.
        for _,g in final.iterrows():
            players=[]
            for _,p in appearances.loc[appearances.game_id.eq(g.game_id)].iterrows():
                tdrows=weekly.loc[weekly.game_id.eq(g.game_id)&weekly.player_id.eq(p.player_id)]
                td=None
                if len(tdrows)==1 and all(k in tdrows for k in ['rushing_tds','receiving_tds']):
                    r=tdrows.iloc[0]
                    if pd.notna(r.rushing_tds) and pd.notna(r.receiving_tds):td=bool(r.rushing_tds+r.receiving_tds>0)
                players.append({'playerId':str(p.player_id),'team':str(p.team),'participationVerified':True,'passYards':float(p.passing_yards),'rushYards':float(p.rushing_yards),'recYards':float(p.receiving_yards),'receptions':float(p.receptions),'scoredTD':td})
            games.append({'gameId':str(g.game_id),'final':True,'players':players})
    target=ROOT/'data/recommendations/nfl_results.json'
    previous=json.loads(target.read_text()) if target.exists() else {'games':[]}
    merged={g['gameId']:g for g in previous.get('games',[])};merged.update({g['gameId']:g for g in games})
    target.write_text(json.dumps({'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':'nflverse final weekly boxes + independently verified offensive snaps','games':list(merged.values())},indent=2)+'\n')
    print('NFL recommendation results:',len(merged),'final games')
if __name__=='__main__':main()
