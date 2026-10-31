#!/usr/bin/env python3
"""Import licensed SportQuanta NBA tracking averages, preserving source and missing values."""
import datetime as dt
import json
import os
import pathlib
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEST = ROOT / "data/nba_opportunities.json"
TOKEN = os.getenv("SPORTQUANTA_API_TOKEN", "").strip()
if not TOKEN:
    raise SystemExit("SPORTQUANTA_API_TOKEN not configured. Licensed stats access is required.")
now = dt.datetime.now(dt.timezone.utc)
season = now.year if now.month >= 10 else now.year - 1
url = "https://api.sportquanta.com/v1/nba/player-tracking?" + urllib.parse.urlencode({"season": season, "limit": 1000})
req = urllib.request.Request(url, headers={"Authorization": "Bearer " + TOKEN, "Accept": "application/json"})
with urllib.request.urlopen(req, timeout=30) as resp:
    payload = json.load(resp)
items = payload.get("data", {}).get("items", [])
if not isinstance(items, list) or not items:
    raise SystemExit("No licensed tracking rows returned. Existing data retained.")
players = {}
for item in items:
    external = item.get("external_ids") or {}
    espn = next((str(v) for k, v in external.items() if "espn" in k.lower() and str(v).isdigit()), None)
    if not espn:
        continue
    passing = item.get("passing") or {}
    rebounding = item.get("rebounding") or {}
    pa = passing.get("potential_assists")
    rc = rebounding.get("rebound_chances")
    if not any(isinstance(x, (int, float)) and x >= 0 for x in (pa, rc)):
        continue
    averages = {}
    if isinstance(pa, (int, float)) and pa >= 0:
        averages["potential_assists_season"] = pa
    if isinstance(rc, (int, float)) and rc >= 0:
        averages["rebound_chances_season"] = rc
    players[espn] = {"averages": averages, "games_played": item.get("games_played")}
if len(players) < 20:
    raise SystemExit(f"Only {len(players)} valid ESPN-mapped players. Existing data retained.")
data = {"schema_version": 3, "source": "SportQuanta licensed NBA tracking",
        "source_url": url, "generated_at": now.isoformat(),
        "data_as_of": now.isoformat(), "season": season,
        "aggregation": "season_per_game", "players": players}
DEST.write_text(json.dumps(data, indent=2) + "\n")
print(f"Imported licensed season tracking for {len(players)} players")
