#!/usr/bin/env python3
"""Fetch ESPN's public NBA injury feed. Missing data is unknown, never healthy."""
import datetime,json,pathlib,urllib.request,sys,time
ROOT=pathlib.Path(__file__).resolve().parent
URL="https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries"
def normalize(payload):
 if not isinstance(payload,dict) or not isinstance(payload.get("injuries"),list):
  raise ValueError("ESPN injury response missing injuries list")
 rows=[]
 for item in payload["injuries"]:
  if not isinstance(item,dict):continue
  # ESPN league-wide endpoint has historically used both team-grouped and flat entries.
  group=item.get("injuries") if isinstance(item.get("injuries"),list) else [item]
  team=item.get("team") or {}
  for injury in group:
   if not isinstance(injury,dict):continue
   athlete=injury.get("athlete") or item.get("athlete") or {}
   if not isinstance(athlete,dict):continue
   status=injury.get("status") or item.get("status") or ""
   if isinstance(status,dict):status=status.get("displayName") or status.get("name") or status.get("description") or ""
   detail=injury.get("details") or {}
   rows.append({"player_id":str(athlete.get("id") or ""),"player":athlete.get("displayName") or athlete.get("fullName") or "","team":(team.get("displayName") if isinstance(team,dict) else str(team)) or "","status":str(status),"date":injury.get("date") or "","note":str(detail.get("shortComment") or injury.get("shortComment") or "")[:300]})
 return [x for x in rows if x["player_id"] and x["player"]]
def fetch(url):
 req=urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0 (compatible; PropVault/1.0)","Accept":"application/json"})
 with urllib.request.urlopen(req,timeout=20) as response:return json.load(response)
def team_fallback():
 teams=fetch("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams").get("sports",[])
 entries=[]
 for sport in teams:
  for league in sport.get("leagues",[]):entries.extend(league.get("teams",[]))
 if len(entries)<20:raise ValueError("NBA team directory incomplete")
 rows=[];successful=0
 for entry in entries:
  team=entry.get("team",entry);tid=team.get("id")
  if not tid:continue
  try:
   payload=fetch("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/"+str(tid)+"/injuries")
   successful+=1
   for row in normalize(payload):
    if not row["team"]:row["team"]=team.get("displayName","")
    rows.append(row)
  except Exception as exc:print("Team injury source",tid,str(exc),file=sys.stderr)
  time.sleep(.15)
 if successful<20:raise ValueError("Too few team injury responses: "+str(successful))
 return rows,successful
def main():
 try:
  rows=[];method="league";teams_checked=0
  try:rows=normalize(fetch(URL))
  except Exception as exc:print("League injury source:",exc,file=sys.stderr)
  if not rows:
   rows,teams_checked=team_fallback()
   method="teams"
  if not rows:raise ValueError("No usable injury records across sources; refusing to publish")
  rows=list({(row["player_id"],row["status"]):row for row in rows}.values())
  output={"generated_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"source":"ESPN NBA injuries (unofficial, not NBA official injury report)","status":"ok","method":method,"teams_checked":teams_checked,"injuries":rows}
  path=ROOT/"data/nba_injuries.json";path.parent.mkdir(exist_ok=True)
  path.write_text(json.dumps(output,separators=(",",":")))
  print("Wrote",len(rows),"NBA injury reports")
 except Exception as exc:
  # Retain prior file for audit; UI must reject stale timestamps.
  print("NBA injury refresh failed:",exc,file=sys.stderr)
  sys.exit(1)
if __name__=="__main__":main()
