#!/usr/bin/env python3
"""NBA data feed: ESPN public scoreboard and summary. No API keys required."""
import json,urllib.request,datetime,pathlib,time,sys
ROOT=pathlib.Path(__file__).resolve().parent
OUT=ROOT/"data"/"nba_games.json"
def get(url):
 req=urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0 (compatible; PropVault/1.0)","Accept":"application/json"})
 with urllib.request.urlopen(req,timeout=25) as r:return json.load(r)
today=datetime.datetime.now(datetime.timezone.utc).date()
games=[]
seen_events=set()
scoreboards_ok=0
for delta in range(-35,4):
 date=(today+datetime.timedelta(days=delta)).strftime("%Y%m%d")
 try: board=get("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates="+date)
 except Exception as e: print("scoreboard",date,str(e));continue
 scoreboards_ok+=1
 for event in board.get("events",[]):
  if event.get("id") in seen_events:continue
  seen_events.add(event.get("id"))
  competition=(event.get("competitions") or [{}])[0]
  teams=competition.get("competitors",[])
  if len(teams)!=2:continue
  status=event.get("status",{}).get("type",{}).get("name","")
  game={"id":event["id"],"date":event.get("date"),"status":status,"home":next((x["team"]["displayName"] for x in teams if x.get("homeAway")=="home"),""),"away":next((x["team"]["displayName"] for x in teams if x.get("homeAway")=="away"),""),"players":[]}
  try:
   if status not in ("STATUS_FINAL","STATUS_IN_PROGRESS"): raise ValueError("pregame box score unavailable")
   detail=get("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event="+event["id"])
   for team in detail.get("boxscore",{}).get("players",[]):
    teamname=team.get("team",{}).get("displayName","")
    for group in team.get("statistics",[]):
     labels=group.get("labels",[])
     for athlete in group.get("athletes",[]):
      stats=dict(zip(labels,athlete.get("stats",[])))
      for label in ("3PT","3PT FG","3PT FG"):
       raw=stats.get(label)
       if isinstance(raw,str) and "-" in raw:
        try:stats["3PM"]=int(raw.split("-")[0])
        except ValueError:pass
      game["players"].append({"id":athlete.get("athlete",{}).get("id"),"name":athlete.get("athlete",{}).get("displayName"),"team":teamname,"stats":stats,"starter":athlete.get("starter",False),"didNotPlay":athlete.get("didNotPlay",False)})
  except ValueError:pass
  except Exception as e:print("summary",event["id"],str(e))
  games.append(game)
if scoreboards_ok==0 or not games:
 print("NBA feed failure: no valid scoreboards or games; refusing to publish empty feed",file=sys.stderr)
 sys.exit(1)
OUT.parent.mkdir(parents=True,exist_ok=True)
OUT.write_text(json.dumps({"generated_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"source":"ESPN public NBA scoreboard/summary","games":games},separators=(",",":")))
print("Wrote",len(games),"games",sum(len(g["players"]) for g in games),"player records")
