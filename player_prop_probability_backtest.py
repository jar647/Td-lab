#!/usr/bin/env python3
"""NFL player-prop probability research backtest.

Fixed illustrative thresholds, NOT verified sportsbook offerings or betting edges.
Walk-forward predictions use exclusively earlier games for the same player.
2024 calibrates a simple shrinkage adjustment; 2025 is untouched holdout.
Weekly nflverse player-stat rows include recorded zero-market games for players
who appear elsewhere in the box score. This still does not establish all active
players, snap participation, pregame availability, or bookmaker eligibility.
"""
import json
import math
from pathlib import Path

import nflreadpy
import pandas as pd
from opportunity_prop_model import MARKET_OPPORTUNITY, opportunity_probability
from historical_participation import snap_verified_weekly

ROOT = Path(__file__).resolve().parent
SEASONS = (2024, 2025)
MARKETS = {
    "passing_yards": ("passing_yards", ("QB",), [149.5, 199.5, 249.5, 299.5]),
    "rushing_yards": ("rushing_yards", ("RB", "QB"), [24.5, 49.5, 74.5, 99.5]),
    "receiving_yards": ("receiving_yards", ("WR", "TE", "RB"), [24.5, 49.5, 74.5, 99.5]),
    "receptions": ("receptions", ("WR", "TE", "RB"), [1.5, 2.5, 3.5, 4.5, 5.5]),
}
MIN_HISTORY = 5

def frame(value):
    return value.to_pandas() if hasattr(value, "to_pandas") else pd.DataFrame(value)

def brier(rows, key):
    return sum((r[key] - r["hit"]) ** 2 for r in rows) / len(rows) if rows else None

def logloss(rows, key):
    return sum(-(r["hit"] * math.log(max(1e-6, r[key])) +
                 (1 - r["hit"]) * math.log(max(1e-6, 1 - r[key]))) for r in rows) / len(rows) if rows else None

def observations(weekly):
    """Build eligible market histories from game-level player box-score rows.

    A zero market statistic is included when the player has a box-score row.
    This improves on play-level participant filtering but cannot guarantee
    that an active player with zero offensive usage appears in the stats.
    """
    required = {"player_id", "position", "season", "week", "game_id", "season_type"}
    for stat, _, _ in MARKETS.values():
        required.add(stat)
        required.add(MARKET_OPPORTUNITY[next(k for k, v in MARKETS.items() if v[0] == stat)])
    missing = required - set(weekly.columns)
    if missing:
        raise RuntimeError(f"Weekly player-stat columns missing: {sorted(missing)}")
    weekly = weekly.loc[weekly["season_type"].astype(str).eq("REG")].copy()
    weekly = weekly.loc[weekly["player_id"].notna() & weekly["game_id"].notna()]
    keys = ["season", "player_id", "position", "week", "game_id"]
    output = []
    for market, (stat, positions, thresholds) in MARKETS.items():
        volume_key = MARKET_OPPORTUNITY[market]
        subset = weekly.loc[weekly["position"].isin(positions), keys + [stat, volume_key]].copy()
        subset[stat] = pd.to_numeric(subset[stat], errors="coerce").fillna(0).clip(lower=0)
        subset[volume_key] = pd.to_numeric(subset[volume_key], errors="coerce").fillna(0).clip(lower=0)
        games = (subset.groupby(keys, as_index=False)[[stat, volume_key]].sum()
                 .sort_values(["season", "player_id", "week", "game_id"]))
        for (_, player), g in games.groupby(["season", "player_id"], sort=False):
            vals = g[stat].astype(float).tolist()
            opportunities = g[volume_key].astype(float).tolist()
            weeks = g["week"].tolist()
            for i in range(MIN_HISTORY, len(vals)):
                prior = vals[:i]
                recent = prior[-5:]
                for threshold in thresholds:
                    historical_hits = sum(v > threshold for v in prior)
                    recent_hits = sum(v > threshold for v in recent)
                    baseline = (historical_hits + 1) / (len(prior) + 2)
                    latest = (recent_hits + 1) / (len(recent) + 2)
                    candidate = opportunity_probability(prior, opportunities[:i], threshold)
                    output.append({
                        "season": int(g["season"].iloc[i]), "week": int(weeks[i]),
                        "player_id": str(player), "market": market,
                        "threshold": threshold, "hit": int(vals[i] > threshold),
                        "baseline": baseline, "recent": latest,
                        "opportunity_candidate": candidate,
                    })
    return output

def calibrate(train):
    # Model blending tuned ONLY on training season. Deterministic candidates.
    choices = [0, .25, .5, .75, 1]
    return min(choices, key=lambda a: sum(
        ((1-a)*r["baseline"] + a*r["recent"] - r["hit"])**2 for r in train
    ))

def evaluate(rows, weight):
    if not rows:
        return {"n": 0, "brier": None, "log_loss": None, "baseline_brier": None, "beats_baseline": False}
    tested = [{**r, "model": (1-weight)*r["baseline"] + weight*r["recent"]} for r in rows]
    b = brier(tested, "baseline")
    m = brier(tested, "model")
    bins = []
    for index in range(10):
        subset = [r for r in tested if index / 10 <= r["model"] < (index+1)/10 or (index==9 and r["model"]==1)]
        if subset:
            bins.append({"range": f"{index*10}-{(index+1)*10}%",
                         "n": len(subset), "predicted": round(sum(r["model"] for r in subset)/len(subset),4),
                         "observed": round(sum(r["hit"] for r in subset)/len(subset),4)})
    return {"n": len(tested), "model_brier": round(m, 6), "baseline_brier": round(b, 6),
            "model_log_loss": round(logloss(tested, "model"), 6),
            "baseline_log_loss": round(logloss(tested, "baseline"), 6),
            "beats_baseline": m < b, "calibration_bins": bins}

def main():
    all_rows = []
    for season in SEASONS:
        weekly = frame(nflreadpy.load_player_stats(seasons=[season], summary_level="week"))
        rosters = frame(nflreadpy.load_rosters([season]))
        snaps = frame(nflreadpy.load_snap_counts([season]))
        schedules = frame(nflreadpy.load_schedules([season]))
        if any(frame.empty for frame in (weekly, rosters, snaps, schedules)):
            raise RuntimeError(f"Missing historical participation inputs for {season}")
        eligible = snap_verified_weekly(weekly, rosters, snaps, schedules, season)
        unmatched = int((~eligible["boxscore_row_present"]).sum())
        print(f"{season}: {len(eligible)} snap-verified offensive player-games, "
              f"{unmatched} with independently verified snaps but no box-score row")
        all_rows.extend(observations(eligible))
    train = [r for r in all_rows if r["season"] == 2024]
    holdout = [r for r in all_rows if r["season"] == 2025]
    if len(train) < 500 or len(holdout) < 500:
        raise RuntimeError(f"Insufficient observations: train={len(train)} holdout={len(holdout)}")
    by_market = {}
    for market in MARKETS:
        t = [r for r in train if r["market"] == market]
        h = [r for r in holdout if r["market"] == market]
        if len(t) < 50 or len(h) < 50:
            by_market[market] = {"status": "INSUFFICIENT_HISTORY", "train": len(t), "holdout": len(h)}
            continue
        weight = calibrate(t)
        # Blend with the usage-based candidate. Tune only on 2024 training rows.
        candidates = [0, .25, .5, .75, 1]
        opp_weight = min(candidates, key=lambda w: sum(
            ((1-w)*r["baseline"] + w*r["opportunity_candidate"] - r["hit"])**2 for r in t))
        enriched = [{**r, "recent": r["opportunity_candidate"]} for r in h]
        metrics = evaluate(enriched, opp_weight)
        by_market[market] = {"status": "RESEARCH_ONLY", "train": len(t), "holdout": len(h),
                             "prior_research_weight_recent": weight,
                             "weight_opportunity": opp_weight,
                             "research_candidate": "bounded opportunity-adjusted historical distribution",
                             **metrics}
    output = {
        "status": "RESEARCH_ONLY_NOT_BET_READY", "seasons": {"train": 2024, "holdout": 2025},
        "threshold_type": "fixed hypothetical thresholds, not sportsbook lines",
        "selection_bias": "Offensive participation verified by prior-season historical snaps and an exact PFR-to-GSIS identity join. Postgame snaps are used only as outcome eligibility, never as pregame features. Position/team mapping gaps may still omit valid appearances.",
        "method": "nflverse weekly stats plus verified positive offensive snap game appearances; walk-forward probability comparison with 2024 fit and 2025 historical evaluation.",
        "limitations": ["Does not evaluate the live app's probability model", "No opponent adjustment",
                         "No injury-as-of verification", "No sportsbook pricing or SGP correlations",
                         "Not representative of every rostered player-game; historically verified participation must never be used to predict future player availability"],
        "bet_ready": False, "markets": by_market,
    }
    path = ROOT / "data/player_prop_probability_backtest.json"
    path.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(output, indent=2))

if __name__ == "__main__":
    main()
