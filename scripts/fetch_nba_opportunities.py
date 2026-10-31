#!/usr/bin/env python3
"""Fetch official NBA passing/rebounding opportunities for current player cards.
Best-effort: NBA Stats may block cloud IPs. Never overwrite verified data on failure.
"""
import datetime as dt
import json
import os
import pathlib
import time
import unicodedata
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEST = ROOT / "data/nba_opportunities.json"
GAMES = ROOT / "data/nba_games.json"
NOW = dt.datetime.now(dt.timezone.utc)
year = NOW.year if NOW.month >= 10 else NOW.year - 1
SEASON = f"{year}-{str(year + 1)[-2:]}"
BASE = "https://stats.nba.com/stats/leaguedashptstats"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    "Referer": "https://www.nba.com/",
    "Origin": "https://www.nba.com",
    "Accept": "application/json, text/plain, */*",
    "x-nba-stats-origin": "stats",
    "x-nba-stats-token": "true",
}
def clean(name):
    s = unicodedata.normalize("NFKD", str(name))
    return "".join(c for c in s.casefold() if c.isalnum() and not unicodedata.combining(c))

def request(kind, n):
    params = dict(College="", Conference="", Country="", DateFrom="", DateTo="",
        Division="", DraftPick="", DraftYear="", GameScope="", Height="",
        LastNGames=str(n), LeagueID="00", Location="", Month="0",
        OpponentTeamID="0", Outcome="", PORound="", PerMode="PerGame",
        PlayerExperience="", PlayerOrTeam="Player", PlayerPosition="",
        PtMeasureType=kind, Season=SEASON, SeasonSegment="",
        SeasonType="Regular Season", StarterBench="", TeamID="",
        VsConference="", VsDivision="", Weight="")
    url = BASE + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=24) as response:
        payload = json.load(response)
    sets = payload.get("resultSets") or payload.get("resultSet")
    if isinstance(sets, dict):
        sets = [sets]
    if not sets:
        raise ValueError("NBA tracking response contains no result sets")
    ds = sets[0]
    headers = ds.get("headers") or []
    rows = [dict(zip(headers, row)) for row in ds.get("rowSet", [])]
    if not rows or "PLAYER_ID" not in headers:
        raise ValueError(f"NBA tracking {kind} last {n}: no player rows")
    return rows

def numeric(value):
    try:
        v = float(value)
        return v if 0 <= v < 1000 else None
    except (ValueError, TypeError):
        return None

def main():
    if not GAMES.exists():
        raise RuntimeError("ESPN NBA game feed missing; cannot map player identities")
    games = json.loads(GAMES.read_text()).get("games", [])
    names = {}
    for game in games:
        for player in game.get("players", []):
            pid, name = player.get("id"), player.get("name")
            if pid and name:
                names.setdefault(clean(name), set()).add(str(pid))
    results = {}
    for kind in ("Passing", "Rebounding"):
        for n in (5, 10):
            rows = request(kind, n)
            results[(kind, n)] = rows
            time.sleep(1.2)
    players = {}
    matched = 0
    for (kind, n), rows in results.items():
        field = "potential_assists" if kind == "Passing" else "rebound_chances"
        source_key = "POTENTIAL_AST" if kind == "Passing" else "REB_CHANCES"
        for row in rows:
            ids = names.get(clean(row.get("PLAYER_NAME")), set())
            if len(ids) != 1:
                continue
            value = numeric(row.get(source_key))
            if value is None:
                continue
            pid = next(iter(ids))
            record = players.setdefault(pid, {"nba_id": str(row["PLAYER_ID"]), "name": row.get("PLAYER_NAME"), "averages": {}})
            record["averages"][f"{field}_{n}"] = value
            matched += 1
    if matched < 20:
        raise RuntimeError(f"Only {matched} matched tracking values; refusing to replace feed")
    output = {
        "schema_version": 2, "source": "NBA Stats LeagueDashPtStats (official)",
        "source_url": BASE, "season": SEASON,
        "generated_at": NOW.isoformat(), "data_as_of": NOW.isoformat(),
        "players": players, "matched_values": matched,
        "note": "NBA official rolling LastNGames averages. Not individual game logs. Only for games after data_as_of."
    }
    DEST.parent.mkdir(parents=True, exist_ok=True)
    DEST.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n")
    print(f"Published {matched} values for {len(players)} ESPN player IDs")

if __name__ == "__main__":
    main()
