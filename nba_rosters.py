#!/usr/bin/env python3
"""Refresh ESPN rosters and sourced primary positions; preserve the ID contract."""
import datetime,json,pathlib,urllib.request
ROOT=pathlib.Path(__file__).resolve().parent

def parse_roster(data,team):
 athletes=data.get('athletes',[])
 if isinstance(athletes,dict):athletes=[a for group in athletes.values() for a in group]
 players={}
 for a in athletes:
  if not isinstance(a,dict) or not a.get('id'):continue
  pos=a.get('position') or {}
  players[str(a['id'])]={'name':a.get('displayName') or a.get('fullName'),'team':team,'position':(pos.get('abbreviation') or pos.get('displayName') or pos.get('name')) if isinstance(pos,dict) else str(pos),'position_name':pos.get('displayName') or pos.get('name') if isinstance(pos,dict) else str(pos)}
 return list(players),players

def get(url,timeout=25):
 req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'})
 with urllib.request.urlopen(req,timeout=timeout) as response:return json.load(response)

def publish(root=ROOT):
 games=json.loads((root/'data/nba_games.json').read_text())['games'];teams={g[s]:None for g in games for s in ('home','away') if g.get(s)};players={}
 listing=get('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams')
 entries=listing.get('sports',[{}])[0].get('leagues',[{}])[0].get('teams',[]);count=0
 for item in entries:
  team=item.get('team',{});name=team.get('displayName')
  if name not in teams:continue
  try:
   ids,records=parse_roster(get('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/'+str(team['id'])+'/roster',20),name)
   if len(ids)>=8:teams[name]=ids;players.update(records);count+=1
  except Exception as exc:print('Roster unavailable',name,str(exc))
 if count<20:raise RuntimeError('Insufficient roster coverage; keeping prior published roster file')
 out={'generated_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':'ESPN team rosters','teams':teams,'players':players}
 target=root/'data/nba_rosters.json';temp=target.with_suffix('.tmp');temp.write_text(json.dumps(out,separators=(',',':')));temp.replace(target)
 print('Verified rosters',count,'players',len(players),'detailed positions',sum(p['position'] in ('PG','SG','SF','PF','C') for p in players.values()))
 return out
if __name__=='__main__':publish()
