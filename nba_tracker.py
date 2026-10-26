#!/usr/bin/env python3
"""Freeze NBA pregame projections, then grade them from final box scores.
Historical averages are baseline research, not calibrated probabilities.
"""
import json, pathlib, datetime, statistics
root=pathlib.Path(__file__).resolve().parent
feed=json.loads((root/"data/nba_games.json").read_text())
games=feed["games"]
now=datetime.datetime.now(datetime.timezone.utc)
out=root/"data"/"nba_projection_tracker.json"
existing=json.loads(out.read_text()) if out.exists() else {"snapshots":[]}
snapshots=existing["snapshots"]
seen={s["game_id"] for s in snapshots}
def value(p,k):
 try:
  v=p.get("stats",{}).get(k)
  if v is None:return None
  return float(v)
 except (ValueError,TypeError):return None
def mins(p):
 raw=p.get("stats",{}).get("MIN")
 try:
  if ":" in str(raw):
   m,s=map(float,str(raw).split(":"));return m+s/60
  return float(raw)
 except (ValueError,TypeError):return 0
def dt(g):return datetime.datetime.fromisoformat(g["date"].replace("Z","+00:00"))
finals=sorted((g for g in games if g["status"]=="STATUS_FINAL"),key=dt)
for g in games:
 if g["id"] in seen or g["status"]!="STATUS_SCHEDULED":continue
 if not now<dt(g):continue
 if (dt(g)-now).total_seconds()>48*3600:continue
 history=[h for h in finals if dt(h)<now and dt(h)<dt(g)]
 byid={}
 for h in reversed(history):
  for p in h["players"]:
   if p.get("didNotPlay") or p.get("team") not in (g["home"],g["away"]) or mins(p)<5:continue
   pid=str(p.get("id") or "")
   if not pid:continue
   arr=byid.setdefault(pid,[])
   if len(arr)<5:arr.append(p)
 projections=[]
 for pid,rows in byid.items():
  if len(rows)<3:continue
  if statistics.mean(mins(p) for p in rows)<15:continue
  for market,key in (("points","PTS"),("rebounds","REB"),("assists","AST"),("threes","3PM")):
   vals=[value(p,key) for p in rows]
   if any(v is None for v in vals):continue
   projections.append({"player_id":pid,"player":rows[0]["name"],"team":rows[0]["team"],"market":market,"projection":round(statistics.mean(vals),2),"sample":len(vals),"actual":None,"result":"pending"})
 if projections:
  snapshots.append({"game_id":g["id"],"game":g["away"]+" @ "+g["home"],"tipoff":g["date"],"locked_at":now.isoformat(),"model":"last-five-mean-v1","projections":projections})
  seen.add(g["id"])
for s in snapshots:
 match=next((g for g in games if g["id"]==s["game_id"] and g["status"]=="STATUS_FINAL"),None)
 if not match:continue
 players={str(p.get("id")):p for p in match["players"]}
 for p in s["projections"]:
  if p["result"]!="pending":continue
  actual=value(players.get(p["player_id"],{}),{"points":"PTS","rebounds":"REB","assists":"AST","threes":"3PM"}[p["market"]])
  if players.get(p["player_id"],{}).get("didNotPlay") or (p["player_id"] in players and mins(players[p["player_id"]])<1):
   p["result"]="dnp"
  elif actual is None:
   p["result"]="ungraded"
  else:
   p["actual"]=actual
   p["result"]="within_20pct" if abs(actual-p["projection"])<=max(2,p["projection"]*.2) else "outside_20pct"
out.parent.mkdir(parents=True,exist_ok=True)
out.write_text(json.dumps({"updated_at":now.isoformat(),"methodology":"Predictions frozen before tipoff; grade by absolute error tolerance max(2,20% of projection). Not betting hit rate.","snapshots":snapshots},separators=(",",":")))
print("NBA frozen snapshots",len(snapshots),"graded projections",sum(p["result"]!="pending" for s in snapshots for p in s["projections"]))
