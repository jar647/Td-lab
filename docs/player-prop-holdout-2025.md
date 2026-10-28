# NFL prop probability holdout: reviewed results

Source: GitHub Actions run 40685976999, job 122808311060, commit dc77243, 2026-10-28.
Workflow: NFL player prop probability holdout #5 (success).
This report transcribes the output of the research backtest. It is **not** an audit of live application probabilities.

Training: 2024. Untouched evaluation season: 2025.
Thresholds: illustrative fixed half-point yardage and catch thresholds (not sportsbook odds).
Scoring: Brier (lower is better); baseline = smoothed all-prior-game hit rate.
Model = same baseline blended with five-game hit rate; blend selected on 2024 only.

| Market | 2025 holdout rows | Model Brier | Baseline Brier | Model improves? |
| --- | ---: | ---: | ---: | --- |
| Passing yards | 1,304 | 0.179662 | 0.179286 | No |
| Rushing yards | 4,936 | 0.109658 | 0.109658 | No, tied |
| Receiving yards | 12,108 | 0.098221 | 0.098221 | No, tied |
| Receptions | 15,135 | 0.133574 | 0.133341 | No |

Calibration examples on 2025 holdout:
- Receiving yards predicted 70–80% bin: n=335, mean predicted 74.01%, observed 68.66%.
- Receptions predicted 70–80% bin: n=946, mean predicted 74.53%, observed 70.19%.
- Passing yards predicted 70–80% bin: n=156, mean predicted 74.46%, observed 71.15%.

## Decisions
1. Do not promote this model into live probability recommendations.
2. Preserve chronological train/holdout separation.
3. Fix eligibility: merge weekly roster/snap participation to include true active zero-use games, and distinguish inactive/DNP from zeros; don't use postgame participation as a pregame predictive feature.
4. Improve baseline: position-specific opportunity (pass attempts, carries, targets), team pace, defensive opponent adjustment, and game context. Evaluate each feature on a fresh holdout, against a market-specific baseline.
5. Report selection-aware calibration, intervals, and outcomes at real quoted lines before claiming edge.
6. Do not equate Monte Carlo iteration count with calibration.
