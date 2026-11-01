# NFL data checks and forecast validation

`score-baseline-trust-v3` uses the historical scoring baseline. EPA/success
corrections remain visible as experimental context but are **not applied**.
The existing paired historical records show no established improvement over
the simpler baseline. No model probability or betting edge is certified.

## What is checked before publication

- The slate uses only completed regular-season games before the target week.
- Every scheduled completed game must have offensive and defensive EPA coverage.
- Duplicate game/play IDs fail the build.
- A separate pandas reducer must reproduce every season/recent team rate from
  the raw plays to within 1e-9. Missing EPA counts are reported, not filled.
- The audit records sample game IDs, play counts, definitions, check time, and a
  digest of the source rows. Source upstream update time is explicitly unknown.
- JSON files are validated and the workflow publishes them together only after
  all required checks pass. A failed run does not publish partial data.

These are two calculation paths over **one source** (nflverse). They do not
constitute independent external box-score verification. EPA itself is a
source-model estimate. Source corrections can change historical rates.

## Quarterback changes

Sourced, game-scoped expected starters come from `data/nfl_starters.json`.
Without such confirmation the UI says starter unconfirmed. It does not infer
clearance from a missing injury report.

A QB-led sample includes only completed team games in which that QB had at
least 80% of identified pass plays and at least ten passes. Other and mixed
games are shown separately. The recent four-game sample is checked for another
primary passer. This is a descriptive team-game comparison, not a causal QB
effect; opponent quality, game script, and other injuries differ. The model
does not invent a point bonus for a returning player.

Schedule `gametime` is Eastern for every stadium, per the nflverse schedule
dictionary. Weather matching and forecast capture use that convention with DST.

## Historical and prospective evidence

`game_model_validation.json` compares paired baseline/experimental score errors
using the existing prior-week walk-forward records. The 95% improvement interval
uses 2,000 bootstrap draws clustered by season/week. This is retrospective
research, not an untouched holdout or an ROI study. The simulator must use
baseline residuals for baseline projections, not errors from another model.

`game_score_forecasts.json` freezes the first eligible baseline forecast per
game/version before scheduled kickoff. It stores source/code identity, seed,
draw count, and QB context. Existing forecasts are never overwritten or filled
in after kickoff. Only prior-calendar-day schedule finals are graded. The
scorecard reports margin/total MAE, non-tie winner Brier score, and calibration
bins, with results also grouped by code signature. Existing grades are retained
for review; stat-correction reconciliation is not automated.

Keep a new model version when changing forecasting behavior. Never manufacture
an accuracy record by replacing old predictions. Small samples, raw hit rates,
and more simulation draws do not establish calibration or a betting edge.
NFL price comparisons stay PASS while source freshness, lineup effects, or
probability calibration are unverified. Historical/scenario outputs remain
available as research.

## Focused checks

```sh
python -m unittest discover -s tests -p 'test_game_*.py'
node test_game_odds.js
node test_game_odds_ui.js
node test_game_trust_ui.js
node test_game_score_forecasts.js
```
