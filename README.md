# CoOk It Up

AI-powered NFL and NBA sports analytics research app (previously THE PROP VAULT).

Live app: https://jar647.github.io/Td-lab/
NFL game analyst: https://jar647.github.io/Td-lab/analyst.html
NBA edition: https://jar647.github.io/Td-lab/nba.html

Research outputs are not a guarantee of betting outcomes. The existing Github Pages URLs, model, data feeds, and browser storage keys are intentionally preserved during rebranding.

## Experimental two-sided player price audit

NFL and NBA cards compare a manually entered Vegas line and optional Over/Under American odds with a matchup-shifted empirical distribution built from **recorded player-game outcomes**, plus a small normal-distribution prior for sparse histories. It blends season and recent production, then applies bounded recent-workload, opponent-allowance, and availability adjustments when those inputs are present. Whole-number lines include a push probability. The card reports Over/Under probabilities, each side's break-even probability, no-vig market shares, estimated edge, push-aware expected return, sample size, and the matchup inputs used. At least five actual player games are required to display an estimate; price-sensitive LEANs also require at least eight games and both recent workload and opponent-specific allowance data.

**Calibration and decision gates:** the live probability distributions are explicitly uncalibrated. A clear price and uncertainty signal can return LEAN for research, but PLAY requires a matching live-model version with at least eight independent holdout weeks, 500 graded forecasts overall, 40 outcomes for the market, Brier score better than its baseline, and maximum calibration error of 5% or less. The app currently has no approved calibration record wired to this gate, so it will not issue PLAY. Missing player history, recent workload, opponent-specific allowance, or safe availability; invalid odds; and unstable projection conflicts lead to PASS. Odds are entered by the user and saved locally; no live sportsbook prices are invented. No-vig market probabilities are shown separately from model probabilities. Existing NFL/NBA game features and forward-tracking gates are preserved.
