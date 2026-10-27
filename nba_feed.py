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
  season_type=(event.get("season") or {}).get("type")
  game={"id":event["id"],"date":event.get("date"),"status":status,"season_type":season_type,"home":next((x["team"]["displayName"] for x in teams if x.get("homeAway")=="home"),""),"away":next((x["team"]["displayName"] for x in teams if x.get("homeAway")=="away"),""),"players":[]}
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
# ESPN can intermittently omit a future date from the scoreboard. Preserve previously
# published scheduled events for the next four days rather than erase the slate.
if OUT.exists():
 try:
  previous=json.loads(OUT.read_text()).get("games",[])
  now=datetime.datetime.now(datetime.timezone.utc)
  for old in previous:
   if old.get("id") in seen_events or old.get("status")!="STATUS_SCHEDULED":continue
   try:tip=datetime.datetime.fromisoformat(old["date"].replace("Z","+00:00"))
   except (ValueError,KeyError,AttributeError):continue
   if now<=tip<=now+datetime.timedelta(days=4):
    games.append(old)
    seen_events.add(old["id"])
    print("Preserved missing scheduled event",old["id"],old.get("away"),"@",old.get("home"))
 except (OSError,ValueError,TypeError) as e:print("previous feed fallback unavailable",str(e))
if scoreboards_ok==0 or not games:
 print("NBA feed failure: no valid scoreboards or games; refusing to publish empty feed",file=sys.stderr)
 sys.exit(1)
OUT.parent.mkdir(parents=True,exist_ok=True)
OUT.write_text(json.dumps({"generated_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"source":"ESPN public NBA scoreboard/summary","games":games},separators=(",",":")))
print("Wrote",len(games),"games",sum(len(g["players"]) for g in games),"player records")
# Season-to-date pregame averages from completed ESPN box scores.
# Avoid unverified athlete endpoint shapes and publish only observed stats.
season_start=datetime.datetime(today.year-(today.month<10),10,1,tzinfo=datetime.timezone.utc)
season_rows={}
for game in games:
 if game["status"]!="STATUS_FINAL":continue
 try:game_date=datetime.datetime.fromisoformat(game["date"].replace("Z","+00:00"))
 except (ValueError,AttributeError):continue
 if game_date<season_start:continue
 for player in game["players"]:
  if player.get("didNotPlay") or not player.get("id"):continue
  stats=player.get("stats") or {}
  values={}
  for key,source in (("avgPoints","PTS"),("avgRebounds","REB"),("avgAssists","AST"),("avgMinutes","MIN")):
   raw=stats.get(source)
   try:
    if source=="MIN" and ":" in str(raw):
     mm,ss=str(raw).split(":",1)
     values[key]=float(mm)+float(ss)/60
    else:values[key]=float(raw)
   except (TypeError,ValueError):pass
  raw=stats.get("3PM",stats.get("3PT"))
  try:values["avgThreePointFieldGoalsMade"]=float(str(raw).split("-")[0])
  except (TypeError,ValueError):pass
  if len(values)<4:continue
  season_rows.setdefault(str(player["id"]),[]).append(values)
season_players={}
for pid,rows in season_rows.items():
 season_players[pid]={k:round(sum(r[k] for r in rows if k in r)/sum(k in r for r in rows),2) for k in rows[0] if any(k in r for r in rows)}
 season_players[pid]["games"]=len(rows)
if season_players:
 (ROOT/"data"/"nba_season_stats.json").write_text(json.dumps({"generated_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"season":season_start.year+1,"source":"ESPN final box scores; observed season-to-date sample","players":season_players},separators=(",",":")))
 print("Published observed season averages for",len(season_players),"players")
else:print("No completed season box scores; retaining existing season stats")
