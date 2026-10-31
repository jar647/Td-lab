#!/usr/bin/env python3
"""Fetch BoxScore Lab's CC BY 4.0 free NBA season player stats."""
import csv,datetime as dt,io,json,pathlib,urllib.request,unicodedata
ROOT=pathlib.Path(__file__).resolve().parents[1]
now=dt.datetime.now(dt.timezone.utc)
year=now.year if now.month>=10 else now.year-1
url=f"https://boxscorelab.com/downloads/{year}-{str(year+1)[-2:]}-player-season-totals.csv"
req=urllib.request.Request(url,headers={"User-Agent":"CoOkItUp/1.0 (NBA statistics research)"})
with urllib.request.urlopen(req,timeout=20) as response:
    body=response.read(2_000_000).decode("utf-8-sig")
rows=list(csv.DictReader(io.StringIO(body)))
if len(rows)<30:raise SystemExit("Too few player rows; existing data retained")
def norm(s):
    s=unicodedata.normalize("NFKD",str(s or "")).casefold()
    return "".join(c for c in s if c.isalnum() and not unicodedata.combining(c))
def choose(row,*names):
    lower={k.casefold().replace("_",""):v for k,v in row.items() if k}
    for name in names:
        v=lower.get(name.casefold().replace("_",""))
        if v not in (None,""):return v
    return None
games=json.loads((ROOT/"data/nba_games.json").read_text()).get("games",[])
ids={}
for game in games:
    for p in game.get("players",[]):
        if p.get("id") and p.get("name"):
            ids.setdefault(norm(p["name"]),set()).add(str(p["id"]))
players={}
for row in rows:
    name=choose(row,"player_name","player","name")
    matched=ids.get(norm(name),set())
    if len(matched)!=1:continue
    metrics={}
    for label,cols in {"games":("games","gp"),"minutes":("minutes","min","mp"),"points":("points","pts"),"rebounds":("rebounds","reb","trb"),"assists":("assists","ast"),"usage_rate":("usage_rate","usg_pct","usg"),"assist_share":("assist_share","ast_pct")}.items():
        raw=choose(row,*cols)
        if raw is None:continue
        try:metrics[label]=float(str(raw).replace("%",""))
        except ValueError:pass
    if len(metrics)<3:continue
    players[next(iter(matched))]={"name":name,"stats":metrics}
if len(players)<20:raise SystemExit(f"Only {len(players)} matched players; existing data retained")
output={"schema_version":1,"source":"BoxScore Lab","source_url":url,"license":"CC BY 4.0","generated_at":now.isoformat(),"aggregation":"season_totals","players":players,"matched_players":len(players),"note":"Season box-score stats only. Does not include potential assists or rebound chances."}
dest=ROOT/"data/nba_free_stats.json"
dest.write_text(json.dumps(output,indent=2)+"\n")
print(f"Updated {len(players)} player season records from BoxScore Lab")
