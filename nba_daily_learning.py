#!/usr/bin/env python3
"""Daily NBA forecast-review pipeline.

Reviews immutable pre-tipoff projections AFTER verified final outcomes.
A chronologically walk-forward bias-correction challenger is tested on later
game DAYS only, never on the same day's outcomes. Neither the baseline nor
the challenger supplies calibrated prop hit probabilities or sportsbook edges.
No model is automatically promoted based on a small early-season sample.
"""
from __future__ import annotations

import datetime as dt
import json
import math
from collections import defaultdict
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
INPUT = ROOT / "data" / "nba_projection_tracker.json"
OUTPUT = ROOT / "data" / "nba_daily_learning.json"
TZ = ZoneInfo("America/New_York")
GRADED = {"within_20pct", "outside_20pct"}
MARKETS = {"points", "rebounds", "assists", "minutes", "threes"}
MIN_HISTORY_DAYS = 3
MIN_HISTORY_OBSERVATIONS = 50
MIN_REVIEW_HOLDOUT_DAYS = 5
MIN_REVIEW_HOLDOUT_OBSERVATIONS = 200


def timestamp(value):
    try:
        when = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return when if when.tzinfo is not None else None
    except (ValueError, TypeError):
        return None


def observation_rows(tracker):
    observations, inventory = [], {
        "snapshots": 0, "pending_predictions": 0, "dnp": 0,
        "ungraded": 0, "invalid_pregame_locks": 0, "invalid_records": 0
    }
    seen_games = set()
    seen_predictions = set()
    for snap in tracker.get("snapshots", []):
        game_id = str(snap.get("game_id") or "")
        if not game_id or game_id in seen_games:
            raise ValueError("Missing or duplicate NBA game snapshot ID")
        seen_games.add(game_id)
        inventory["snapshots"] += 1
        lock, tip = timestamp(snap.get("locked_at")), timestamp(snap.get("tipoff"))
        if not lock or not tip or lock >= tip:
            inventory["invalid_pregame_locks"] += 1
            continue
        model = str(snap.get("model") or "UNKNOWN")
        day = tip.astimezone(TZ).date().isoformat()
        for p in snap.get("projections", []):
            market = str(p.get("market") or "")
            player_id = str(p.get("player_id") or "")
            key = (game_id, player_id, market)
            if key in seen_predictions:
                raise ValueError("Duplicate NBA player-market forecast within game")
            seen_predictions.add(key)
            result = str(p.get("result") or "pending")
            if result == "pending":
                inventory["pending_predictions"] += 1
                continue
            if result == "dnp":
                inventory["dnp"] += 1
                continue
            if result not in GRADED:
                inventory["ungraded"] += 1
                continue
            try:
                projection = float(p["projection"])
                actual = float(p["actual"])
                sample = int(p["sample"])
                if (not math.isfinite(projection) or not math.isfinite(actual)
                        or projection < 0 or actual < 0 or sample < 3):
                    raise ValueError("Invalid forecast or outcome")
            except (ValueError, TypeError, KeyError, OverflowError):
                inventory["invalid_records"] += 1
                continue
            if market not in MARKETS or not player_id:
                inventory["invalid_records"] += 1
                continue
            observations.append({
                "game_id": game_id, "day": day, "model": model, "market": market,
                "player_id": player_id, "projection": projection, "actual": actual
            })
    return observations, inventory


def summarize(rows):
    if not rows:
        return {"n": 0, "distinct_games": 0, "distinct_days": 0,
                "distinct_player_games": 0, "mae": None, "bias": None,
                "within_20pct": None}
    n = len(rows)
    return {
        "n": n,
        "distinct_games": len({r["game_id"] for r in rows}),
        "distinct_days": len({r["day"] for r in rows}),
        "distinct_player_games": len({(r["game_id"], r["player_id"]) for r in rows}),
        "mae": round(sum(abs(r["projection"]-r["actual"]) for r in rows)/n, 3),
        "bias": round(sum(r["projection"]-r["actual"] for r in rows)/n, 3),
        "within_20pct": round(sum(
            abs(r["projection"]-r["actual"]) <= max(2, r["projection"]*.2)
            for r in rows)/n, 4)
    }


def walk_forward(rows):
    """A fresh challenger is fit exclusively on earlier Eastern game-days."""
    days = sorted({r["day"] for r in rows})
    baseline_errors, challenger_errors, tested_days = [], [], set()
    per_day = []
    for day in days:
        history = [r for r in rows if r["day"] < day]
        pending = [r for r in rows if r["day"] == day]
        if (len(history) < MIN_HISTORY_OBSERVATIONS
                or len({r["day"] for r in history}) < MIN_HISTORY_DAYS):
            continue
        # Positive bias means the baseline systematically projects too high.
        bias = sum(r["projection"]-r["actual"] for r in history)/len(history)
        # Shrink noisy early-season differences and cap extreme adjustments.
        shrink = len(history)/(len(history)+60)
        typical = sum(r["projection"] for r in history)/len(history)
        adjustment = max(-max(1.,typical*.15), min(max(1.,typical*.15), bias*shrink))
        for r in pending:
            baseline_errors.append(abs(r["projection"]-r["actual"]))
            challenger_errors.append(abs(max(0,r["projection"]-adjustment)-r["actual"]))
        tested_days.add(day)
        per_day.append({"day": day, "train_days":len({r["day"] for r in history}),
                        "train_rows":len(history), "holdout_rows":len(pending),
                        "frozen_pregame_bias_adjustment":round(adjustment,4)})
    tested = len(baseline_errors)
    mae0 = sum(baseline_errors)/tested if tested else None
    mae1 = sum(challenger_errors)/tested if tested else None
    improvement = (mae0-mae1)/mae0 if mae0 is not None and mae0>0 else None
    review_ready = (len(tested_days)>=MIN_REVIEW_HOLDOUT_DAYS and
                    tested>=MIN_REVIEW_HOLDOUT_OBSERVATIONS)
    return {
        "walk_forward_holdout_days":len(tested_days),
        "walk_forward_holdout_forecasts":tested,
        "baseline_holdout_mae":round(mae0,4) if mae0 is not None else None,
        "bias_challenger_holdout_mae":round(mae1,4) if mae1 is not None else None,
        "bias_challenger_mae_improvement":round(improvement,4) if improvement is not None else None,
        "eligible_for_research_review":review_ready,
        "challenger_outperforms_baseline":bool(review_ready and improvement is not None
                                              and improvement>=.03),
        "daily_walk_forward":per_day
    }


def report(tracker, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    rows, inventory = observation_rows(tracker)
    groups = defaultdict(list)
    for r in rows:
        groups[(r["model"],r["market"])].append(r)
    models = {}
    for (version,market),subset in sorted(groups.items()):
        models.setdefault(version,{})[market] = {
            **summarize(subset), **walk_forward(subset)
        }
    evidence_days = len({r["day"] for r in rows})
    fresh = timestamp(tracker.get("updated_at"))
    age = (now-fresh).total_seconds()/3600 if fresh else None
    return {
        "generated_at_utc":now.isoformat(), "source":"Immutable pregame NBA tracker + ESPN final box scores",
        "status":"DAILY_RESEARCH_REVIEW_ONLY", "bet_ready":False,
        "automated_model_promotion":False,
        "schedule":"Every NBA data refresh; daily result reviews and pregame projections",
        "source_age_hours":round(age,2) if age is not None else None,
        "source_fresh":age is not None and 0<=age<=12,
        "graded_projection_rows":len(rows),
        "distinct_graded_game_days":evidence_days,
        "inventory":inventory, "models":models,
        "minimum_research_review_requirements":{
            "holdout_days_per_market":MIN_REVIEW_HOLDOUT_DAYS,
            "holdout_rows_per_market":MIN_REVIEW_HOLDOUT_OBSERVATIONS,
            "relative_MAE_improvement":.03,
        },
        "warning":"Rolling pregame projections are evaluated daily, but the bias-correction challenger is NOT promoted until independent holdout checks succeed. This evaluates statistical MAE, not calibrated player-prop hit probability, sportsbook odds or SGP ROI."
    }


def main():
    tracker = json.loads(INPUT.read_text(encoding="utf-8"))
    result = report(tracker)
    OUTPUT.parent.mkdir(parents=True,exist_ok=True)
    OUTPUT.write_text(json.dumps(result,indent=2)+"\n",encoding="utf-8")
    print("NBA daily learning audit:",result["status"],
          "graded",result["graded_projection_rows"],
          "game days",result["distinct_graded_game_days"],
          "source fresh",result["source_fresh"])


if __name__ == "__main__":
    main()
