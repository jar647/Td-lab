#!/usr/bin/env python3
"""Fetch ESPN NFL game summaries for independent defensive-stat auditing.

ESPN's public-facing endpoints are unofficial and can change. This script
stores raw evidence only; it does not mark any statistic verified.
"""
import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl"

def get_json(path, params):
    url = BASE + "/" + path + "?" + urlencode(params)
    request = Request(url, headers={"User-Agent": "ThePropVault-DataAudit/1.0", "Accept": "application/json"})
    with urlopen(request, timeout=25) as response:
        return json.load(response)

def fetch(season, weeks, output, pause):
    games = []
    failures = []
    for week in weeks:
        scoreboard = get_json("scoreboard", {"season": season, "seasontype": 2, "week": week, "limit": 100})
        for event in scoreboard.get("events", []):
            event_id = str(event["id"])
            status = event.get("status", {}).get("type", {})
            if not status.get("completed", False):
                continue
            try:
                summary = get_json("summary", {"event": event_id})
                players = summary.get("boxscore", {}).get("players", [])
                if len(players) != 2:
                    raise ValueError("Expected two team player box scores")
                games.append({"event_id": event_id, "week": week, "date": event.get("date"),
                              "competitors": event.get("competitions", [{}])[0].get("competitors", []),
                              "boxscore_players": players})
            except (OSError, ValueError, KeyError, TypeError) as exc:
                failures.append({"event_id": event_id, "week": week, "error": str(exc)})
            time.sleep(pause)
    report = {"source": "ESPN NFL game summary (unofficial)", "derived_from_nflverse": False,
              "season": season, "weeks": weeks, "retrieved_at": datetime.now(timezone.utc).isoformat(),
              "status": "RAW_EVIDENCE_ONLY_NOT_VERIFIED", "game_count": len(games),
              "failures": failures, "games": games}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n")
    if failures or not games:
        raise SystemExit(f"Incomplete ESPN retrieval: {len(games)} games, {len(failures)} failures")
    print(f"Saved {len(games)} completed games to {output}; independent comparison still required.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", type=int, default=2026)
    parser.add_argument("--weeks", type=int, nargs="+", required=True)
    parser.add_argument("--output", type=Path, default=Path("data/espn_raw_game_audit.json"))
    parser.add_argument("--pause", type=float, default=0.4)
    args = parser.parse_args()
    fetch(args.season, args.weeks, args.output, args.pause)
