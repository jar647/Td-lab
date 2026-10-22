#!/usr/bin/env python3
"""TD LAB 3.0: real nflverse PBP -> verified matchup feed.
No invented values: omit incomplete records; no bookmaker odds or TD probabilities.
"""
import json, os, sys
from datetime import datetime, timezone
from pathlib import Path
import pandas as pd

SEASON = int(os.getenv('TDLAB_SEASON', datetime.now(timezone.utc).year))
WINDOW = int(os.getenv('TDLAB_WINDOW', '5'))
OUT = Path(__file__).resolve().parent / 'data'
OUT.mkdir(exist_ok=True)

def frame(x):
    return x.to_pandas() if hasattr(x, 'to_pandas') else pd.DataFrame(x)

def required(df, columns, label):
    missing = set(columns) - set(df.columns)
    if missing: raise RuntimeError(f'{label}: missing required columns {sorted(missing)}; no feed published')

def mean(x): return round(float(x), 3)

def availability(injuries, week):
    """Use current-week official game reports only; absence of a report is unknown."""
    if injuries is None or injuries.empty:
        return {}
    needed={'gsis_id','week','report_status'}
    if not needed.issubset(injuries.columns):
        return {}
    rows=injuries.copy()
    if 'season' in rows:
        rows=rows[pd.to_numeric(rows.season,errors='coerce')==SEASON]
    rows=rows[pd.to_numeric(rows.week,errors='coerce')==week]
    if 'date_modified' in rows:
        rows=rows.sort_values('date_modified',na_position='first')
    result={}
    for _,r in rows.iterrows():
        pid=str(r.gsis_id)
        status=str(r.report_status).strip().upper()
        if status in ('OUT','DOUBTFUL','QUESTIONABLE'):
            result[pid]=status
    return result

def build(pbp, schedules, rosters, now=None, injuries=None):
    now = now or datetime.now(timezone.utc)
    required(pbp, ['season','week','game_id','posteam','defteam','yardline_100','play_type',
                   'rush_attempt','pass_attempt','rusher_player_id','receiver_player_id',
                   'rusher_player_name','receiver_player_name','touchdown','td_team'], 'play-by-play')
    required(schedules,['season','week','game_type','home_team','away_team','gameday'], 'schedules')
    required(rosters,['gsis_id','position','team'], 'rosters')
    sch = schedules[(pd.to_numeric(schedules.season,errors='coerce') == SEASON) &
                    (schedules.game_type.astype(str).str.upper()=='REG')].copy()
    sch['date'] = pd.to_datetime(sch.gameday,errors='coerce',utc=True)
    today = pd.Timestamp(now).normalize()
    upcoming = sch[sch.date >= today].sort_values(['date','week'])
    if upcoming.empty: raise RuntimeError('No upcoming regular-season games in schedule; refusing to publish stale matchups')
    week = int(upcoming.iloc[0].week)
    slate = upcoming[upcoming.week == week]
    if slate.empty: raise RuntimeError('No games in upcoming week')
    plays = pbp[(pd.to_numeric(pbp.season,errors='coerce') == SEASON) &
                (pd.to_numeric(pbp.week,errors='coerce') < week) &
                (pd.to_numeric(pbp.week,errors='coerce') >= max(1,week-WINDOW))].copy()
    plays = plays[plays.posteam.notna() & plays.defteam.notna()]
    if plays.empty: raise RuntimeError('No current-season completed play-by-play in lookback window')
    roster = rosters.copy()
    if 'season' in roster: roster=roster[pd.to_numeric(roster.season,errors='coerce')==SEASON]
    if 'week' in roster: roster=roster.sort_values('week')
    roster=roster.dropna(subset=['gsis_id','position']).drop_duplicates('gsis_id',keep='last')
    pos_by_id=dict(zip(roster.gsis_id.astype(str),roster.position.astype(str)))
    # An opportunity is a documented red-zone rush or an intended target inside the 20.
    # Exclude penalties/no-plays and pass plays without a recorded intended receiver.
    if 'play' in plays: plays=plays[pd.to_numeric(plays.play,errors='coerce').fillna(1)==1]
    if 'no_play' in plays: plays=plays[pd.to_numeric(plays.no_play,errors='coerce').fillna(0)==0]
    rz = plays[pd.to_numeric(plays.yardline_100,errors='coerce').between(1,20)].copy()
    if rz.empty: raise RuntimeError('No valid red-zone plays in current lookback')
    rows=[]
    for _,p in rz.iterrows():
        rush = pd.to_numeric(p.rush_attempt,errors='coerce')==1
        pas = pd.to_numeric(p.pass_attempt,errors='coerce')==1
        if rush:
            pid=p.rusher_player_id; name=p.rusher_player_name; kind='RUSH'
        elif pas and pd.notna(p.receiver_player_id):
            pid=p.receiver_player_id; name=p.receiver_player_name; kind='REC'
        else: continue
        if pd.isna(pid) or pd.isna(name): continue
        position=pos_by_id.get(str(pid),'')
        if position not in ('QB','RB','WR','TE'): continue
        td = (pd.to_numeric(p.touchdown,errors='coerce')==1 and str(p.td_team)==str(p.posteam))
        rows.append({'game_id':str(p.game_id),'team':str(p.posteam),'defense':str(p.defteam),
                     'player_id':str(pid),'player':str(name),'pos':position,'kind':kind,'td':int(td)})
    events=pd.DataFrame(rows)
    if events.empty: raise RuntimeError('No position-verified red-zone opportunities')
    # Each team's sample denominator counts actual played games, not weeks on the calendar.
    played=plays[['game_id','posteam','defteam']].drop_duplicates()
    offense_games=played.groupby('posteam').game_id.nunique().to_dict()
    defense_games=played.groupby('defteam').game_id.nunique().to_dict()
    team_events=events.groupby('team').size().to_dict()
    player_events=events.groupby(['team','player_id']).size().to_dict()
    player_td=events.groupby(['defense','pos']).td.sum().to_dict()
    def_opp=events.groupby(['defense','pos']).size().to_dict()
    # Use real opponent slate and only players whose latest roster team matches it.
    roster_team=dict(zip(roster.gsis_id.astype(str),roster.team.astype(str)))
    injury_status=availability(injuries,week)
    result=[]
    for _,game in slate.iterrows():
        for team,opp in [(game.home_team,game.away_team),(game.away_team,game.home_team)]:
            team=str(team);opp=str(opp)
            og=offense_games.get(team,0); dg=defense_games.get(opp,0)
            games=min(og,dg)
            if games<3 or not team_events.get(team): continue
            players=events[events.team==team].drop_duplicates('player_id')
            for _,p in players.iterrows():
                pid=p.player_id;position=p.pos
                if roster_team.get(pid)!=team: continue
                if injury_status.get(pid)=='OUT': continue
                if (opp,position) not in def_opp: continue
                share=100*player_events[(team,pid)]/team_events[team]
                health=injury_status.get(pid,'UNVERIFIED')
                result.append({'availability':health,'player':p.player,'pos':position,'team':team,'opp':opp,
                    'games':games,'tdallowed':mean(player_td.get((opp,position),0)/dg),
                    'rzallowed':mean(def_opp[(opp,position)]/dg),
                    'rzshare':mean(share),'playerRz':mean(player_events[(team,pid)]/og),
                    'odds':'','prob':'','market':'ATD',
                    'notes':f'Availability: {health} (current-week official injury report only; UNVERIFIED does not mean active). nflverse play-by-play; {SEASON} weeks {max(1,week-WINDOW)}-{week-1}; red-zone rushes + intended targets; position verified by roster; no odds or calibrated TD probability. Player RZ share is share of recorded team red-zone rushes and intended targets (not all plays).'})
    if not result: raise RuntimeError('No matchup records passed source and sample validation')
    result.sort(key=lambda r:(r['team'],r['pos'],r['player']))
    return result, {'season':SEASON,'week':week,'generated_at':now.isoformat(),
                    'matchups':len(result),'source':'nflverse play-by-play and rosters',
                    'odds_source':None,'probability_model':None,
                    'lookback_weeks':WINDOW,'injury_policy':'Current-week OUT excluded; doubtful/questionable flagged; all others unverified. IR and late inactive declarations are not independently verified.','status':'ready'}

def main():
    import nflreadpy as nfl
    pbp=frame(nfl.load_pbp([SEASON]))
    schedules=frame(nfl.load_schedules([SEASON]))
    rosters=frame(nfl.load_rosters([SEASON]))
    try:
        injuries=frame(nfl.load_injuries([SEASON]))
    except Exception as exc:
        print(f'Injury source unavailable; marking all statuses unverified: {exc}',file=sys.stderr)
        injuries=None
    result,meta=build(pbp,schedules,rosters,injuries=injuries)
    # Atomic replacement after full successful validation. Never publish dummy data.
    (OUT/'matchups.json.tmp').write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')))
    (OUT/'status.json.tmp').write_text(json.dumps(meta,indent=2))
    (OUT/'matchups.json.tmp').replace(OUT/'matchups.json')
    (OUT/'status.json.tmp').replace(OUT/'status.json')
    print(f'Published {len(result)} verified records for {SEASON} week {meta["week"]}')

if __name__=='__main__':
    try: main()
    except Exception as exc:
        print(f'FEED UPDATE FAILED (existing published data preserved): {exc}',file=sys.stderr)
        sys.exit(1)
