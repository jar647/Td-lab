#!/usr/bin/env python3
"""THE PROP VAULT: nflverse PBP -> audited matchup feed.
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

def build(pbp, schedules, rosters, now=None, injuries=None, weekly_rosters=None, snap_counts=None):
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
    # One shared, complete-game selection: use only games in BOTH clubs'
    # most recent WINDOW games. This prevents offensive totals including
    # games outside the window used for their game-by-game charts.
    eligible = pbp[(pd.to_numeric(pbp.season,errors='coerce') == SEASON) &
                   (pd.to_numeric(pbp.week,errors='coerce') < week)].copy()
    eligible = eligible[eligible.posteam.notna() & eligible.defteam.notna()]
    completed = eligible[['defteam','game_id','week']].drop_duplicates()
    completed['week'] = pd.to_numeric(completed.week,errors='coerce')
    completed = completed.dropna(subset=['week']).sort_values(['week','game_id'])
    selected = completed.groupby('defteam',sort=False).tail(WINDOW)
    # For any game, both teams must include it in their last-five windows.
    selected_pairs = set(zip(selected.defteam.astype(str),selected.game_id.astype(str)))
    matchup_teams = eligible[['game_id','posteam','defteam']].drop_duplicates()
    complete_games = set(matchup_teams.loc[
        matchup_teams.apply(lambda row:
            (str(row.defteam),str(row.game_id)) in selected_pairs and
            (str(row.posteam),str(row.game_id)) in selected_pairs,axis=1),
        'game_id'].astype(str))
    plays = eligible[eligible.game_id.astype(str).isin(complete_games)].copy()
    if plays.empty: raise RuntimeError('No jointly complete games in five-game window')
    # A game contributes to both sides or neither; no asymmetric windows.
    roster = rosters.copy()
    if 'season' in roster: roster=roster[pd.to_numeric(roster.season,errors='coerce')==SEASON]
    if 'week' in roster: roster=roster.sort_values('week')
    roster=roster.dropna(subset=['gsis_id','position']).drop_duplicates('gsis_id',keep='last')
    pos_by_id=dict(zip(roster.gsis_id.astype(str),roster.position.astype(str)))
    # Use each player's nflverse weekly roster position for the actual play week.
    weekly_positions={}
    if weekly_rosters is not None and not weekly_rosters.empty:
        required(weekly_rosters,['gsis_id','week','position'],'weekly rosters')
        wr=weekly_rosters.copy()
        if 'season' in wr:
            wr=wr[pd.to_numeric(wr.season,errors='coerce')==SEASON]
        wr=wr.dropna(subset=['gsis_id','week','position'])
        wr['week']=pd.to_numeric(wr.week,errors='coerce')
        wr=wr.dropna(subset=['week'])
        wr['position']=wr.position.astype(str).str.upper().str.strip()
        wr=wr[wr.position.isin(('QB','RB','WR','TE'))]
        weekly_positions={(str(r.gsis_id),int(r.week)):str(r.position)
                          for r in wr.drop_duplicates(['gsis_id','week'],keep='last').itertuples()}
    def play_position(pid, play_week):
        if pd.isna(pid): return None
        return weekly_positions.get((str(pid),int(play_week))) or pos_by_id.get(str(pid))

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
        position=play_position(pid,p.week) or ''
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
    # Position-specific receiving production and target volume from valid pass attempts.
    # PBP does not measure snap participation; do not invent snap share.
    # Fail closed if a required defensive-stat source field disappears.
    # Otherwise missing columns can silently turn real allowances into zero.
    required(plays,['receiving_yards','rushing_yards','passing_yards','complete_pass'],
             'defensive-stat play-by-play')
    receiving_available=True
    targets=plays[(pd.to_numeric(plays.pass_attempt,errors='coerce')==1)&plays.receiver_player_id.notna()].copy()
    targets['pid']=targets.receiver_player_id.astype(str)
    targets['pos']=[play_position(pid,w) for pid,w in zip(targets.pid,targets.week)]
    unknown_targets=targets[~targets.pos.isin(['RB','WR','TE'])]
    if not unknown_targets.empty:
        examples=unknown_targets[['game_id','receiver_player_id','week']].head(5).to_dict('records')
        print(f'WARNING: {len(unknown_targets)} unclassified receiver targets excluded; examples: {examples}',file=sys.stderr)
    targets=targets[targets.pos.isin(['RB','WR','TE'])]
    targets['yards']=pd.to_numeric(targets.receiving_yards,errors='coerce')
    # Negative completed-play yardage must count. Missing completed-play
    # yardage is an error, not a zero-yard result.
    completed=targets[pd.to_numeric(targets.complete_pass,errors='coerce')==1]
    if completed.yards.isna().any():
        raise RuntimeError('Completed receptions have missing receiving yards; refusing to publish')
    targets['yards']=targets['yards'].fillna(0)
    targets['attempts']=1
    targets['redzone']=pd.to_numeric(targets.yardline_100,errors='coerce').between(1,20).astype(int)
    player_targets=targets.groupby(['posteam','pid']).size().to_dict()
    team_targets=targets.groupby('posteam').size().to_dict()
    defense_position_targets=targets.groupby(['defteam','pos']).size().to_dict()
    defense_position_yards=targets.groupby(['defteam','pos']).yards.sum().to_dict()
    # Independent aggregation cross-check, grouped per actual defense/game/position.
    # Reject duplicate source play identifiers rather than double-counting.
    if 'play_id' in plays.columns:
        keyed=plays.dropna(subset=['play_id'])
        if keyed.duplicated(['game_id','play_id']).any():
            raise RuntimeError('Duplicate PBP game/play identifiers; refusing to publish')
    per_game_position=targets.groupby(['defteam','game_id','pos'],dropna=False).yards.sum()
    check_position=per_game_position.groupby(level=[0,2]).sum().to_dict()
    for key,total in defense_position_yards.items():
        if abs(float(total)-float(check_position.get(key,float('nan'))))>1e-8:
            raise RuntimeError(f'Defensive receiving-yards reconciliation failed for {key}')

    defense_position_rz_targets=targets.groupby(['defteam','pos']).redzone.sum().to_dict()
    player_rz_targets=targets.groupby(['posteam','pid']).redzone.sum().to_dict()
    # Yardage/reception prop inputs: recorded plays only, with separate defensive
    # positional splits. These are historical per-game averages, not betting lines.
    def metric_group(data, keys, col):
        return data.groupby(keys)[col].sum().to_dict() if not data.empty else {}
    rushes=plays[(pd.to_numeric(plays.rush_attempt,errors='coerce')==1)&plays.rusher_player_id.notna()].copy()
    rushes['pid']=rushes.rusher_player_id.astype(str)
    rushes['pos']=[play_position(pid,w) for pid,w in zip(rushes.pid,rushes.week)]
    unknown_rushes=rushes[~rushes.pos.isin(['QB','RB','WR','TE'])]
    if not unknown_rushes.empty:
        examples=unknown_rushes[['game_id','rusher_player_id','week']].head(5).to_dict('records')
        print(f'WARNING: {len(unknown_rushes)} unclassified rushes excluded; examples: {examples}',file=sys.stderr)
    rushes=rushes[rushes.pos.isin(['QB','RB','WR','TE'])]
    rushes['yards']=pd.to_numeric(rushes.rushing_yards,errors='coerce').fillna(0) if 'rushing_yards' in rushes else 0
    rushes['attempts']=1
    player_rush_yards=metric_group(rushes,['posteam','pid'],'yards')
    player_carries=metric_group(rushes,['posteam','pid'],'attempts')
    defense_rush_yards=metric_group(rushes,['defteam','pos'],'yards')
    defense_rush_attempts=metric_group(rushes,['defteam','pos'],'attempts')
    targets['receptions']=pd.to_numeric(targets.complete_pass,errors='coerce').fillna(0).clip(0,1) if 'complete_pass' in targets else 0
    player_rec_yards=metric_group(targets,['posteam','pid'],'yards')
    player_receptions=metric_group(targets,['posteam','pid'],'receptions')
    defense_receptions=metric_group(targets,['defteam','pos'],'receptions')
    passes=plays[(pd.to_numeric(plays.pass_attempt,errors='coerce')==1)&plays.passer_player_id.notna()].copy() if 'passer_player_id' in plays else pd.DataFrame()
    if not passes.empty:
        passes['pid']=passes.passer_player_id.astype(str)
        passes['yards']=pd.to_numeric(passes.passing_yards,errors='coerce').fillna(0) if 'passing_yards' in passes else 0
        passes['attempts']=1
    player_pass_yards=metric_group(passes,['posteam','pid'],'yards')
    player_pass_attempts=metric_group(passes,['posteam','pid'],'attempts')
    defense_pass_yards=metric_group(passes,['defteam'],'yards')
    defense_pass_attempts=metric_group(passes,['defteam'],'attempts')
    # Last-five observed player games. Source: the same nflverse PBP as the averages.
    # Never manufacture game bars from rolling averages.
    per_game = {}
    for source, field, metric in ((passes, 'passYards', 'yards'),
                                  (rushes, 'rushYards', 'yards'),
                                  (targets, 'recYards', 'yards'),
                                  (targets, 'receptions', 'receptions'),
                                  (passes, 'passAttempts', 'attempts'),
                                  (rushes, 'rushAttempts', 'attempts'),
                                  (targets, 'targets', 'attempts'),
                                  (targets, 'rzTargets', 'redzone')):
        if source.empty:
            continue
        grouped = source.groupby(['posteam', 'pid', 'game_id'])[metric].sum()
        for (tm, player_id, gid), value in grouped.items():
            key = (str(tm), str(player_id), str(gid))
            per_game.setdefault(key, {})[field] = int(value)
    if not events.empty:
        for (tm, player_id, gid), count in events.groupby(['team','player_id','game_id']).size().items():
            key=(str(tm),str(player_id),str(gid))
            per_game.setdefault(key,{})['rzChances']=int(count)
    game_weeks = (plays[['game_id', 'week']].drop_duplicates('game_id')
                  .set_index('game_id')['week'].to_dict())
    player_game_series = {}
    for (tm, player_id, gid), metrics in per_game.items():
        player_game_series.setdefault((tm, player_id), []).append({
            'week': int(game_weeks[gid]), 'gameId': gid,
            **{field:metrics.get(field,0) for field in ('passYards','rushYards','recYards',
               'receptions','passAttempts','rushAttempts','targets','rzTargets','rzChances')}})
    for key, games_list in player_game_series.items():
        games_list.sort(key=lambda g: (g['week'], g['gameId']))
        player_game_series[key] = games_list[-WINDOW:]
    # Include zero-production TEAM games in the chart only as team-game
    # observations, not proof the player took the field. Keep this distinction
    # explicit until verified per-player snap participation is available.
    team_game_index={}
    for row in plays[['posteam','game_id','week']].drop_duplicates().itertuples(index=False):
        team_game_index.setdefault(str(row.posteam),[]).append((int(row.week),str(row.game_id)))
    for tm in team_game_index:
        team_game_index[tm]=sorted(team_game_index[tm])[-WINDOW:]
    for (tm,pid),games_list in list(player_game_series.items()):
        observed={g['gameId']:g for g in games_list}
        player_game_series[(tm,pid)]=[
            observed.get(gid,{'week':w,'gameId':gid,'passYards':0,
                              'rushYards':0,'recYards':0,'receptions':0,
                              'passAttempts':0,'rushAttempts':0,'targets':0,'rzTargets':0,'rzChances':0})
            for w,gid in team_game_index.get(tm,[])]
    # Defense-wide audit: include every club that has played, not just teams
    # appearing in this week's player matchup cards.
    audit_metrics={
      'pass_yards':(passes,'yards',None),
      'pass_attempts':(passes,'attempts',None),
      'rush_yards':(rushes,'yards','pos'),
      'rush_attempts':(rushes,'attempts','pos'),
      'rec_yards':(targets,'yards','pos'),
      'targets':(targets,None,'pos'),
      'receptions':(targets,'receptions','pos'),
      'redzone_targets':(targets,'redzone','pos')
    }
    audit_rows=[]
    for defense,dg in sorted(defense_games.items()):
        if dg<=0: continue
        for position in ('QB','RB','WR','TE'):
            record={'defense':defense,'position':position,'games':int(dg)}
            for metric,(source,col,poscol) in audit_metrics.items():
                if poscol is None and position!='QB': continue
                if poscol is not None and position=='QB' and metric not in ('rush_yards','rush_attempts'): continue
                subset=source[source.defteam==defense]
                if poscol is not None: subset=subset[subset[poscol]==position]
                # Cross-check direct play totals against independently grouped
                # game totals. Both use the same nflverse source, not an
                # external NFL box-score provider.
                if col is None:
                    direct=int(len(subset))
                    by_game=int(subset.groupby('game_id').size().sum())
                else:
                    direct=float(subset[col].sum())
                    by_game=float(subset.groupby('game_id')[col].sum().sum())
                if abs(direct-by_game)>1e-8:
                    raise RuntimeError(f'Defense audit mismatch: {defense} {position} {metric}')
                record[metric+'_total']=direct
                record[metric+'_per_game']=mean(direct/dg)
            audit_rows.append(record)
    if len(defense_games)!=32 or len(audit_rows)!=128:
        raise RuntimeError(f'Incomplete defense coverage: {len(defense_games)} teams / {len(audit_rows)} position records; refusing publication')
    audit={'season':SEASON,'week':week,'lookback_games':WINDOW,
           'source':'nflverse PBP','independent_external_source_verified':False,
           'verification':'INTERNAL_RECONCILIATION_ONLY',
           'definitions':'Defensive rates use each defense\'s last five completed games (or fewer if not yet played); positional receiving/rushing rates aggregate players at the listed position.',
           'classification_exclusions':{'receiver_targets':int(len(unknown_targets)),'rushes':int(len(unknown_rushes))},
           'rows':audit_rows}
    # Last-three-team-games usage, sourced from the same completed PBP.
    last_games=plays[['posteam','game_id','week']].drop_duplicates().sort_values('week').groupby('posteam').tail(3)
    last_keys=pd.MultiIndex.from_frame(last_games[['posteam','game_id']])
    last_counts=last_games.groupby('posteam').game_id.nunique().to_dict()
    def last_three_team_games(source):
        if source.empty:return source
        keys=pd.MultiIndex.from_frame(source[['posteam','game_id']])
        return source[keys.isin(last_keys)].copy()
    last_targets=last_three_team_games(targets)
    last_rushes=last_three_team_games(rushes)
    last_passes=last_three_team_games(passes)
    last_target_counts=last_targets.groupby(['posteam','pid']).size().to_dict()
    last_carry_counts=last_rushes.groupby(['posteam','pid']).size().to_dict()
    last_pass_counts=last_passes.groupby(['posteam','pid']).size().to_dict() if not last_passes.empty else {}
    last_rec_yards=metric_group(last_targets,['posteam','pid'],'yards')
    last_rush_yards=metric_group(last_rushes,['posteam','pid'],'yards')
    last_pass_yards=metric_group(last_passes,['posteam','pid'],'yards')
    last_catches=metric_group(last_targets,['posteam','pid'],'receptions')
    # Context for strength of opponents faced; not a calibrated adjustment.
    def faced_offenses(defense):
        return plays.loc[plays.defteam==defense,'posteam'].dropna().astype(str).unique()
    def opponent_baseline(defense,position,kind):
        foes=faced_offenses(defense)
        if len(foes)<2:return None
        source={'PASS':passes,'RUSH':rushes,'REC':targets,'CATCH':targets}[kind]
        if source.empty:return None
        subset=source[source.posteam.isin(foes)]
        if kind in ('RUSH','REC','CATCH'):subset=subset[subset.pos==position]
        col='receptions' if kind=='CATCH' else 'yards'
        sums=subset.groupby('posteam')[col].sum().to_dict()
        values=[sums.get(t,0)/offense_games[t] for t in foes if offense_games.get(t)]
        return mean(sum(values)/len(values)) if values else None
    # PFR snap records identify players by PFR ID, not GSIS ID. Join only
    # through an explicit roster PFR identifier; never fuzzy-match names.
    snap_share_by_player={}
    snap_weeks_by_player={}
    if snap_counts is not None and not snap_counts.empty and 'pfr_id' in roster.columns:
        required(snap_counts,['season','week','team','pfr_player_id','offense_pct'],'snap counts')
        snap=snap_counts.copy()
        snap=snap[(pd.to_numeric(snap.season,errors='coerce')==SEASON)&
                  pd.to_numeric(snap.week,errors='coerce').between(max(1,week-WINDOW),week-1)]
        snap['offense_pct']=pd.to_numeric(snap.offense_pct,errors='coerce')
        snap=snap[snap.offense_pct.between(0,100)]
        mapping=roster[['gsis_id','pfr_id']].dropna().copy()
        mapping['pfr_id']=mapping.pfr_id.astype(str)
        mapping=mapping.drop_duplicates('pfr_id',keep=False)
        snap=snap.merge(mapping,left_on='pfr_player_id',right_on='pfr_id',how='inner')
        if not snap.empty:
            positive=snap[snap.offense_pct>0]
            snap_weeks_by_player={(str(t),str(pid)):set(int(w) for w in group.week)
                for (t,pid),group in positive.groupby(['team','gsis_id'])}
            snap_share_by_player={(str(t),str(pid)):mean(v) for (t,pid),v in
                positive.groupby(['team','gsis_id']).offense_pct.mean().items()}
    # Actual appearances: positive offensive snaps, including zero-yard games.
    appearance_games={}
    if snap_counts is not None and not snap_counts.empty and 'pfr_id' in roster.columns:
        all_snaps=snap_counts.copy()
        all_snaps=all_snaps[(pd.to_numeric(all_snaps.season,errors='coerce')==SEASON)&
            (pd.to_numeric(all_snaps.week,errors='coerce')<week)]
        all_snaps['offense_pct']=pd.to_numeric(all_snaps.offense_pct,errors='coerce')
        all_snaps=all_snaps[all_snaps.offense_pct>0]
        id_map=roster[['gsis_id','pfr_id']].dropna().drop_duplicates('pfr_id',keep=False)
        all_snaps=all_snaps.merge(id_map,left_on='pfr_player_id',right_on='pfr_id',how='inner')
        for (tm,pid),group in all_snaps.groupby(['team','gsis_id']):
            appearance_games[(str(tm),str(pid))]=set(int(w) for w in group.week)
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
    # Jersey numbers from nflverse weekly roster snapshots, keyed by GSIS player ID.
    jersey_by_player={}
    if weekly_rosters is not None and not weekly_rosters.empty and {'gsis_id','week','jersey_number'}.issubset(weekly_rosters.columns):
        jerseys=weekly_rosters.copy()
        if 'season' in jerseys: jerseys=jerseys[pd.to_numeric(jerseys.season,errors='coerce')==SEASON]
        jerseys=jerseys[pd.to_numeric(jerseys.week,errors='coerce')<=week]
        jerseys=jerseys.sort_values('week').dropna(subset=['gsis_id','jersey_number']).drop_duplicates('gsis_id',keep='last')
        for _,jr in jerseys.iterrows():
            try:
                number=int(jr.jersey_number)
                if 0<=number<=99: jersey_by_player[str(jr.gsis_id)]=number
            except (ValueError,TypeError,OverflowError):
                pass
    nonactive_codes={'RES','DEV','CUT','RET','EXE','TRD','TRT'}
    result=[]
    excluded={'out_report':0,'unavailable_roster':0,'nonactive_weekly_roster':0}
    for _,game in slate.iterrows():
        for team,opp in [(game.home_team,game.away_team),(game.away_team,game.home_team)]:
            team=str(team);opp=str(opp)
            og=offense_games.get(team,0); dg=defense_games.get(opp,0)
            games=og
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
                # Verify player participation from positive offensive snap share.
                # Without snap evidence, retain the explicit team-game rate.
                team_series=player_game_series.get((team,pid),[])
                snap_weeks=snap_weeks_by_player.get((team,pid))
                snap_verified=bool(snap_weeks) and all(
                    (g['week'] in snap_weeks) or
                    not any(g.get(metric,0) for metric in
                        ('passYards','rushYards','recYards','receptions',
                         'passAttempts','rushAttempts','targets','rzChances'))
                    for g in team_series)
                player_series=[g for g in team_series if g['week'] in snap_weeks] if snap_verified else team_series
                pg=len(player_series) if snap_verified else og
                if pg<1: continue
                share=100*player_events[(team,pid)]/team_events[team]
                health=injury_status.get(pid,'ROSTER_ACTIVE' if weekly_roster_codes.get(pid)=='ACT' else 'UNVERIFIED')
                result.append({'player_id':pid,'availability':health,'player':p.player,'jersey_number':jersey_by_player.get(pid),'pos':position,'team':team,'opp':opp,
                    'games':pg,'teamGames':og,'playerAppearancesVerified':snap_verified,
                    'teamTargetsTotal':int(team_targets.get(team,0)),
                    'teamRzChancesTotal':int(team_events.get(team,0)),
                    'tdallowed':mean(player_td.get((opp,position),0)/dg),
                    'rzallowed':mean(def_opp[(opp,position)]/dg),
                    'rzshare':mean(share),'playerRz':mean(player_events[(team,pid)]/pg),
                    'defRecYardsAllowed':mean(defense_position_yards.get((opp,position),0)/dg) if receiving_available and position!='QB' else None,
                    'defTargetsAllowed':mean(defense_position_targets.get((opp,position),0)/dg) if position!='QB' else None,
                    'defRzTargetsAllowed':mean(defense_position_rz_targets.get((opp,position),0)/dg) if position!='QB' else None,
                    'playerTargets':mean(player_targets.get((team,pid),0)/pg) if position!='QB' else None,
                    'playerTargetShare':mean(100*player_targets.get((team,pid),0)/team_targets[team]) if position!='QB' and team_targets.get(team,0)>0 else None,
                    'playerRzTargets':mean(player_rz_targets.get((team,pid),0)/pg) if position!='QB' else None,
                    'snapShare':snap_share_by_player.get((team,pid)),
                    'last5GameStats':player_series,
                    'gameSampleDefinition':'snap_verified_appearances' if snap_verified else 'team_games; participation unverified',
                    'playerPassYards':mean(player_pass_yards.get((team,pid),0)/pg) if position=='QB' else None,
                    'playerPassAttempts':mean(player_pass_attempts.get((team,pid),0)/pg) if position=='QB' else None,
                    'defPassYardsAllowed':mean(defense_pass_yards.get(opp,0)/dg) if position=='QB' else None,
                    'defPassAttemptsAllowed':mean(defense_pass_attempts.get(opp,0)/dg) if position=='QB' else None,
                    'playerRushYards':mean(player_rush_yards.get((team,pid),0)/pg),
                    'playerCarries':mean(player_carries.get((team,pid),0)/pg),
                    'defRushYardsAllowed':mean(defense_rush_yards.get((opp,position),0)/dg),
                    'defRushAttemptsAllowed':mean(defense_rush_attempts.get((opp,position),0)/dg),
                    'playerRecYards':mean(player_rec_yards.get((team,pid),0)/pg) if position!='QB' else None,
                    'playerReceptions':mean(player_receptions.get((team,pid),0)/pg) if position!='QB' else None,
                    'defReceptionsAllowed':mean(defense_receptions.get((opp,position),0)/dg) if position!='QB' else None,
                    'recent3Games':last_counts.get(team,0),
                    'recent3Targets':mean(last_target_counts.get((team,pid),0)/last_counts[team]) if last_counts.get(team) else None,
                    'recent3Carries':mean(last_carry_counts.get((team,pid),0)/last_counts[team]) if last_counts.get(team) else None,
                    'recent3PassAttempts':mean(last_pass_counts.get((team,pid),0)/last_counts[team]) if last_counts.get(team) and position=='QB' else None,
                    'recent3PassYards':mean(last_pass_yards.get((team,pid),0)/last_counts[team]) if last_counts.get(team) and position=='QB' else None,
                    'recent3RushYards':mean(last_rush_yards.get((team,pid),0)/last_counts[team]) if last_counts.get(team) else None,
                    'recent3RecYards':mean(last_rec_yards.get((team,pid),0)/last_counts[team]) if last_counts.get(team) and position!='QB' else None,
                    'recent3Receptions':mean(last_catches.get((team,pid),0)/last_counts[team]) if last_counts.get(team) and position!='QB' else None,
                    'opponentOffenseBaselinePass':opponent_baseline(opp,position,'PASS') if position=='QB' else None,
                    'opponentOffenseBaselineRush':opponent_baseline(opp,position,'RUSH'),
                    'opponentOffenseBaselineRec':opponent_baseline(opp,position,'REC') if position!='QB' else None,
                    'opponentOffenseBaselineCatch':opponent_baseline(opp,position,'CATCH') if position!='QB' else None,
                    'injuryReportStatus':injury_status.get(pid,'NOT_REPORTED'),
                    'goalLine5':mean(player_inside5.get((team,pid),0)/pg),
                    'recentRz2':mean(recent_player_events.get((team,pid),0)/recent_offense_games[team]) if recent_offense_games.get(team,0)>0 else None,
                    'recentRz2Games':int(recent_offense_games.get(team,0)),
                    'odds':'','prob':'','market':'ATD',
                    'notes':f'Availability: {health} (ROSTER_ACTIVE means listed on active roster, NOT cleared for game day; UNVERIFIED does not mean active). nflverse play-by-play; {SEASON} weeks {max(1,week-WINDOW)}-{week-1}; red-zone rushes + intended targets; position verified by roster; no odds or calibrated TD probability. Player RZ share is share of recorded team red-zone rushes and intended targets (not all plays). Goal-line metric counts recorded rushes and intended targets from opponent 5 or closer per played team game; informational only, not part of the ranking score.'})
    if not result: raise RuntimeError('No matchup records passed source and sample validation')
    result.sort(key=lambda r:(r['team'],r['pos'],r['player']))
    (OUT/'defense_stats_audit.json.tmp').write_text(json.dumps(audit,indent=2))
    return result, {'season':SEASON,'week':week,'generated_at':now.isoformat(),
                    'matchups':len(result),'source':'nflverse play-by-play and rosters',
                    'odds_source':None,'probability_model':None,
                    'lookback_games':WINDOW,'availability_diagnostics':{'injuries':injury_diagnostics,'weekly_rosters':weekly_diagnostics,'excluded':excluded,'unverified_output':sum(r['availability']=='UNVERIFIED' for r in result)},'injury_policy':'Current-week OUT excluded; doubtful/questionable flagged; weekly RES/DEV/CUT/RET/EXE/TRD/TRT excluded. ROSTER_ACTIVE only confirms active roster membership, not game-day clearance; late inactives unverified.','status':'ready'}

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
    try:
        snap_counts=frame(nfl.load_snap_counts([SEASON]))
    except Exception as exc:
        print(f'Snap counts unavailable; leaving snap share blank: {exc}',file=sys.stderr)
        snap_counts=None
    result,meta=build(pbp,schedules,rosters,injuries=injuries,weekly_rosters=weekly_rosters,snap_counts=snap_counts)
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
    # Report snapshot readiness for the current week; never silently claim
    # a post-kickoff capture is eligible for prediction accuracy.
    slate=schedules[(pd.to_numeric(schedules.season,errors='coerce')==SEASON)&(pd.to_numeric(schedules.week,errors='coerce')==meta['week'])&(schedules.game_type.astype(str).str.upper()=='REG')]
    first_day=pd.to_datetime(slate.gameday,errors='coerce',utc=True).min() if not slate.empty else pd.NaT
    snapshot_state={'exists':snapshot.exists(),'accuracy_eligible':False,'captured_at':None,'candidate_count':0,'challenger_features_complete':False}
    if snapshot.exists():
        try:
            frozen=json.loads(snapshot.read_text())
            captured=pd.to_datetime(frozen.get('captured_at'),errors='coerce',utc=True)
            frozen_players=frozen.get('players',[])
            snapshot_state.update({'captured_at':frozen.get('captured_at'),'candidate_count':len(frozen_players),
                'accuracy_eligible':bool(not pd.isna(first_day) and not pd.isna(captured) and captured<first_day),
                'challenger_features_complete':bool(frozen_players and all(p.get('goalLine5') is not None and p.get('recentRz2') is not None for p in frozen_players if p.get('availability')=='ROSTER_ACTIVE'))})
        except (ValueError,TypeError,KeyError) as exc:
            print(f'Invalid frozen snapshot: {exc}',file=sys.stderr)
    snapshot_state['readiness']='ELIGIBLE' if snapshot_state['accuracy_eligible'] and snapshot_state['challenger_features_complete'] else ('BASELINE_ONLY' if snapshot_state['accuracy_eligible'] else 'NOT_ELIGIBLE')
    if snapshot_state['readiness']=='ELIGIBLE':
        print(f"MODEL BATTLE READY: Week {meta['week']} frozen before first game day with experimental features for all roster-active candidates")
    else:
        print(f"MODEL BATTLE NOT READY: Week {meta['week']} status={snapshot_state['readiness']}; capture={snapshot_state['captured_at']}; frozen_candidates={snapshot_state['candidate_count']}",file=sys.stderr)
    snapshot_state['first_game_day_utc']=first_day.isoformat() if not pd.isna(first_day) else None
    snapshot_state['next_action']='WAIT_FOR_NEXT_WEEK' if snapshot.exists() and not snapshot_state['accuracy_eligible'] else ('READY_FOR_GRADING' if snapshot_state['accuracy_eligible'] and snapshot_state['challenger_features_complete'] else ('WAIT_FOR_COMPLETE_FEATURES' if snapshot_state['accuracy_eligible'] else 'AWAIT_PREGAME_CAPTURE'))
    meta['snapshot_diagnostics']=snapshot_state
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
    (OUT/'defense_stats_audit.json.tmp').replace(OUT/'defense_stats_audit.json')
    print(f'Published {len(result)} verified records for {SEASON} week {meta["week"]}')

if __name__=='__main__':
    try: main()
    except Exception as exc:
        print(f'FEED UPDATE FAILED (existing published data preserved): {exc}',file=sys.stderr)
        sys.exit(1)
