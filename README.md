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


### NBA possession simulator candidate

Both the in-game NBA simulator and the dedicated 100,000-run screen now use `nba_possession_engine.js`. An independent score forecast comes from shared estimated possessions and active-roster rotations. Every draw generates player points, rebounds and assists; player points sum to team scores and combos/selected same-game legs use those same draws. Injury absences remove players and redistribute the regulation 240-minute team budget (40-minute individual cap). Questionable availability uses explicitly labeled equal-weight in/out sensitivity assumptions, not claimed injury probabilities. Overtime adds 25 team minutes per five-minute period; fourth-quarter blowouts alter rotation weights. Main-page simulation runs in a worker.

Possessions are a box-score approximation: average both teams' FGA + 0.44 FTA − OREB + turnovers, normalized to 48 minutes using observed team minutes. Shot-description data are used for close/rim (explicit ≤4 feet or an undistanced layup/dunk), other twos and threes only when opening play-by-play and ≥80% FGA coverage can be verified. Otherwise the model falls back to observed two/three-point splits; no optical tracking, defensive assignments or player positions are invented. Observed shooting, FT, turnover and rebounding data feed the offense/defense matchup. Rest, venue, opponent-strength and venue-change fatigue adjustments are bounded hypotheses and remain uncalibrated. The venue-change flag is not actual travel mileage or a flight itinerary.

Reference definitions: [NBA pace and efficiency](https://jr.nba.com/basictraditional-stats-vs-advanced-stats/), [NBA statistical glossary](https://www.nba.com/stats/help/glossary). Source: ESPN public scoreboards, shooting box scores and play descriptions. The possession formula is an approximation, not an official possession count. Free-throw trips, lineups and end-game behavior are simplified; no source provides confirmed five-player units here.

Your spread/total/ML prices do **not** steer independent draws. The UI displays the entered market score benchmark separately. On-device immutable pregame captures grade final results and compare 0%, 25%, 50% and 100% market blends only where original quotes exist. Server publication (`node scripts/publish_nba_simulator.js`) freezes independent forecasts and player projections, grades completed games once, and provides margin/total MAE, Brier/calibration and an earlier-box-score-only retrospective comparison against the original score baseline. Existing prediction archives remain separate. Historical injury/roster announcements and market quotes are unavailable for the retrospective test, so it cannot validate current injury effects or profitability. No blend is automatically promoted and no candidate betting signal is approved before prospective calibration review.

`data/nba_simulator_report.json` exposes the measured comparison and `data/nba_simulator_locks.json` preserves forecast revisions. A more detailed simulator is not automatically more accurate: promotion is OFF pending prospective evidence. The first retrospective comparison was mixed. No improved-accuracy or betting-edge claim is made. NFL models and existing NBA prop ratings/Quick Slip behavior are unchanged.

### NBA live game context

The possession candidate now reads free NBA.com daily lineups and defensive tracking (`nba_game_context.py`). Confirmed roster availability is distinct from a confirmed starting five: only five explicit positional `Confirmed` starter records qualify. Current confirmed inactive players are excluded. Unsupported confirmed starters stop the run instead of being silently ignored. Tracking names are uniquely cross-mapped to the current roster; stale/future/wrong-season records do not affect draws. Historical opponent exposure and position-aware projected-minute mixtures blend a small, heavily shrunk defended-FG effect into existing team defense. These mixtures estimate who may defend a player; they are not announced assignments or tactical coverage.

Completed ESPN substitutions reconstruct quarter minutes only when quarter boundaries, five-player states and individual box minutes reconcile. At least three verified games are required for a player's quarter pattern. Observed quarter usage shapes the rotation while preserving the team 240-minute budget and 40-minute individual cap. Missing sequences retain the ordinary rotation. Future coaching plans, exact switching/help coverage, injuries during the game and future tactical decisions remain unknown.

A separate free-source workflow checks availability/lineups every five minutes within six hours of games (GitHub scheduling can be delayed). Both NBA simulator pages fetch the latest snapshots before each run and check for changes every minute while visible; changed relevant information invalidates old results without erasing entered odds. Inside 90 minutes of tipoff, availability older than 15 minutes blocks simulation. A source outage never advances an old confirmation timestamp. Tracking refreshes daily and expires after 48 hours. Existing frozen v1 forecasts remain intact; v2 captures grade separately. No claim of improved accuracy is made.

NBA Stats endpoints may time out on hosted runners. The app also requests those same public NBA endpoints directly from the browser (the official responses permit cross-origin reads), with a real timestamp and a daily device cache that expires after 48 hours. If both paths fail, individual defender adjustment is omitted and labeled; no synthetic tracking data are substituted. Server forecasts use only the sources they actually captured and may omit tracking when that source is unavailable.

The repository includes an initial real NBA.com tracking snapshot (`data/nba_tracking_snapshot.json`) captured with its original source timestamp. It can bootstrap a dated fallback when hosted requests fail; it does not renew itself and is rejected after 48 hours or across seasons. The UI states when this fallback is used. Automated collectors retry on the next daily cycle. Current confirmations/availability are refreshed separately and cannot be renewed by the tracking cache.

### Simulator availability and refresh recovery

Every upcoming NBA matchup remains in the dedicated simulator selector, and choosing a game opens its inputs before validating the model. Run refreshes availability first; genuine data/model failures remain visible with entered quotes intact. Games that have tipped off retain an explicit closed-simulation indicator. If published injuries are older than ten minutes, the browser requests the public ESPN injury endpoint directly, validates a nonempty report and preserves its retrieval/source timestamps. Near-tip freshness checks remain in force.

The five-minute availability writer runs independently of slower score/forecast publication. The full publisher restores the availability writer's files before its own commit and rebases that completed data commit over disjoint updates, avoiding a full recomputation loop or overwriting newer injury/lineup snapshots.
