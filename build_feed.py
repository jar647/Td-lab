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

def build(pbp, schedules, rosters, now=None, injuries=None, weekly_rosters=None):
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
    # Explicit inactive roster designations are stronger than missing injury reports.
    # Unknown or undocumented roster statuses are not assumed active.
    roster_status={}
    if 'status' in roster.columns:
        roster_status=dict(zip(roster.gsis_id.astype(str),roster.status.fillna('').astype(str).str.upper().str.strip()))
    unavailable_roster={'INJURED RESERVE','INJURED_RESERVE','RESERVE/INJURED','RESERVE-INJURED','IR','RESERVE/PUP','RESERVE/NFI','PUP','NFI','SUSPENDED','RESERVE/SUSPENDED'}
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
        rows.append({'week':int(p.week),'game_id':str(p.game_id),'team':str(p.posteam),'defense':str(p.defteam),
                     'player_id':str(pid),'player':str(name),'pos':position,'kind':kind,'td':int(td),'inside5':int(float(p.yardline_100)<=5)})
    events=pd.DataFrame(rows)
    if events.empty: raise RuntimeError('No position-verified red-zone opportunities')
    # Each team's sample denominator counts actual played games, not weeks on the calendar.
    played=plays[['game_id','posteam','defteam']].drop_duplicates()
    offense_games=played.groupby('posteam').game_id.nunique().to_dict()
    defense_games=played.groupby('defteam').game_id.nunique().to_dict()
    team_events=events.groupby('team').size().to_dict()
    player_events=events.groupby(['team','player_id']).size().to_dict()
    player_inside5=events.groupby(['team','player_id']).inside5.sum().to_dict()
    # Short-window usage trend: observed opportunities in the latest two completed weeks.
    recent_start=max(1,week-2)
    recent_events=events[events.week>=recent_start]
    recent_games=played[played.game_id.isin(plays.loc[pd.to_numeric(plays.week,errors='coerce')>=recent_start,'game_id'].astype(str))]
    recent_offense_games=recent_games.groupby('posteam').game_id.nunique().to_dict()
    recent_player_events=recent_events.groupby(['team','player_id']).size().to_dict()
    player_td=events.groupby(['defense','pos']).td.sum().to_dict()
    def_opp=events.groupby(['defense','pos']).size().to_dict()
    # Use real opponent slate and only players whose latest roster team matches it.
    roster_team=dict(zip(roster.gsis_id.astype(str),roster.team.astype(str)))
    injury_status=availability(injuries,week)
    injury_diagnostics={'rows_for_week':0,'source_rows':0,'matched_ids':len(injury_status)}
    if injuries is not None and not injuries.empty:
        injury_diagnostics['source_rows']=len(injuries)
        if 'week' in injuries.columns:
            injury_diagnostics['rows_for_week']=int((pd.to_numeric(injuries.week,errors='coerce')==week).sum())
    weekly_diagnostics={'source_rows':0,'latest_week':None,'status_column':False}
    if weekly_rosters is not None and not weekly_rosters.empty and {'gsis_id','week'}.issubset(weekly_rosters.columns):
        wr=weekly_rosters.copy()
        if 'season' in wr:
            wr=wr[pd.to_numeric(wr.season,errors='coerce')==SEASON]
        wr=wr[pd.to_numeric(wr.week,errors='coerce')<=week]
        if not wr.empty:
            latest_week=int(pd.to_numeric(wr.week,errors='coerce').max())
            wr=wr[pd.to_numeric(wr.week,errors='coerce')==latest_week]
            weekly_diagnostics={'source_rows':len(wr),'latest_week':latest_week,'status_column':'status' in wr.columns,'status_counts':wr.status.fillna('MISSING').astype(str).value_counts().head(30).to_dict() if 'status' in wr.columns else {}}
            if 'status' in wr.columns:
                roster_status.update(dict(zip(wr.gsis_id.astype(str),wr.status.fillna('').astype(str).str.upper().str.strip())))
    injury_diagnostics['columns']=list(injuries.columns) if injuries is not None else []
    injury_diagnostics['report_status_counts']=injuries.loc[pd.to_numeric(injuries.week,errors='coerce')==week,'report_status'].fillna('MISSING').astype(str).value_counts().head(20).to_dict() if injuries is not None and {'week','report_status'}.issubset(injuries.columns) else {}
    # NFL weekly roster codes: ACT active roster, RES reserve, DEV practice squad.
    # ACT is roster membership only, not game-day clearance.
    weekly_roster_codes={}
    if weekly_rosters is not None and not weekly_rosters.empty and {'gsis_id','week','status'}.issubset(weekly_rosters.columns):
        wr=weekly_rosters.copy()
        if 'season' in wr: wr=wr[pd.to_numeric(wr.season,errors='coerce')==SEASON]
        wr=wr[pd.to_numeric(wr.week,errors='coerce')<=week]
        if not wr.empty:
            wr=wr.sort_values('week').drop_duplicates('gsis_id',keep='last')
            weekly_roster_codes=dict(zip(wr.gsis_id.astype(str),wr.status.fillna('').astype(str).str.upper().str.strip()))
    nonactive_codes={'RES','DEV','CUT','RET','EXE','TRD','TRT'}
    result=[]
    excluded={'out_report':0,'unavailable_roster':0,'nonactive_weekly_roster':0}
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
                if injury_status.get(pid)=='OUT':
                    excluded['out_report']+=1
                    continue
                if roster_status.get(pid,'') in unavailable_roster:
                    excluded['unavailable_roster']+=1
                    continue
                if weekly_roster_codes.get(pid) in nonactive_codes:
                    excluded['nonactive_weekly_roster']+=1
                    continue
                if (opp,position) not in def_opp: continue
                share=100*player_events[(team,pid)]/team_events[team]
                health=injury_status.get(pid,'ROSTER_ACTIVE' if weekly_roster_codes.get(pid)=='ACT' else 'UNVERIFIED')
                result.append({'player_id':pid,'availability':health,'player':p.player,'pos':position,'team':team,'opp':opp,
                    'games':games,'tdallowed':mean(player_td.get((opp,position),0)/dg),
                    'rzallowed':mean(def_opp[(opp,position)]/dg),
                    'rzshare':mean(share),'playerRz':mean(player_events[(team,pid)]/og),
                    'goalLine5':mean(player_inside5.get((team,pid),0)/og),
                    'recentRz2':mean(recent_player_events.get((team,pid),0)/recent_offense_games[team]) if recent_offense_games.get(team,0)>0 else None,
                    'recentRz2Games':int(recent_offense_games.get(team,0)),
                    'odds':'','prob':'','market':'ATD',
                    'notes':f'Availability: {health} (ROSTER_ACTIVE means listed on active roster, NOT cleared for game day; UNVERIFIED does not mean active). nflverse play-by-play; {SEASON} weeks {max(1,week-WINDOW)}-{week-1}; red-zone rushes + intended targets; position verified by roster; no odds or calibrated TD probability. Player RZ share is share of recorded team red-zone rushes and intended targets (not all plays). Goal-line metric counts recorded rushes and intended targets from opponent 5 or closer per played team game; informational only, not part of the ranking score.'})
    if not result: raise RuntimeError('No matchup records passed source and sample validation')
    result.sort(key=lambda r:(r['team'],r['pos'],r['player']))
    return result, {'season':SEASON,'week':week,'generated_at':now.isoformat(),
                    'matchups':len(result),'source':'nflverse play-by-play and rosters',
                    'odds_source':None,'probability_model':None,
                    'lookback_weeks':WINDOW,'availability_diagnostics':{'injuries':injury_diagnostics,'weekly_rosters':weekly_diagnostics,'excluded':excluded,'unverified_output':sum(r['availability']=='UNVERIFIED' for r in result)},'injury_policy':'Current-week OUT excluded; doubtful/questionable flagged; weekly RES/DEV/CUT/RET/EXE/TRD/TRT excluded. ROSTER_ACTIVE only confirms active roster membership, not game-day clearance; late inactives unverified.','status':'ready'}

def main():
    now = datetime.now(timezone.utc)
    import nflreadpy as nfl
    pbp=frame(nfl.load_pbp([SEASON]))
    schedules=frame(nfl.load_schedules([SEASON]))
    rosters=frame(nfl.load_rosters([SEASON]))
    try:
        injuries=frame(nfl.load_injuries([SEASON]))
    except Exception as exc:
        print(f'Injury source unavailable; marking all statuses unverified: {exc}',file=sys.stderr)
        injuries=None
    try:
        weekly_rosters=frame(nfl.load_rosters_weekly([SEASON]))
    except Exception as exc:
        print(f'Weekly rosters unavailable: {exc}',file=sys.stderr)
        weekly_rosters=None
    result,meta=build(pbp,schedules,rosters,injuries=injuries,weekly_rosters=weekly_rosters)
    print('AVAILABILITY DIAGNOSTICS: '+json.dumps(meta['availability_diagnostics']))
    # Freeze each week's first published candidate set for honest, forward-only grading.
    # Never replace snapshots as subsequent results become known.
    history=OUT/'history'
    history.mkdir(exist_ok=True)
    snapshot=history/f'{SEASON}-week-{meta["week"]}.json'
    if not snapshot.exists():
        slate=schedules[(pd.to_numeric(schedules.season,errors='coerce')==SEASON)&(pd.to_numeric(schedules.week,errors='coerce')==meta['week'])&(schedules.game_type.astype(str).str.upper()=='REG')]
        first_day=pd.to_datetime(slate.gameday,errors='coerce',utc=True).min() if not slate.empty else pd.NaT
        if not pd.isna(first_day) and pd.Timestamp(now)<first_day:
            snapshot.write_text(json.dumps({'season':SEASON,'week':meta['week'],'captured_at':meta['generated_at'],'players':result,'capture_policy':'before first scheduled game day (UTC)'},indent=2))
            print(f'Froze pregame snapshot for Week {meta["week"]}')
        else:
            print(f'Skipped Week {meta["week"]} snapshot: first game day already started or schedule missing',file=sys.stderr)
    # Snapshot capture must precede kickoff of every game being evaluated.
    # A snapshot taken after any kickoff is retained for transparency but not
    # eligible for honest pregame prediction accuracy calculations.
    # Grade previous frozen snapshots against completed PBP. TD scored is measured
    # using the scorer ID, not red-zone opportunities or the candidate's score.
    for prior in sorted(history.glob(f'{SEASON}-week-*.json')):
        try:
            record=json.loads(prior.read_text())
            w=int(record['week'])
            if w>=meta['week']: continue
            game_rows=pbp[(pd.to_numeric(pbp.week,errors='coerce')==w)&(pd.to_numeric(pbp.season,errors='coerce')==SEASON)]
            if game_rows.empty: continue
            needed_td={'rush_touchdown','pass_touchdown','rusher_player_id','receiver_player_id'}
            if not needed_td.issubset(game_rows.columns):
                print(f'Cannot grade week {w}: missing touchdown scorer columns',file=sys.stderr)
                continue
            # Require all scheduled regular-season games in that week to have PBP
            expected=schedules[(pd.to_numeric(schedules.season,errors='coerce')==SEASON)&(pd.to_numeric(schedules.week,errors='coerce')==w)&(schedules.game_type.astype(str).str.upper()=='REG')]
            if expected.empty or not {'game_id','home_score','away_score'}.issubset(expected.columns): continue
            captured=pd.to_datetime(record.get('captured_at'),errors='coerce',utc=True)
            if pd.isna(captured): continue
            if 'gameday' not in expected.columns: continue
            earliest_kickoff=pd.to_datetime(expected.gameday,errors='coerce',utc=True).min()
            # gameday is a date, not kickoff time: conservatively require capture
            # before the first calendar day of games to avoid hindsight leakage.
            pregame_capture=not pd.isna(earliest_kickoff) and captured < earliest_kickoff
            if expected[['home_score','away_score']].isna().any().any(): continue
            if not set(expected.game_id.dropna().astype(str)).issubset(set(game_rows.game_id.dropna().astype(str))): continue
            # Require games to have finished, not merely started.
            if 'gameday' not in expected.columns or pd.to_datetime(expected.gameday,errors='coerce',utc=True).isna().any() or pd.to_datetime(expected.gameday,errors='coerce',utc=True).max() >= pd.Timestamp(now)-pd.Timedelta(days=2):
                continue
            rush=game_rows.loc[pd.to_numeric(game_rows.rush_touchdown,errors='coerce')==1,'rusher_player_id'].dropna().astype(str)
            receiving=game_rows.loc[pd.to_numeric(game_rows.pass_touchdown,errors='coerce')==1,'receiver_player_id'].dropna().astype(str)
            scored=set(rush).union(set(receiving))
            def score_candidate(p):
                def capped(k,den):
                    return min(1,max(0,float(p.get(k,0))/den))
                raw=100*(.35*capped('tdallowed',1.5)+.20*capped('rzallowed',4)+.25*capped('rzshare',50)+.20*capped('playerRz',2.5))
                return int(raw*(.65+.35*min(1,float(p.get('games',0))/6))+.5)
            # Experimental challenger: preserve the original score, and compare only
            # against frozen pregame snapshots with BOTH research fields present.
            # Not a calibrated probability; no hindsight feature recomputation.
            def challenger_score(p):
                baseline=score_candidate(p)
                recent=p.get('recentRz2')
                goal=p.get('goalLine5')
                if recent is None or goal is None: return None
                try:
                    recent=float(recent); goal=float(goal)
                    if not (0<=recent<100 and 0<=goal<100): return None
                except (ValueError,TypeError): return None
                # 80% baseline, 12% recent usage, 8% inside-five usage.
                return round(.80*baseline + 12*min(1,recent/2.5) + 8*min(1,goal/1.0))
            eligible=[p for p in record['players'] if p.get('availability')=='ROSTER_ACTIVE']
            ranked_ids=set()
            for position in ('RB','WR','TE','QB'):
                group=sorted((p for p in eligible if p.get('pos')==position),key=lambda p:(-score_candidate(p),str(p.get('player',''))))
                ranked_ids.update(str(p.get('player_id')) for p in group[:3])
            challenger_eligible=bool(eligible) and all(challenger_score(p) is not None for p in eligible)
            challenger_ids=set()
            if challenger_eligible:
                for position in ('RB','WR','TE','QB'):
                    group=sorted((p for p in eligible if p.get('pos')==position),key=lambda p:(-challenger_score(p),str(p.get('player',''))))
                    challenger_ids.update(str(p.get('player_id')) for p in group[:3])
            graded=[{'player_id':p.get('player_id'),'player':p['player'],'pos':p['pos'],'team':p['team'],'score':score_candidate(p),'top3_position':str(p.get('player_id')) in ranked_ids,'challenger_score':challenger_score(p) if challenger_eligible else None,'challenger_top3_position':str(p.get('player_id')) in challenger_ids if challenger_eligible else None,'scored_td':p.get('player_id') in scored} for p in record['players']]
            (history/f'{SEASON}-week-{w}-results.json').write_text(json.dumps({'season':SEASON,'week':w,'graded_at':meta['generated_at'],'pregame_snapshot':bool(pregame_capture),'snapshot_captured_at':record.get('captured_at'),'accuracy_eligible':bool(pregame_capture),'challenger_eligible':bool(pregame_capture and challenger_eligible),'challenger_policy':'80% original score + 12% recent red-zone chances + 8% inside-five chances; experimental research score, not calibrated probability','graded_count':len(graded),'scored_count':sum(p['scored_td'] for p in graded),'grading_scope':'Rushing and receiving touchdowns only; excludes passing and return TDs','players':graded},indent=2))
        except (ValueError,KeyError,TypeError,AttributeError) as exc:
            print(f'Unable to grade {prior.name}: {exc}',file=sys.stderr)
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
