# Game projection accuracy and validation

The NFL production model is `score-baseline-pbp-v3`. It remains an uncalibrated research model. Correct arithmetic, more simulations, and historical win rates alone do not establish a betting edge.

## What changed

- The EPA and success-rate adjustment now adds offensive efficiency and defensive **allowance**, each centered on the league rate from earlier weeks. Worse defensive allowance increases projected scoring. The previous formula subtracted allowance, reversing that direction.
- League centers, season/recent rates and baseline scores exclude the target week. Neutral venues receive neither a home advantage nor designated home/away scoring splits.
- The production score baseline, EPA comparison and market comparison share the same generated historical projections. The separate historical challenger formula has been removed.
- The simulator refuses to mix score-model versions. Rebuild both the slate and residual history when changing versions.
- ATS history uses the documented nflverse convention: positive `spread_line` means the home team is favored. Therefore `homeSpread = -spread_line`, and cover settlement is `home_score + homeSpread - away_score`. Conflicting explicit home handicaps fail validation. Source: https://github.com/nflverse/nflreadr/blob/main/data-raw/dictionary_schedules.csv

## Reproduce the reports

Requires Python dependencies from `requirements.txt`, Node 22+, and access to nflverse data.

```sh
python game_picks_backtest.py
python game_picks_epa_backtest.py
python game_picks_market_backtest.py
python game_picks_simulator_audit.py
python game_picks.py
```

The final audit calls the actual `nflGame()` and `simulate()` functions in `game_odds_engine.js`, with 100,000 draws and the same fixed seed as the page. It uses only earlier weeks/seasons of paired score errors, including historical sample and context fallback rules. Warm-up games lacking 40 earlier residuals are reported as skipped. The report includes every forecast and its residual sample size.

The historical audit cannot reconstruct archived pregame weather forecasts. It disables **target** weather/roof matching rather than using observed game weather in hindsight. Rest/travel matching remains active. Earlier-game observations are allowed in the earlier residual pool. Live forecasts may use current weather, so historical validation does not cover that component fully. Injuries and projected lineups remain context, not fitted point adjustments.

Outputs distinguish score error, binary Brier/log loss conditional on no push, three-outcome Brier including pushes, calibration bins with observed-frequency intervals, and comparisons against the no-vig market on the **same priced games**. The 2025+ slice is a chronological evaluation period, not an untouched test set after developers have reviewed it. No calibration parameters are fitted. Closing-price selection returns are hypothetical research, not executable returns.

A compact `data/game_picks_validation_summary.json` feeds the page without downloading all historical forecast records. The Game Odds page displays the matching model's historical market comparisons. It never uses this report to automatically unlock an ATS recommendation.

## Record real pregame quotes

No new paid odds provider is configured. Existing historical schedule lines remain labeled closing proxies. To capture newly observed prices from a source you can access, prepare this schema with the **actual current observation time**, actual kickoff, source and sportsbook:

```json
{
  "captured_at": "2026-11-01T17:30:00Z",
  "source": "your quote source or manually observed sportsbook screen",
  "sportsbook": "your sportsbook",
  "games": [{
    "game_id": "provider game id",
    "home": "HOME", "away": "AWAY",
    "kickoff": "2026-11-01T18:00:00Z",
    "homeML": -150, "awayML": 130,
    "homeSpread": -3, "homeATS": -110, "awayATS": -110,
    "total": 44.5, "over": -115, "under": -105
  }]
}
```

```sh
python scripts/archive_game_odds.py quotes.json
```

You may omit a whole market, but a supplied market needs both prices and its line. The importer rejects future captures, captures older than 15 minutes, post-kickoff quotes, invalid prices and duplicate games. Archives are immutable and idempotent; changed quotes create separate files. Timestamp and schema validation cannot authenticate a user-supplied price. These snapshots support future decision-time/closing comparisons; they do not retroactively certify execution, opening prices or model forecasts.

## Automated checks

`Validate Production Game Projections` rebuilds projections, comparisons and the exact-engine audit in sequence. Pull requests retain reports as artifacts without publishing data. Main-branch and scheduled runs publish the reports. Manual EPA/market workflow entry points call this same pipeline, preventing older formulas or stale inputs from being audited independently.

## Evidence-led NFL handicap report

The Game Handicapper takes the supplied odds and produces three separate directional predictions (winner, ATS and total), fair model prices, the best-priced side among the supplied quotes, and a decision that can remain PASS even when one side is more likely to win. The report lists explicit baseline/EPA scoring contributions; descriptive evidence is labeled separately rather than being assigned invented coefficients.

The feed now adds prior-week season/recent passing and rushing efficiency/success, sacks and QB hits per passing play, explosive plays, third-down conversion, red-zone touchdowns per known drive, neutral early-down pass rate, pass rate above expected where available, and fourth-down go rate. Each statistic has a sample count. Descriptive schedule-adjusted EPA evaluates opponents on their other earlier games. These additional statistics are research evidence, not a newly fitted scoring model. Coaching tendencies reflect game situation and personnel as well as coach decisions.

Timestamped ESPN injury notes supplement, and remain separate from, roster-checked nflverse injury reports. Team identities, source season and timestamps are checked; future rows and stale source payloads are rejected. Secondary reports are not official inactive confirmations. Missing reports never imply a healthy team. Cross-source status conflicts and an unavailable historical high-usage quarterback flag the forecast for review. Official inactives are required for a clean review inside 90 minutes of kickoff. Replacement-player point effects remain explicitly unestimated.

The report checks model freshness, pregame timing, injury coverage, unresolved source conflicts and matching-version market benchmarks. It does not promote a market that failed its historical no-vig benchmark. Directional forecasts remain visible alongside that PASS decision. Research coverage counts are not win probabilities.

Sensitivity is computed by exactly enumerating the production paired-residual distribution under hypothetical team-mean shifts of ±1.5 points, giving margin/total scenarios. These are sensitivity assumptions, not injury estimates or confidence intervals. Their baseline agrees with the 100,000-draw simulation up to Monte Carlo noise.

Kickoff conversion now follows the documented nflverse Eastern-time convention, with daylight saving handled by the timezone library. Neutral-site weather is omitted until actual venue coordinates are verified. Games with a known passed kickoff are excluded from the pregame selector; a same-day game with no verified time is also excluded.
