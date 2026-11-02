#!/usr/bin/env python3
"""Free NBA.com lineups/tracking + ESPN availability. Never infer confirmed starters."""
import concurrent.futures,datetime,json,pathlib,urllib.request,urllib.parse,unicodedata,re
from zoneinfo import ZoneInfo
ROOT=pathlib.Path(__file__).resolve().parent
LINEUPS='https://stats.nba.com/js/data/leaders/00_daily_lineups_{day}.json'
DEFENSE='https://stats.nba.com/stats/leaguedashptdefend'
MATCHUPS='https://stats.nba.com/stats/leagueseasonmatchups'
def norm(x):return re.sub('[^a-z0-9]','',unicodedata.normalize('NFKD',str(x)).encode('ascii','ignore').decode().lower())
def fetch(url):
 req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0','Referer':'https://www.nba.com/','Accept':'application/json'})
 with urllib.request.urlopen(req,timeout=20) as r:return json.load(r)
def table(data):
 out=[]
 for t in data.get('resultSets',[]):
  out.extend(dict(zip(t['headers'],r)) for r in t.get('rowSet',[]))
 return out
def parse_lineup(team):
 # NBA publishes a five-player positional projection and separate confirmed roster
 # records. A confirmed roster is NOT a confirmed starting five.
 records=team.get('players',[]);pos={};roster={}
 for p in sorted(records,key=lambda p:p.get('timestamp','')):
  pid=str(p.get('personId',''));name=p.get('playerName','')
  if not pid or not name:continue
  row={'nba_id':pid,'name':name,'position':p.get('position',''),'status':p.get('lineupStatus',''),'availability':p.get('rosterStatus',''),'source_timestamp':p.get('timestamp','')}
  if row['position']:pos[pid]=row
  if row['status']=='Confirmed' and row['availability'] in ('Active','Inactive'):roster[pid]=row
 starters=[p for pid,p in pos.items() if roster.get(pid,{}).get('availability')!='Inactive'];confirmed=len(starters)==5 and all(p['status']=='Confirmed' and p['availability']=='Active' for p in starters)
 return {'status':'CONFIRMED' if confirmed else 'EXPECTED' if len(starters)==5 else 'UNAVAILABLE','starters':starters if len(starters)==5 else [],'roster':list(roster.values())}
def collect(root=ROOT,now=None,loader=fetch):
 now=now or datetime.datetime.now(datetime.timezone.utc);stamp=now.isoformat();day=now.astimezone(ZoneInfo('America/New_York')).date();season=day.year-(day.month<10);season=f'{season}-{str(season+1)[-2:]}'
 data=pathlib.Path(root)/'data';feed=json.loads((data/'nba_games.json').read_text());old={}
 try:old=json.loads((data/'nba_game_context.json').read_text())
 except (OSError,ValueError):pass
 payload={'generated_at':stamp,'season':season,'sources':{},'games':{},'defenders':{},'matchups':[],'limits':['Historical defensive matchups estimate exposure; they do not confirm tonight’s assignments.','Historical quarter rotations describe team substitution patterns, not announced coaching plans.']}
 def task(key,url):
  try:return key,loader(url),None
  except Exception as e:return key,None,type(e).__name__+': source unavailable'
 urls={'lineups':LINEUPS.format(day=day.strftime('%Y%m%d'))}
 # Tracking changes after completed games, not every five-minute lineup refresh.
 tracked=old.get('sources',{}).get('tracking',{});same_day=str(tracked.get('retrieved_at',''))[:10]==str(now.date()) and old.get('season')==season
 if not same_day:
  q={'College':'','Conference':'','Country':'','DateFrom':'','DateTo':day.strftime('%m/%d/%Y'),'DefenseCategory':'Overall','DraftPick':'','DraftYear':'','GameSegment':'','Height':'','LastNGames':0,'LeagueID':'00','Location':'','Month':0,'OpponentTeamID':0,'Outcome':'','PORound':0,'PerMode':'PerGame','Period':0,'PlayerExperience':'','PlayerID':0,'PlayerPosition':'','Season':season,'SeasonSegment':'','SeasonType':'Regular Season','StarterBench':'','TeamID':0,'VsConference':'','VsDivision':'','Weight':''}
  urls['defense']=DEFENSE+'?'+urllib.parse.urlencode(q)
  urls['matchups']=MATCHUPS+'?'+urllib.parse.urlencode({'DefPlayerID':'','DefTeamID':'','LeagueID':'00','OffPlayerID':'','OffTeamID':'','PerMode':'Totals','Season':season,'SeasonType':'Regular Season'})
 results={k:(d,e) for k,d,e in concurrent.futures.ThreadPoolExecutor(3).map(lambda item:task(*item),urls.items())}
 lineup,err=results['lineups'];payload['sources']['lineups']={'status':'ok' if lineup else 'unavailable','retrieved_at':stamp,'url':urls['lineups'],'error':err}
 # Exact same-date / same-teams join to ESPN events; never join by player alone.
 upcoming=[g for g in feed.get('games',[]) if g.get('status')=='STATUS_SCHEDULED' and datetime.datetime.fromisoformat(g['date'].replace('Z','+00:00')).astimezone(ZoneInfo('America/New_York')).date()==day]
 for official in (lineup or {}).get('games',[]):
  sides=[official.get('awayTeam',{}),official.get('homeTeam',{})]
  # Daily lineups carries team IDs/abbreviations, joined to NBA team code map.
  codes={'ATL':'Atlanta Hawks','BOS':'Boston Celtics','BKN':'Brooklyn Nets','CHA':'Charlotte Hornets','CHI':'Chicago Bulls','CLE':'Cleveland Cavaliers','DAL':'Dallas Mavericks','DEN':'Denver Nuggets','DET':'Detroit Pistons','GSW':'Golden State Warriors','HOU':'Houston Rockets','IND':'Indiana Pacers','LAC':'LA Clippers','LAL':'Los Angeles Lakers','MEM':'Memphis Grizzlies','MIA':'Miami Heat','MIL':'Milwaukee Bucks','MIN':'Minnesota Timberwolves','NOP':'New Orleans Pelicans','NYK':'New York Knicks','OKC':'Oklahoma City Thunder','ORL':'Orlando Magic','PHI':'Philadelphia 76ers','PHX':'Phoenix Suns','POR':'Portland Trail Blazers','SAC':'Sacramento Kings','SAS':'San Antonio Spurs','TOR':'Toronto Raptors','UTA':'Utah Jazz','WAS':'Washington Wizards'}
  away,home=[codes.get(t.get('teamAbbreviation')) for t in sides];matches=[g for g in upcoming if g['home']==home and g['away']==away]
  if len(matches)!=1 or official.get('gameStatus')!=1:continue
  g=matches[0];payload['games'][str(g['id'])]={'nba_game_id':official.get('gameId'),'tipoff':g['date'],'observed_at':stamp,'teams':{away:parse_lineup(sides[0]),home:parse_lineup(sides[1])}}
 if same_day:
  payload['defenders']=old.get('defenders',{});payload['matchups']=old.get('matchups',[]);payload['sources']['tracking']=tracked
 else:
  defense,de=results.get('defense',(None,'unavailable'));pairs,pe=results.get('matchups',(None,'unavailable'))
  for r in table(defense or {}):
   pid=str(r.get('CLOSE_DEF_PERSON_ID',''));attempts=float(r.get('D_FGA') or 0)*float(r.get('G') or 0)
   if pid and attempts>=1 and isinstance(r.get('PCT_PLUSMINUS'),(int,float)):
    payload['defenders'][pid]={'name':r['PLAYER_NAME'],'team':r.get('PLAYER_LAST_TEAM_ABBREVIATION'),'position':r.get('PLAYER_POSITION',''),'shots':attempts,'diff':r['PCT_PLUSMINUS']}
  payload['matchups']=[{'off':str(r['OFF_PLAYER_ID']),'def':str(r['DEF_PLAYER_ID']),'poss':r['PARTIAL_POSS'],'fga':r['MATCHUP_FGA'],'fgm':r['MATCHUP_FGM']} for r in table(pairs or {}) if float(r.get('PARTIAL_POSS') or 0)>=5]
  payload['sources']['tracking']={'status':'ok' if payload['defenders'] and payload['matchups'] else 'partial' if payload['defenders'] else 'unavailable','retrieved_at':stamp,'urls':[urls.get('defense'),urls.get('matchups')],'error':de or pe}
 # A current injury snapshot is atomic with this context, with its actual timestamp.
 try:payload['availability']=json.loads((data/'nba_injuries.json').read_text())
 except (OSError,ValueError):payload['availability']=None
 p=data/'nba_game_context.json';tmp=p.with_suffix('.tmp');tmp.write_text(json.dumps(payload,separators=(',',':')));tmp.replace(p)
 return payload
if __name__=='__main__':
 d=collect();print('NBA context:',len(d['games']),'games;',len(d['defenders']),'defenders;',len(d['matchups']),'historical matchup pairs')
