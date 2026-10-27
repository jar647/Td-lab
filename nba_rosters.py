#!/usr/bin/env python3
"""Refresh current ESPN NBA team rosters; fail safely if source is unavailable."""
import datetime,json,pathlib,urllib.request
ROOT=pathlib.Path(__file__).resolve().parent
games=json.loads((ROOT/"data/nba_games.json").read_text())["games"]
teams={}
for g in games:
 for side in ("home","away"):
  name=g.get(side)
  if name:teams[name]=None
for g in games:
 for side in ("home","away"):
  name=g.get(side)
  if name and teams[name] is None:
   # Team identifiers come from ESPN's scoreboard in a separate lookup below.
   pass
req=urllib.request.Request("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams",headers={"User-Agent":"Mozilla/5.0"})
with urllib.request.urlopen(req,timeout=25) as response:listing=json.load(response)
entries=listing.get("sports",[{}])[0].get("leagues",[{}])[0].get("teams",[])
count=0
for item in entries:
 team=item.get("team",{})
 name=team.get("displayName")
 if name not in teams:continue
 try:
  url="https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/"+str(team["id"])+"/roster"
  with urllib.request.urlopen(urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0"}),timeout=20) as response:data=json.load(response)
  athletes=data.get("athletes",[])
  if isinstance(athletes,dict):athletes=[a for group in athletes.values() for a in group]
  ids=[str(a["id"]) for a in athletes if isinstance(a,dict) and a.get("id")]
  if len(ids)>=8:teams[name]=ids;count+=1
 except Exception as exc:print("Roster unavailable",name,str(exc))
if count<20:raise RuntimeError("Insufficient roster coverage; keeping prior published roster file")
(ROOT/"data/nba_rosters.json").write_text(json.dumps({"generated_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"source":"ESPN team rosters","teams":teams},separators=(",",":")))
print("Verified rosters",count)
