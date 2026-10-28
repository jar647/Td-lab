# THE PROP VAULT NFL probability engine: implementation status

Updated 2026-10-28. The NFL analyst is a research product. **It is NOT a calibrated sportsbook probability or guaranteed betting system.**

## Verified work

1. `historical_participation.py` reconstructs positive offensive snap participation with an exact PFR-to-GSIS roster mapping and season/week/team schedule join. Snap-verified zero-stat games enter the research outcome dataset, while zero-snap DNP games do not.
2. `player_prop_probability_backtest.py` compares empirical historical prop hit rates with an opportunity-adjusted challenger using 2024 fitting and 2025 evaluation. The 2025 outcomes were examined during development, so this is no longer an untouched final holdout.
3. `build_feed.py` preserves limited and did-not-participate practice warnings separately from official game report statuses. **Practice DNP is not a game-day OUT designation.** Official status coverage remains incomplete in nflverse.
4. `analyst.html` shows feed freshness, injury-report coverage, and forward-validation status; avoids independently sampling the same player's receiving-yards and receptions histories; and labels Monte Carlo percentages as uncalibrated scenario frequencies.
5. `capture_prop_probabilities.py` freezes timestamped research-only prop forecasts **before the conservative UTC game-day cutoff**. Snapshots are create-only. The first 14 Week 8 fixture captures used exploratory model v1 and are preserved.
6. Subsequent captures use model `opportunity-2024-trained-eligible-fullseason-v2`: five or more completed player games, all season-to-date game history, and minimum prior market opportunities. Future captures retain pregame status flags and calibrated-status=false.
7. `grade_prop_probabilities.py` grades only after results and snap participation are available, keeps nonparticipants ungraded, and separates snapshots by model version. Forward research review requires at least eight graded weeks and 500 eligible observations **from the same current version**. Passing review thresholds would not automatically enable betting.
8. Existing GitHub Actions feed schedule runs capture and grade; tests prevent leakage, history mutations, DNP misclassification and malformed duplication.

## 2025 retrospective results after snap verification

| Market | Simple Brier | Opportunity Brier |
| --- | ---: | ---: |
| Passing yards | 0.175270 | 0.175137 |
| Rushing yards | 0.105329 | 0.103230 |
| Receiving yards | 0.090137 | 0.088208 |
| Receptions | 0.123389 | 0.122101 |

These are research improvements at hypothetical thresholds, **not evidence of sportsbook profitability**. Multiple thresholds for the same player-game are correlated.

## Remaining blockers

- **Independent forward validation:** Wait for naturally completed future fixtures, verified postgame snap outcomes, and sufficient new-version weeks. Never retroactively tune frozen predictions.
- **External data verification:** Official injury/game-day inactives, roster completeness, and sportsbook-offered lines remain incomplete with the available free sources.
- **True game simulator:** The live HTML Monte Carlo is a correlated *prop scenario explorer*, not a fully trained drive/play-level game simulator. Developing a possession-based simulator requires historical validation.
- **Odds and SGP calibration:** Joint ticket probabilities and sportsbook pricing are not independently established. No betting edge can currently be claimed.
- **Market-level release gates:** Evaluate validation, reliability and sample confidence separately for each market before publishing calibrated true probabilities.

## Regression

- `python -m unittest discover -s tests -p 'test_*.py'`
- `python -m unittest test_player_prop_probability.py`
- `node test_analyst_ui.js`
- `python capture_prop_probabilities.py` (only before relevant game-day cutoff, creates immutable snapshots)
- `python grade_prop_probabilities.py`

Current operational report: `data/forward/prop_probability_performance.json`. Live research UI: `analyst.html`.
