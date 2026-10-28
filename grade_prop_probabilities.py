#!/usr/bin/env python3
"""Grade frozen NFL player-prop research probabilities after completed games.

Strictly separates pregame capture from postgame snap-verified outcomes.
Does not infer a sportsbook offering, betting ROI, or live-readiness status.
"""
import json
from collections import defaultdict
from pathlib import Path

import nflreadpy
import pandas as pd
from historical_participation import snap_verified_weekly

ROOT = Path(__file__).resolve().parent
DIR = ROOT / "data" / "forward" / "prop_snapshots"
OUT = ROOT / "data" / "forward" / "prop_probability_performance.json"

def frame(obj):
    return obj.to_pandas() if hasattr(obj, "to_pandas") else pd.DataFrame(obj)

def evaluate(snapshots, schedules, appearances):
    # appearances contains postgame snap-verified player-game outcomes. Use
    # these rows exclusively for grading, NEVER for the frozen predictions.
    games = {}
    for row in schedules.to_dict("records"):
        if str(row.get("game_type", "")).upper() != "REG":
            continue
        games[str(row["game_id"])] = row
    outcomes = {}
    game_coverage = defaultdict(set)
    for p in appearances.to_dict("records"):
        key = (str(p["game_id"]), str(p["player_id"]))
        if key in outcomes:
            raise RuntimeError("Duplicate player-game snap participation")
        outcomes[key] = p
        game_coverage[str(p["game_id"])].add(str(p["team"]))
    graded, skipped = [], defaultdict(int)
    for snapshot in snapshots:
        game_id = str(snapshot.get("game_id", ""))
        game = games.get(game_id)
        if not game:
            skipped["FIXTURE_NOT_FOUND"] += 1
            continue
        cutoff = pd.to_datetime(snapshot.get("conservative_game_day_cutoff_utc"), utc=True, errors="coerce")
        captured = pd.to_datetime(snapshot.get("captured_at_utc"), utc=True, errors="coerce")
        if pd.isna(cutoff) or pd.isna(captured) or captured >= cutoff:
            skipped["INVALID_CAPTURE_TIME"] += 1
            continue
        if not pd.notna(game.get("home_score")) or not pd.notna(game.get("away_score")):
            skipped["GAME_NOT_FINAL"] += 1
            continue
        if not {str(game["home_team"]), str(game["away_team"])}.issubset(game_coverage.get(game_id, set())):
            skipped["SNAP_DATA_INCOMPLETE"] += 1
            continue
        for item in snapshot.get("predictions", []):
            player_id = str(item.get("player_id", ""))
            stat_col = {"PASS": "passing_yards", "RUSH": "rushing_yards",
                        "REC": "receiving_yards", "CATCH": "receptions"}.get(item.get("market"))
            if stat_col is None:
                skipped["UNKNOWN_MARKET"] += 1
                continue
            p = outcomes.get((game_id, player_id))
            if p is None:
                skipped["NO_OFFENSIVE_SNAPS"] += 1
                continue
            try:
                prob = float(item["model_probability"])
                base = float(item["baseline_probability"])
                threshold = float(item["threshold"])
                if not 0 < prob < 1 or not 0 < base < 1 or threshold < 0:
                    raise ValueError("Invalid frozen probability or threshold")
                hit = int(float(p[stat_col]) > threshold)
            except (KeyError, ValueError, TypeError, OverflowError):
                skipped["INVALID_FORECAST"] += 1
                continue
            graded.append({
                "model_version": str(snapshot.get("model_version", "UNKNOWN")),
                "season": int(snapshot["season"]), "week": int(snapshot["week"]),
                "game_id": game_id, "player_id": player_id,
                "market": str(item["market"]), "threshold": threshold,
                "model_probability": prob, "baseline_probability": base, "hit": hit,
            })
    # Duplicate forecasts must not artificially increase sample size.
    keys = [(r["game_id"], r["player_id"], r["market"], r["threshold"]) for r in graded]
    if len(keys) != len(set(ke    # Never pool different frozen model versions and call the result a new
    # independent validation set. Legacy exploratory snapshots remain auditable.
    current_version = "opportunity-2024-trained-eligible-fullseason-v2"
    by_version = {}
    for version in sorted({r["model_version"] for r in graded} | {
        str(doc.get("model_version", "UNKNOWN")) for doc in snapshots
    } | {current_version}):
        subset = [r for r in graded if r["model_version"] == version]
        by_market = {}
        for market in ("PASS", "RUSH", "REC", "CATCH"):
            rows = [r for r in subset if r["market"] == market]
            n = len(rows)
            model_brier = sum((r["model_probability"]-r["hit"])**2 for r in rows)/n if n else None
            baseline_brier = sum((r["baseline_probability"]-r["hit"])**2 for r in rows)/n if n else None
            by_market[market] = {
                "n": n,
                "model_brier": round(model_brier, 6) if n else None,
                "baseline_brier": round(baseline_brier, 6) if n else None,
                "beats_baseline": bool(n and model_brier < baseline_brier),
                "distinct_weeks": len({(r["season"], r["week"]) for r in rows}),
            }
        by_version[version] = {
            "graded": len(subset),
            "distinct_weeks": len({(r["season"], r["week"]) for r in subset}),
            "markets": by_market,
        }
    current = by_version[current_version]
    weeks = current["distinct_weeks"]
    return {
        "status": "RESEARCH_ONLY_NOT_BET_READY", "bet_ready": False,
        "model_version": current_version,
        "graded": len(graded), "current_model_graded": current["graded"],
        "distinct_graded_weeks": weeks,
        "min_forward_weeks_for_review": 8,
        "eligible_for_research_review": weeks >= 8 and current["graded"] >= 500,
        "markets": current["markets"], "version_reports": by_version,
        "skipped": dict(skipped), "records": graded,
        "warning": "Only independently frozen current-version forecasts count toward review. Older model versions are shown separately. Fixed hypothetical thresholds; no sportsbook lines or betting claims."
    }
def main():
    files = sorted(DIR.glob("*.json"))
    snapshots = [json.loads(path.read_text(encoding="utf-8")) for path in files]
    seasons = sorted({int(s["season"]) for s in snapshots})
    schedules_list, appearances_list = [], []
    for season in seasons:
        weekly = frame(nflreadpy.load_player_stats(seasons=[season], summary_level="week"))
        rosters = frame(nflreadpy.load_rosters([season]))
        snaps = frame(nflreadpy.load_snap_counts([season]))
        schedule = frame(nflreadpy.load_schedules([season]))
        if any(x.empty for x in (weekly, rosters, snaps, schedule)):
            raise RuntimeError(f"Missing snap-verified grading inputs for {season}")
        schedules_list.append(schedule)
        appearances_list.append(snap_verified_weekly(weekly,rosters,snaps,schedule,season))
    schedule = pd.concat(schedules_list,ignore_index=True) if schedules_list else pd.DataFrame()
    appearances = pd.concat(appearances_list,ignore_index=True) if appearances_list else pd.DataFrame()
    if snapshots:
        report = evaluate(snapshots, schedule, appearances)
    else:
        report = {"status": "NO_FROZEN_PREGAME_FORECASTS", "bet_ready": False,
                  "graded": 0, "distinct_graded_weeks": 0,
                  "markets": {}, "skipped": {}, "records": []}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=2)+"\n",encoding="utf-8")
    print("Forward prop probability audit:", report["status"], "graded", report["graded"],
          "weeks", report["distinct_graded_weeks"])

if __name__ == "__main__":
    main()
