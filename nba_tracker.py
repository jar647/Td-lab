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
# Preserve all prior locks; never recalculate a game that already has a snapshot.
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
   if len(arr)<10:arr.append(p)
 projections=[]
 for pid,rows in byid.items():
  if len(rows)<1:continue
  if statistics.mean(mins(p) for p in rows[:5])<5:continue
  avg_minutes=statistics.mean(mins(p) for p in rows[:5])
  recent_minutes=statistics.mean(mins(p) for p in rows[:3])
  minute_factor=max(.9,min(1.1,recent_minutes/max(1,avg_minutes)))
  for market,key in (("points","PTS"),("rebounds","REB"),("assists","AST"),("threes","3PM")):
   vals=[value(p,key) for p in rows[:5]]
   if any(v is None for v in vals):continue
   valid=[value(p,key) for p in rows if value(p,key) is not None][:10]
   weights=list(range(len(valid),0,-1))
   weighted=sum(v*w for v,w in zip(valid,weights))/sum(weights)
   baseline=.7*weighted+.3*statistics.mean(vals)
   projection=round(baseline*minute_factor,2)
   projections.append({"player_id":pid,"player":rows[0]["name"],"team":rows[0]["team"],"market":market,"projection":projection,"baseline":round(baseline,2),"minute_factor":round(minute_factor,3),"sample":len(vals),"actual":None,"result":"pending"})
  projections.append({"player_id":pid,"player":rows[0]["name"],"team":rows[0]["team"],"market":"minutes","projection":round(avg_minutes,2),"sample":len(rows[:5]),"actual":None,"result":"pending"})
 if projections:
  snapshots.append({"game_id":g["id"],"game":g["away"]+" @ "+g["home"],"tipoff":g["date"],"locked_at":now.isoformat(),"model":"nba-weighted-baseline-v3","projections":projections})
  seen.add(g["id"])
for s in snapshots:
 # Only games with a final ESPN result may be graded.
 match=next((g for g in games if g["id"]==s["game_id"] and g["status"]=="STATUS_FINAL"),None)
 if not match:continue
 players={str(p.get("id")):p for p in match["players"]}
 for p in s["projections"]:
  if p["result"]!="pending":continue
  actual=(mins(players[p["player_id"]]) if p["market"]=="minutes" and p["player_id"] in players else value(players.get(p["player_id"],{}),{"points":"PTS","rebounds":"REB","assists":"AST","threes":"3PM"}.get(p["market"],"MIN")))
  if players.get(p["player_id"],{}).get("didNotPlay") or (p["player_id"] in players and mins(players[p["player_id"]])<1):
   p["result"]="dnp"
  elif actual is None:
   p["result"]="ungraded"
  else:
   p["actual"]=actual
   p["result"]="within_20pct" if abs(actual-p["projection"])<=max(2,p["projection"]*.2) else "outside_20pct"
report={}
for s in snapshots:
 for p in s["projections"]:
  if p["result"] not in ("within_20pct","outside_20pct"):continue
  b=report.setdefault(s.get("model","unknown"),{}).setdefault(p["market"],{"count":0,"within":0,"abs_error":0,"signed_error":0})
  b["count"]+=1;b["within"]+=p["result"]=="within_20pct"
  b["abs_error"]+=abs(p["actual"]-p["projection"]);b["signed_error"]+=p["projection"]-p["actual"]
for model in report.values():
 for b in model.values():
  n=b["count"];b["mae"]=round(b.pop("abs_error")/n,2);b["bias"]=round(b.pop("signed_error")/n,2);b["within_pct"]=round(b["within"]*100/n,1)
out.parent.mkdir(parents=True,exist_ok=True)
out.write_text(json.dumps({"updated_at":now.isoformat(),"methodology":"Predictions frozen before tipoff; grade by absolute error tolerance max(2,20% of projection). Not betting hit rate.","snapshots":snapshots,"accuracy_by_model":report},separators=(",",":")))
print("NBA frozen snapshots",len(snapshots),"graded projections",sum(p["result"] in ("within_20pct","outside_20pct") for s in snapshots for p in s["projections"]))
