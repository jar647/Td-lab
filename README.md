# CoOk It Up

AI-powered NFL and NBA sports analytics research app (previously THE PROP VAULT).

Live app: https://jar647.github.io/Td-lab/
NFL game analyst: https://jar647.github.io/Td-lab/analyst.html
NBA edition: https://jar647.github.io/Td-lab/nba.html

Research outputs are not a guarantee of betting outcomes. The existing Github Pages URLs, model, data feeds, and browser storage keys are intentionally preserved during rebranding.

## Experimental two-sided player price audit

NFL and NBA cards compare a manually entered Vegas line and optional Over/Under American odds with a matchup-shifted empirical distribution built from **recorded player-game outcomes**, plus a small normal-distribution prior for sparse histories. It blends season and recent production, then applies bounded recent-workload, opponent-allowance, and availability adjustments when those inputs are present. Whole-number lines include a push probability. The card reports Over/Under probabilities, each side's break-even probability, no-vig market shares, estimated edge, push-aware expected return, sample size, and the matchup inputs used. At least five actual player games are required to display an estimate; price-sensitive LEANs also require at least eight games and both recent workload and opponent-specific allowance data.

**Calibration and decision gates:** the live probability distributions are explicitly uncalibrated. A clear price and uncertainty signal can return LEAN for research, but PLAY requires a matching live-model version with at least eight independent holdout weeks, 500 graded forecasts overall, 40 outcomes for the market, Brier score better than its baseline, and maximum calibration error of 5% or less. The app currently has no approved calibration record wired to this gate, so it will not issue PLAY. Missing player history, recent workload, opponent-specific allowance, or safe availability; invalid odds; and unstable projection conflicts lead to PASS. Odds are entered by the user and saved locally; no live sportsbook prices are invented. No-vig market probabilities are shown separately from model probabilities. Existing NFL/NBA game features and forward-tracking gates are preserved.

## NBA published analyst (PR #22)

The published NBA analyst panel reads `data/nba_analysis.json`. `nba_model.py` and `nba_pipeline.py` produce its projections, recommendations, simulations and frozen evaluation together. Interactive game analysis, simulation, first-basket research, player/combination props, manual line/odds checks and Quick Slip remain visible in the main game view. Direct navigation links lead to either section. The interactive tools and published analyst are separate experimental calculations; the earlier-model tracker is not evidence for the published model.

### Model and decision behavior

- Prior completed regular-season box scores only, current ESPN roster membership, player-ID/name injury matching, recent starts and appearances. No future/live box-score leakage.
- Allocate a 240-minute team rotation, cap players at 40 minutes, redistribute known absences and apply a small back-to-back weight adjustment. Insufficient depth, large role changes and unresolved rotation injuries block recommendations. Starting fives are projected, not confirmed.
- Per-minute recent production and shrunk opponent allowance generate points, rebounds, assists and PR/PA/RA/PRA forecasts. Shared scoring-environment scenarios, team-game resampling and common blowout-minute changes model dependence. Combo outcomes equal their components. This is an uncalibrated heuristic model; the scoring-environment proxy is not measured possessions or a validated pace model.
- Fresh single quotes are evaluated with pushes, expected return, break-even price and an opposite-side no-vig comparison when available. Best single and top three distinct players are independent of whether an SGP quote exists.
- Actual SGP quotes must match 2–5 distinct players, the exact selections and one sportsbook. Missing/stale quotes cannot produce an SGP value claim. Missing joint observations are tracked and at least 80% joint observed coverage is required.
- When prices are missing, supported projections may produce an explicitly **unpriced research target**, model fair price and minimum acceptable combined price. This is not a priced recommendation or a claim that the sportsbook offers those lines. No individual prices are multiplied into fake SGP odds.

### Existing provider integration

`python -m scripts.build_nba_odds` uses the existing `ODDSPAPI_API_KEY` GitHub Actions secret. It discovers the basketball market catalog, matches NBA fixtures by both teams and tipoff, resolves player names uniquely against ESPN IDs/current rosters, and accepts only active full-game O/U prices from Hard Rock Bet. Unknown/partial-game markets, ambiguous names and malformed prices are rejected. Provider failures retain the previous feed without refreshing its timestamp; a sanitized status is published in `data/nba_market_status.json`. Credentials never enter output or logs.

The prop endpoint does not supply combined SGP quotes. The adapter optionally imports fresh same-book captures from `data/nba_sgp_quotes.json`; it never invents a combined price. Source reference: https://oddspapi.io/blog/player-props-api-nfl-nba-mlb-odds-python/

The normalized `data/nba_market_odds.json` contract is:

```json
{
  "generated_at": "2026-11-01T12:00:00Z",
  "status": "ok",
  "markets": [
    {"game_id":"ESPN_ID", "player_id":"ESPN_PLAYER_ID", "market":"points", "side":"over", "line":24.5, "american_odds":-110, "bookmaker":"hardrockbet", "observed_at":"2026-11-01T12:00:00Z"}
  ],
  "sgp_quotes": [
    {"game_id":"ESPN_ID", "bookmaker":"hardrockbet", "observed_at":"2026-11-01T12:00:00Z", "legs":["ESPN_PLAYER_ID:points:over:24.5", "OTHER_ID:rebounds:under:8.5"], "decimal_odds":4.2}
  ]
}
```

Supported market keys: `points`, `rebounds`, `assists`, `points_rebounds`, `points_assists`, `rebounds_assists`, `pra`. Each combined quote needs its own original observation timestamp. Fetching fresh individual prices never renews an old SGP quote.

### Scheduling, freezing and grading

The NBA refresh workflow runs every 30 minutes (GitHub schedules can be delayed), reusing the existing secret. Odds expire after one hour; injuries/box scores after six hours; rosters after 24 hours. The UI checks age, future timestamps, tipoff and each selected quote again at display time, and discards out-of-order responses when the matchup changes.

Every changed eligible pregame forecast is frozen with a content ID in `data/nba_pipeline_locks.json`. Prior captures are never rewritten when injuries, lines or projections change. Unchanged predictions are deduplicated, including refresh-only timestamps. A record blocked by data/availability gates is not labeled frozen. Final results attach projection errors and actual selection grading. Missing final rows are retried on later refreshes. Evaluation selects one latest valid pregame capture per game/model, preventing revisions from inflating the graded sample. MAE is not a betting hit rate. Push/void SGPs require sportsbook settlement rules and are not credited as full wins.

### Verification and remaining live gate

Regression CI covers all root/tests Python and JavaScript suites, including NFL. A separate same-repository PR job refreshes the real NBA inputs, checks the existing provider secret/entitlement, runs the model, and uploads sanitized live-input evidence. It fails its live-odds gate when current supported prices cannot actually be fetched.

PR checks and source changes do not establish a deployed release. Combined SGP quote ingestion remains required for an autonomous **priced** SGP recommendation; no undocumented combined-price endpoint is assumed. Confirm the live-input job, review/merge/deploy, then verify the deployed SHA and NBA flows before claiming operational completion. NFL source/data and its existing workflows are unchanged.


## NBA recommendation ordering

The interactive NBA price cards evaluate both Over and Under using the same review shown on each card. Fresh same-game Hard Rock prices can populate the line and both sides; manual entries take precedence. Numbered recommendations contain the top three distinct players whose final review qualifies as LEAN/PLAY, ordered by modeled expected return, then edge. Additional qualifying markets remain available separately. Missing line/price candidates are labeled Awaiting odds; PASS props move to Not recommended, and no qualifying selections yields an explicit no-recommendation message.

Changing a quote updates the verdict, rank and Quick Slip direction together without rebuilding the input controls. Changing the line clears the old prices. Imported prices expire after one hour, including the unedited imported side of a partially edited quote. These are research rankings, not calibrated betting-edge claims; existing status, sample, uncertainty and price gates remain in force.

### NBA slate shortlist

Use **Today’s best props → Find today’s best props** to compare all upcoming games using the same price verdict as the individual game cards. The board selects at most five qualifying Over/Under leans with one distinct player per game; three-pointers are excluded. It does not force five picks or claim a combined parlay price. Each add rechecks eligibility and current odds.

If automatic prices are stale or unavailable, a separate research shortlist offers direct links to a few price checks. Unpriced and PASS props cannot be added through the slate board. Existing game tools and NFL behavior are unchanged.

NBA unpriced slate research now shows hypothetical Over/Under shopping targets instead of player names alone. Each target must clear the existing final verdict at -110, within 25% of the forecast (minimum two units, maximum eight). Targets are sorted by relative distance to forecast, then evidence quality; at most five, one player per game. Worst acceptable prices are checked in ten-point steps down to -200. Actual sportsbook availability is not asserted and no target is stored as an offered quote or added directly to the slip.

NBA qualified props receive a heuristic Prop score /100 only after the final LEAN/PLAY verdict. The breakdown allocates 20 points to estimated price edge (saturates at 20 percentage points), 15 to modeled expected return (30%), 25 to conservative probability cushion (15 percentage points above break-even), 20 to recorded history (20 games), and 20 to recent minutes stability plus observed stat consistency. Availability, matchup inputs and minimum evidence remain mandatory eligibility gates. Qualifying props rank by score before return/edge tie-breakers. Scores are not win probabilities, validated confidence, or a ticket correlation assessment; unpriced shopping targets and PASS props are unscored.

NBA per-game research now shows at most three distinct players across qualified props and matchup shopping targets. Target direction comes from shrunk opponent stat allowance, scoring environment, recent minutes trend, recent production and bounded injury opportunity; weak cases, stale inputs and targets failing the existing price/evidence gates are excluded. Ranking favors stronger supported matchup cases and discounts large projected score gaps. Team offense versus opposing allowance supplies a clearly labeled scoring outlook; possession pace, positional defense and confirmed lineups are not invented. Combo forecasts now aggregate opponent/minutes/injury-adjusted components with actual same-game history. Other markets remain under closed Advanced research.

NBA Quick Slip entries retain the Prop score shown when saved, along with the rated side, line, price and save timestamp. Both per-game and slate additions carry the rating. The slip labels it Saved rating /100, not a current forecast or win probability. If the quote no longer matches the rating payload at add time, the score is discarded; legacy/unrated NBA entries show No saved rating. Re-adding the same selection updates its snapshot.

Legacy NBA Quick Slip entries now recover a current rating automatically as NBA research loads, or through Recover missing ratings. Recovery uses the saved side/line/price, with a matching locally entered price only when the saved price is missing. Existing saved ratings and all selections remain intact. Recovered scores are labeled Recalculated rating; missing odds or a quote that no longer qualifies receive an explicit explanation rather than an invented score.
