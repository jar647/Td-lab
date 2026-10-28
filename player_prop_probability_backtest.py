#!/usr/bin/env python3
"""NFL player-prop probability research backtest.

Fixed illustrative thresholds, NOT verified sportsbook offerings or betting edges.
Walk-forward predictions use exclusively earlier games for the same player.
2024 calibrates a simple shrinkage adjustment; 2025 is untouched holdout.
PBP participant rows can omit players who recorded zero relevant opportunities;
this CONDITIONAL-on-participation study cannot certify live prop probabilities.
"""
import json
import math
from collections import defaultdict
from pathlib import Path

import nflreadpy
import pandas as pd

ROOT = Path(__file__).resolve().parent
SEASONS = (2024, 2025)
MARKETS = {
    "passing_yards": ("passer_player_id", "pass_attempt", "passing_yards", [149.5, 199.5, 249.5, 299.5]),
    "rushing_yards": ("rusher_player_id", "rush_attempt", "rushing_yards", [24.5, 49.5, 74.5, 99.5]),
    "receiving_yards": ("receiver_player_id", "pass_attempt", "receiving_yards", [24.5, 49.5, 74.5, 99.5]),
    "receptions": ("receiver_player_id", "pass_attempt", "complete_pass", [1.5, 2.5, 3.5, 4.5, 5.5]),
}
MIN_HISTORY = 5

def frame(value):
    return value.to_pandas() if hasattr(value, "to_pandas") else pd.DataFrame(value)

def brier(rows, key):
    return sum((r[key] - r["hit"]) ** 2 for r in rows) / len(rows) if rows else None

def logloss(rows, key):
    return sum(-(r["hit"] * math.log(max(1e-6, r[key])) +
                 (1 - r["hit"]) * math.log(max(1e-6, 1 - r[key]))) for r in rows) / len(rows) if rows else None

def observations(pbp):
    output = []
    for market, (pid, flag, stat, thresholds) in MARKETS.items():
        needed = {pid, flag, stat, "week", "game_id", "season"}
        if not needed.issubset(pbp.columns):
            raise RuntimeError(f"Missing columns for {market}: {sorted(needed - set(pbp.columns))}")
        mask = pd.to_numeric(pbp[flag], errors="coerce").eq(1) & pbp[pid].notna()
        # PBP flags may include passing attempts for targeted/incomplete receptions;
        # only the receiver is counted, and a completion produces a catch of 1.
        subset = pbp.loc[mask, [pid, stat, "season", "week", "game_id"]].copy()
        subset["value"] = pd.to_numeric(subset[stat], errors="coerce").fillna(0)
        if market == "receptions":
            subset["value"] = subset["value"].clip(0, 1)
        games = (subset.groupby(["season", pid, "week", "game_id"], as_index=False)["value"]
                 .sum().sort_values(["season", pid, "week", "game_id"]))
        # No games without market involvement are added here. This is a limitation,
        # not a claim that zero-stat player games were observed.
        for (_, player), g in games.groupby(["season", pid], sort=False):
            vals = g["value"].astype(float).tolist()
            weeks = g["week"].tolist()
            for i in range(MIN_HISTORY, len(vals)):
                prior = vals[:i]
                recent = prior[-5:]
                # Laplace smoothing prevents impossible 0% and 100% claims.
                # Baseline is empirical season-to-date; challenger weights recent
                # five appearances. The shrinkage is learned only from 2024.
                for threshold in thresholds:
                    historical_hits = sum(v > threshold for v in prior)
                    recent_hits = sum(v > threshold for v in recent)
                    baseline = (historical_hits + 1) / (len(prior) + 2)
                    latest = (recent_hits + 1) / (len(recent) + 2)
                    output.append({
                        "season": int(g["season"].iloc[i]), "week": int(weeks[i]),
                        "player_id": str(player), "market": market,
                        "threshold": threshold, "hit": int(vals[i] > threshold),
                        "baseline": baseline, "recent": latest,
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
        pbp = frame(nflreadpy.load_pbp(seasons=[season]))
        pbp = pbp.loc[(pd.to_numeric(pbp["season"], errors="coerce") == season) &
                      (pbp["season_type"].astype(str) == "REG")].copy()
        if "no_play" in pbp:
            pbp = pbp.loc[pd.to_numeric(pbp["no_play"], errors="coerce").fillna(0).eq(0)]
        all_rows.extend(observations(pbp))
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
        by_market[market] = {"status": "RESEARCH_ONLY", "train": len(t), "holdout": len(h),
                             "weight_recent": weight, **evaluate(h, weight)}
    output = {
        "status": "RESEARCH_ONLY_NOT_BET_READY", "seasons": {"train": 2024, "holdout": 2025},
        "threshold_type": "fixed hypothetical thresholds, not sportsbook lines",
        "selection_bias": "Only players with recorded market involvement in PBP; zero-opportunity player-games may be missing.",
        "method": "Walk-forward per-player prior-game hit frequencies; blend weight chosen only on 2024, evaluated on 2025.",
        "limitations": ["Does not evaluate the live app's probability model", "No opponent adjustment",
                         "No injury-as-of verification", "No sportsbook pricing or SGP correlations",
                         "Not representative of every rostered player-game"],
        "bet_ready": False, "markets": by_market,
    }
    path = ROOT / "data/player_prop_probability_backtest.json"
    path.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(output, indent=2))

if __name__ == "__main__":
    main()
