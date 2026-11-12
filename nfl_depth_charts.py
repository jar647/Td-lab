"""Dated ESPN depth-chart ordering, joined by exact ESPN ID and current team.

First-unit depth-chart membership is not confirmed game-day participation.
Unavailable or mismatched sources leave roles unconfirmed.
"""
import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from urllib.request import urlopen

TEAMS_URL='https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams?limit=100'
ALIASES={'WSH':'WAS','LAR':'LA','JAC':'JAX'}

def canonical_team(value):
    value=str(value or '').upper()
    return ALIASES.get(value,value)

def identifier(value):
    if isinstance(value,bool) or value is None:return None
    text=str(value).strip()
    if re.fullmatch(r'\d+(?:\.0+)?',text):return text.split('.')[0]
    return None

def parse_depth_chart(document,team,season,observed_at,source):
    team=canonical_team(team)
    if canonical_team(document.get('team',{}).get('abbreviation'))!=team:
        raise ValueError('Depth chart belongs to a different team')
    if document.get('season',{}).get('year')!=season:
        raise ValueError('Depth chart belongs to a different season')
    if document.get('status')!='success':raise ValueError('Depth chart source is not successful')
    try:
        stamp=datetime.fromisoformat(str(document['timestamp']).replace('Z','+00:00'))
        if stamp.tzinfo is None or not -300<=(observed_at-stamp).total_seconds()<=72*3600:
            raise ValueError('Depth-chart timestamp is stale or in the future')
    except (KeyError,TypeError,ValueError) as error:
        raise ValueError('Depth chart lacks a fresh dated source') from error
    players=[]
    for formation in document.get('depthchart',[]):
        for slot,position in formation.get('positions',{}).items():
            abbreviation=str(position.get('position',{}).get('abbreviation') or '').upper()
            if abbreviation not in {'QB','RB','WR','TE','FB'}:
                abbreviation=re.sub(r'\d+$','',str(slot)).upper()
            if abbreviation not in {'QB','RB','WR','TE','FB'}:continue
            for order,athlete in enumerate(position.get('athletes',[]),1):
                athlete_id=identifier(athlete.get('id'))
                if athlete_id:
                    players.append({'athleteId':athlete_id,'order':order,
                        'unit':'first' if order==1 else 'reserve',
                        'position':abbreviation,'slot':str(slot),
                        'formation':formation.get('name')})
    if not players:raise ValueError('Depth chart has no offensive skill-position ordering')
    return {'team':team,'season':season,'observedAt':observed_at.isoformat(),
        'sourceUpdatedAt':stamp.isoformat(),'source':source,'sourceStatus':'ok','players':players}

def _fetch_json(url,timeout):
    with urlopen(url,timeout=timeout) as response:return json.load(response)

def fetch_depth_charts(teams,season,now=None,fetch_json=None,timeout=8,max_workers=4):
    now=now or datetime.now(timezone.utc);fetch_json=fetch_json or _fetch_json
    teams=sorted({canonical_team(t) for t in teams})
    charts={};failures={}
    try:
        document=fetch_json(TEAMS_URL,timeout)
        mappings={}
        for sport in document.get('sports',[]):
            for league in sport.get('leagues',[]):
                for entry in league.get('teams',[]):
                    data=entry.get('team',{});team=canonical_team(data.get('abbreviation'))
                    team_id=identifier(data.get('id'))
                    if team in teams and team_id:mappings[team]=team_id
    except Exception as error:
        return {'charts':{},'diagnostics':{'status':'unavailable','requested_teams':teams,
            'covered_teams':[],'failures':{team:'Team mapping source unavailable: '+type(error).__name__ for team in teams}}}
    for team in teams:
        if team not in mappings:failures[team]='No exact ESPN team mapping'
    def fetch(team,team_id):
        url=f'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/{team_id}/depthcharts'
        return parse_depth_chart(fetch_json(url,timeout),team,season,now,url)
    with ThreadPoolExecutor(max_workers=max(1,min(4,max_workers))) as executor:
        tasks={executor.submit(fetch,team,team_id):team for team,team_id in mappings.items()}
        for task in as_completed(tasks):
            team=tasks[task]
            try:charts[team]=task.result()
            except Exception as error:failures[team]=type(error).__name__+': '+str(error)
    return {'charts':charts,'diagnostics':{'status':'ok' if len(charts)==len(teams) else 'partial' if charts else 'unavailable',
        'requested_teams':teams,'covered_teams':sorted(charts),'failures':failures}}

def apply_depth_chart_context(records,rosters,depth_charts,season):
    """Never use player names to infer an identity or overwrite curated qbRole."""
    payload=depth_charts or {'charts':{},'diagnostics':{'status':'unavailable','reason':'No depth-chart source supplied'}}
    lookup={}
    for roster in rosters:
        espn=identifier(roster.get('espn_id'));gsis=roster.get('gsis_id')
        team=canonical_team(roster.get('team'))
        if espn and gsis:lookup.setdefault((team,espn),set()).add(str(gsis))
    matched=0;first_unit=0;unmatched=0
    for record in records:
        record.pop('depthChart',None)
        team=canonical_team(record.get('team'));chart=payload.get('charts',{}).get(team)
        if not chart or chart.get('sourceStatus')!='ok' or chart.get('season')!=season or chart.get('team')!=team:continue
        possibilities=[]
        for player in chart.get('players',[]):
            ids=lookup.get((team,player.get('athleteId')),set())
            role='RB' if player.get('position')=='FB' else player.get('position')
            if len(ids)==1 and str(record.get('player_id')) in ids and record.get('pos')==role:
                possibilities.append(player)
        if not possibilities:unmatched+=1;continue
        player=min(possibilities,key=lambda p:(p['order'],p['slot']))
        record['depthChart']={**{k:player[k] for k in ('order','unit','position','slot','formation')},
            **{k:chart[k] for k in ('source','observedAt','season','sourceStatus','sourceUpdatedAt')},
            'label':'Depth-chart first unit; game-day status unconfirmed' if player['unit']=='first' else
                    'Depth-chart reserve; game-day status unconfirmed'}
        matched+=1;first_unit+=int(player['unit']=='first')
    return {**payload.get('diagnostics',{}),'matched_players':matched,
        'first_unit_players':first_unit,'unmatched_roster_players':unmatched}
