# THE PROP VAULT NFL probability engine: release audit

## Delivered engineering
- `nfl_game_engine.js`: generative matchup-first team plays, game scripts, pass/rush splits, competing receiver targets and runner carries; catches, yards, and QB passing totals driven by a shared scenario.
- `nfl_game_worker.js`: off-thread 10k, 50k, or 100k game trials for the analyst.
- `analyst.html`: simulates before selecting researched alternate-line candidates; displays per-leg scenario rates, a joint-ticket scenario rate, and a price comparison using only user-quoted Hard Rock American odds.
- `capture_game_first.js`: freezes pregame game-first forecasts immutably, only before the game-day UTC cutoff and only when an existing independently frozen baseline prediction is available at a matching threshold.
- `grade_prop_probabilities.py`: scores prior models and game-first models in independent versions using completed games and verified offensive participation.
- `data/forward/game_first_capture_status.json`: coverage and explicit blocked-game reasons.
- Automated checks: `test_nfl_game_engine.js`, `test_nfl_analyst_ui.js`, `test_capture_game_first.js`, Python historical participation and grading tests, all in the verified NFL feed workflow.

## 2026 week 8 initial release check (2026-10-28 UTC)
- 14 scheduled fixtures.
- 13 immutable pregame game-first snapshots, totaling 1,847 threshold-specific research forecasts.
- PHI vs WAS was **not** simulated for prospective capture because the current feed lacked enough position-verified quarterback passing history. This is intentionally a NO BET model-coverage failure, not a hidden default.
- The game-first model has **zero completed, graded forward testing weeks** at the time of this audit.
- The source reports no matched current-week final injury game designations, though practice warnings are present. Active roster membership does not establish game-day clearance.
- The existing `data/verification_status.json` continues to report `bet_recommendations_enabled=false`.

## Claims we must not make
- No scenario frequency is a validated true betting probability.
- 10k, 50k or 100k trials reduce Monte Carlo sampling error, not football model bias.
- Hypothetical half-point historical thresholds are NOT verified sportsbook offers.
- A Brier-score improvement on repeatedly inspected retrospective seasons is NOT a new independent final holdout.
- There is no verified real-world betting edge, ROI, or calibrated SGP price.
- The model lacks official pregame game-day active verification, weather/line movement and reliable current sportsbook pricing.

## Release gate for betting recommendation mode
1. Correct game-day active/inactive status and independent player/team identity verified.
2. An independent prospective grading set with at least eight weeks and enough per-market observations, plus reliable calibration and improvement over frozen baseline. Prevent revision of previously frozen forecasts.
3. Valid quoted market odds, with timestamps, identity/line match, and player eligibility.
4. Joint-ticket probability and correlation assumptions assessed on genuinely held-out combinations. No multiplication of individual legs as if independent.
5. NO BET when any evidence gate fails.

Until then the product is a **working game-first research simulator**, not a certified betting engine. The original NFL prop/TD app remains intact.
