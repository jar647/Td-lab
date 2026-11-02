# CoOk It Up

AI-powered NFL and NBA sports analytics research app (previously THE PROP VAULT).

Live app: https://jar647.github.io/Td-lab/
NFL game analyst: https://jar647.github.io/Td-lab/analyst.html
NBA edition: https://jar647.github.io/Td-lab/nba.html

Research outputs are not a guarantee of betting outcomes. The existing Github Pages URLs, model, data feeds, and browser storage keys are intentionally preserved during rebranding.

## Experimental two-sided player price audit

NFL and NBA cards compare a manually entered Vegas line and optional Over/Under American odds with a matchup-shifted empirical distribution built from **recorded player-game outcomes**, plus a small normal-distribution prior for sparse histories. It blends season and recent production, then applies bounded recent-workload, opponent-allowance, and availability adjustments when those inputs are present. Whole-number lines include a push probability. The card reports Over/Under probabilities, each side's break-even probability, no-vig market shares, estimated edge, push-aware expected return, sample size, and the matchup inputs used. At least five actual player games are required to display an estimate; price-sensitive LEANs also require at least eight games and both recent workload and opponent-specific allowance data.

**Calibration and decision gates:** the live probability distributions are explicitly uncalibrated. A clear price and uncertainty signal can return LEAN for research, but PLAY requires a matching live-model version with at least eight independent holdout weeks, 500 graded forecasts overall, 40 outcomes for the market, Brier score better than its baseline, and maximum calibration error of 5% or less. The app currently has no approved calibration record wired to this gate, so it will not issue PLAY. Missing player history, recent workload, opponent-specific allowance, or safe availability; invalid odds; and unstable projection conflicts lead to PASS. Odds are entered by the user and saved locally; no live sportsbook prices are invented. No-vig market probabilities are shown separately from model probabilities. Existing NFL/NBA game features and forward-tracking gates are preserved.

## NBA published pipeline (branch implementation; not live verified)

`python nba_pipeline.py` publishes `data/nba_analysis.json` and append-only pregame forecasts in `data/nba_pipeline_locks.json`. The NBA refresh workflow runs it after the schedule, roster and injury updates. The added panel displays these same published projections; the older exploratory UI/tracker remains separate for compatibility. Do not treat the older tracker as evaluation of this model.

The model uses 5–10 completed regular-season appearances, per-minute production, recent minutes, a small back-to-back adjustment and shrunk opponent team allowance. OUT/doubtful players and players absent from the current roster are excluded. Unresolved rotation availability blocks recommendations. It does not estimate a new rotation or redistribute a missing star's usage. Quotes older than one hour, injury/box-score feeds older than six hours and rosters older than 24 hours block recommendations.

Joint simulations resample the same historical team-game for teammate stats, preserving observed within-team dependence. Opposing teams are sampled independently. Missing joint observations count as failures, a conservative limitation. This is an uncalibrated bootstrap, not a validated betting edge. Projections remain separate from recommendations; PASS is expected when prices are unavailable.

### NBA market adapter contract

The repository currently has **no connected NBA prop/SGP price provider**. Supply a provider-authenticated `data/nba_market_odds.json` before expecting autonomous priced recommendations. Keep provider credentials in GitHub Actions secrets. No fake sample quote is published.

```json
{
  "generated_at": "ISO-8601 UTC timestamp",
  "markets": [
    {"game_id":"ESPN event ID", "player_id":"ESPN player ID", "market":"points", "side":"over", "line":24.5, "american_odds":-110}
  ],
  "sgp_quotes": [
    {"game_id":"ESPN event ID", "legs":["PLAYER_ID:points:over:24.5", "OTHER_ID:rebounds:under:8.5"], "decimal_odds":4.2}
  ]
}
```

Supported markets: points/rebounds/assists, over/under. SGPs use 2–5 distinct players and require the **actual combined sportsbook quote**; individual prices are never multiplied to invent SGP prices. Whole-line pushes are conservatively counted as non-wins for the estimate; frozen grading marks push/void tickets as unsettled pending book rules. Research leans require estimated EV above 5%; no calibration claim is made.

Locks are first eligible pregame captures, never retrospectively created or overwritten. Final box scores add grading alongside the original projections. DNPs and absent results are explicit; projection MAE and SGP settlement are different measurements.

Remaining release gates: connect and validate live price ingestion; establish injury-driven rotations and cross-team correlation; unify the legacy projection display; verify the branch in a browser, pass CI, merge/deploy through review, and test the deployed SHA. A PR does not mean the live app has these changes.
