#!/usr/bin/env python3
"""Evidence gate for THE PROP VAULT. Does not infer betting value from projections.

Checks persisted audits; missing or incomplete evidence always blocks launch.
Run from repository root: python audit_probability_readiness.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"

def read(name):
    path = DATA / name
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return None

def assess(data):
    checks = []
    def check(name, passed, detail):
        checks.append({"check": name, "passed": bool(passed), "detail": detail})

    feed = data.get("feed_audit.json") or {}
    check("external_boxscore_verification",
          feed.get("external_boxscore_verified") is True,
          "Internal feed reconciliation alone does not verify external box scores.")

    history = data.get("history_audit.json") or {}
    eligible = history.get("eligible_graded_weeks", 0)
    check("prospective_holdout_history",
          isinstance(eligible, int) and eligible >= 8,
          f"Eligible graded forward weeks: {eligible}. Require at least eight.")

    prob = data.get("probability_model.json") or {}
    check("calibrated_probabilities_available",
          prob.get("status") == "validated" and prob.get("test_weeks", 0) >= 8,
          f"Calibration status: {prob.get('status', 'missing')}. No probability claim without holdout evaluation.")

    game = data.get("game_picks_simulator_audit.json") or {}
    holdout = game.get("holdout") or {}
    totals = holdout.get("over_total") or {}
    comparisons = game.get("total_market_comparison") or {}
    model_only = comparisons.get("model_only") or {}
    market_only = comparisons.get("market_only") or {}
    model_brier = model_only.get("brier")
    baseline_brier = market_only.get("brier")
    total_ready = (
        isinstance(model_brier, (int, float))
        and isinstance(baseline_brier, (int, float))
        and model_brier < baseline_brier
        and game.get("total_recommendation_enabled") is True
        and totals.get("games", 0) >= 200
    )
    check("game_total_beats_baseline", total_ready,
          f"Model Brier: {model_brier}; baseline Brier: {baseline_brier}. Lower is better.")

    cover = holdout.get("home_cover") or {}
    check("spread_holdout_present",
          cover.get("games", 0) >= 200 and isinstance(cover.get("brier"), (int, float)),
          f"Spread holdout games: {cover.get('games', 0)}.")

    backtest = data.get("backtest_report.json") or {}
    check("player_prop_projection_baseline",
          len(backtest.get("results") or []) >= 4,
          "Walk-forward player prop error report missing; projection MAE is not calibration.")
    check("player_prop_probability_calibration",
          False,
          "No held-out, line-specific prop hit-rate calibration and baseline comparison is established.")

    return {
        "schema_version": 1,
        "status": "READY" if all(c["passed"] for c in checks) else "NOT_READY",
        "bet_ready": all(c["passed"] for c in checks),
        "checks": checks,
        "note": "This is an evidence inventory, not a historical backtest or a certification of accuracy. Missing evidence fails closed."
    }

def main():
    names = ("feed_audit.json", "history_audit.json", "probability_model.json",
             "game_picks_simulator_audit.json", "backtest_report.json")
    result = assess({name: read(name) for name in names})
    out = DATA / "probability_readiness.json"
    out.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    # Not ready is an expected model status, not a CI execution failure.
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
