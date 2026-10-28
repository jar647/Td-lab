#!/usr/bin/env python3
"""Freeze RESEARCH-ONLY NFL player-prop probabilities before game day.

Never overwrites a frozen game snapshot, never inserts sportsbook odds,
and never calls historical postgame snaps to predict future participation.
Run as a step of the existing verified feed workflow.
"""
import json
from datetime import datetime, timezone
from pathlib import Path

import nflreadpy
import pandas as pd

from opportunity_prop_model import opportunity_probability

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
SNAPSHOTS = DATA / "forward" / "prop_snapshots"
VERSION = "opportunity-empirical-v1"
MARKETS = {
    "PASS": ("passYards", "passAttempts", "QB", (149.5, 199.5, 249.5, 299.5)),
    "RUSH": ("rushYards", "rushAttempts", "RB,QB", (24.5, 49.5, 74.5, 99.5)),
    "REC": ("recYards", "targets", "RB,WR,TE", (24.5, 49.5, 74.5, 99.5)),
    "CATCH": ("receptions", "targets", "RB,WR,TE", (1.5, 2.5, 3.5, 4.5, 5.5)),
}

def frame(value):
    return value.to_pandas() if hasattr(value, "to_pandas") else pd.DataFrame(value)

def pregame_rows(players):
    frozen = []
    for player in players:
        if not player.get("player_id") or not player.get("playerAppearancesVerified"):
            continue
        pos = str(player.get("pos", ""))
        history = player.get("last5GameStats") or []
        if not isinstance(history, list) or len(history) < 5:
            continue
        for market, (stat, volume, positions, lines) in MARKETS.items():
            if pos not in positions.split(","):
                continue
            if any(g.get(stat) is None or g.get(volume) is None for g in history):
                continue
            try:
                values = [float(g[stat]) for g in history]
                usage = [float(g[volume]) for g in history]
                # Unknown / negative inputs cannot be treated as valid zeroes.
                if any(not 0 <= x < 10000 for x in values+usage):
                    continue
                for threshold in lines:
                    probability = opportunity_probability(values, usage, threshold)
                    baseline = (1 + sum(v > threshold for v in values))/(len(values)+2)
                    frozen.append({
                        "player_id": str(player["player_id"]),
                        "player": player.get("player"),
                        "team": str(player.get("team")),
                        "position": pos, "market": market, "threshold": threshold,
                        "model_probability": round(probability, 8),
                        "baseline_probability": round(baseline, 8),
                        "sample_games": len(values),
                        "availability_at_capture": str(player.get("availability", "UNVERIFIED")),
                        "injury_report_at_capture": str(player.get("injuryReportStatus", "NOT_REPORTED")),
                        "practice_at_capture": str(player.get("injuryPracticeStatus", "NOT_REPORTED")),
                    })
            except (ValueError, TypeError, OverflowError, ZeroDivisionError):
                continue
    return frozen

def freeze_fixture(fixture, players, captured_at, output_dir=SNAPSHOTS):
    kickoff_day = pd.to_datetime(fixture.get("gameday"), errors="coerce", utc=True)
    created = pd.to_datetime(captured_at, errors="coerce", utc=True)
    if pd.isna(kickoff_day) or pd.isna(created) or created >= kickoff_day:
        return "AFTER_CONSERVATIVE_DAY_CUTOFF"
    season, week, game_id = int(fixture["season"]), int(fixture["week"]), str(fixture["game_id"])
    path = output_dir / f"{season}-week-{week}-game-{game_id}.json"
    if path.exists():
        return "ALREADY_FROZEN"
    home, away = str(fixture["home_team"]), str(fixture["away_team"])
    selected = [p for p in players if (p.get("team"), p.get("opp")) in {(home, away), (away, home)}]
    rows = pregame_rows(selected)
    if not rows:
        return "NO_ELIGIBLE_PLAYER_HISTORY"
    output_dir.mkdir(parents=True, exist_ok=True)
    doc = {
        "model_version": VERSION,
        "status": "RESEARCH_ONLY_UNCALIBRATED", "bet_ready": False,
        "season": season, "week": week, "game_id": game_id,
        "home": home, "away": away,
        "captured_at_utc": created.isoformat(),
        "conservative_game_day_cutoff_utc": kickoff_day.isoformat(),
        "threshold_policy": "Illustrative fixed half-point thresholds, NOT sportsbook lines",
        "participation_policy": "Pregame roster availability is unverified; postgame snaps NEVER used at capture",
        "predictions": rows,
    }
    # Exclusive creation prevents quietly revising a forecast after publication.
    try:
        with path.open("x", encoding="utf-8") as handle:
            json.dump(doc, handle, indent=2)
            handle.write("\n")
    except FileExistsError:
        return "ALREADY_FROZEN"
    return f"FROZEN_{len(rows)}"

def main():
    metadata = json.loads((DATA / "status.json").read_text())
    players = json.loads((DATA / "matchups.json").read_text())
    season, week = int(metadata["season"]), int(metadata["week"])
    schedules = frame(nflreadpy.load_schedules([season]))
    slate = schedules.loc[
        pd.to_numeric(schedules["season"], errors="coerce").eq(season)
        & pd.to_numeric(schedules["week"], errors="coerce").eq(week)
        & schedules["game_type"].astype(str).str.upper().eq("REG")
    ]
    captured_at = datetime.now(timezone.utc).isoformat()
    summary = {}
    for _, fixture in slate.iterrows():
        result = freeze_fixture(fixture.to_dict(), players, captured_at)
        summary[result.split("_")[0]] = summary.get(result.split("_")[0], 0) + 1
        print(f'{fixture["game_id"]}: {result}')
    print("Prospective prop research captures:", summary)

if __name__ == "__main__":
    main()
