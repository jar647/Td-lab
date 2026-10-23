"""Reconstruct historical TD LAB rankings using only pregame nflverse information.

Research-only retrospective evaluation, NEVER equivalent to archived live picks.
Outputs are separated from immutable forward-captured data/history snapshots.
"""
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import nflreadpy as nfl
import build_feed as feed

OUT = Path("data/retrospective")
YEARS = [int(x) for x in os.getenv("TDLAB_BACKTEST_SEASONS", "2024,2025").split(",")]
MIN_WEEK = int(os.getenv("TDLAB_BACKTEST_FIRST_WEEK", "7"))
MAX_WEEK = int(os.getenv("TDLAB_BACKTEST_LAST_WEEK", "18"))

def frame(obj):
    return obj.to_pandas() if hasattr(obj, "to_pandas") else pd.DataFrame(obj)

def score(p):
    def cap(key, den):
        return min(1, max(0, float(p.get(key, 0)) / den))
    raw = 100 * (.35 * cap("tdallowed", 1.5) + .20 * cap("rzallowed", 4)
                 + .25 * cap("rzshare", 50) + .20 * cap("playerRz", 2.5))
    return int(raw * (.65 + .35 * min(1, float(p.get("games", 0)) / 6)) + .5)

def evaluate_year(season):
    feed.SEASON = season
    pbp = frame(nfl.load_pbp([season]))
    schedules = frame(nfl.load_schedules([season]))
    rosters = frame(nfl.load_rosters([season]))
    # Historical current-week injury feeds and weekly roster availability can
    # differ from what was visible pregame. Do not pretend these are live picks.
    weekly_rosters = frame(nfl.load_rosters_weekly([season]))
    injuries = None
    try:
        injuries = frame(nfl.load_injuries([season]))
    except Exception as exc:
        print("Historical injury data unavailable:", season, exc)
    if not {"rush_touchdown", "pass_touchdown"}.issubset(pbp.columns):
        raise RuntimeError("Missing touchdown outcome columns")
    schedule = schedules[(pd.to_numeric(schedules.season, errors="coerce") == season)
                         & (schedules.game_type.astype(str).str.upper() == "REG")].copy()
    output = []
    for week in range(MIN_WEEK, MAX_WEEK + 1):
        slate = schedule[pd.to_numeric(schedule.week, errors="coerce") == week]
        if slate.empty:
            continue
        kickoff_day = pd.to_datetime(slate.gameday, utc=True, errors="coerce").min()
        if pd.isna(kickoff_day):
            continue
        # build() uses current-week schedule and prior weeks of PBP only.
        try:
            past_rosters = rosters.copy()
            if 'week' in past_rosters.columns:
                past_rosters = past_rosters[pd.to_numeric(past_rosters.week, errors='coerce') <= week]
            past_weekly = weekly_rosters.copy()
            if 'week' in past_weekly.columns:
                past_weekly = past_weekly[pd.to_numeric(past_weekly.week, errors='coerce') <= week]
            # Prefer each player's historical weekly roster state, rather than
            # a season-end roster that can exclude players who changed teams.
            if {'gsis_id', 'position', 'team', 'week'}.issubset(past_weekly.columns):
                historical_rosters = past_weekly.sort_values('week').drop_duplicates('gsis_id', keep='last')
            else:
                historical_rosters = past_rosters
            players, _ = feed.build(pbp, schedules, historical_rosters, now=kickoff_day.to_pydatetime(),
                                    injuries=injuries, weekly_rosters=past_weekly)
        except RuntimeError as exc:
            print("Skipping", season, week, exc)
            continue
        game_rows = pbp[(pd.to_numeric(pbp.season, errors="coerce") == season)
                        & (pd.to_numeric(pbp.week, errors="coerce") == week)]
        expected = set(slate.game_id.astype(str)) if "game_id" in slate else set()
        actual = set(game_rows.game_id.dropna().astype(str))
        if not expected or not expected.issubset(actual):
            print("Skipping incomplete week", season, week)
            continue
        rush = game_rows.loc[pd.to_numeric(game_rows.rush_touchdown, errors="coerce") == 1,
                             "rusher_player_id"].dropna().astype(str)
        recv = game_rows.loc[pd.to_numeric(game_rows.pass_touchdown, errors="coerce") == 1,
                             "receiver_player_id"].dropna().astype(str)
        scored = set(rush) | set(recv)
        output.append({"season": season, "week": week, "kind": "retrospective_reconstruction",
                       "not_forward_tested": True, "source": "nflverse PBP and roster",
                       "players": [{"player_id": p["player_id"], "team": p["team"],
                                    "pos": p["pos"], "score": score(p),
                                    "scored_td": p["player_id"] in scored}
                                   for p in players]})
        print("Reconstructed", season, week, len(players), "candidates")
    return output

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    weeks = []
    for season in YEARS:
        weeks.extend(evaluate_year(season))
    if len(weeks) < 12:
        raise RuntimeError(f"Only {len(weeks)} historical weeks reconstructed; at least 12 required. Refusing misleading success.")
    (OUT / "weekly.json").write_text(json.dumps({"status": "research_only",
        "warning": "Retrospective reconstruction is not prospective betting evidence. Historical roster and injury data may contain hindsight.",
        "weeks": weeks}, separators=(",", ":")) + "\n")
    print("Wrote", len(weeks), "retrospective weeks")

if __name__ == "__main__":
    main()
