# NFL opportunity-adjusted probability model: research results

Run: GitHub Actions `NFL player prop probability holdout #8`, workflow run `40686546158`, commit `140ec293e4cac59311628f091d3d361e8ecc757d`, 2026-10-28, successful.

The new `opportunity_prop_model.py` uses historic per-game opportunities (pass attempts, carries or targets) to adjust previous game outputs to a blended expected usage level. Scaling is bounded to 0.5x–1.5x. Model weights were selected by 2024 observations, then evaluated on 2025 records. No live picks changed.

| Market | 2025 evaluated predictions | Prior-hit-rate Brier | Opportunity model Brier | Improvement |
| --- | ---: | ---: | ---: | ---: |
| Passing yards | 1,304 | 0.179286 | 0.178929 | 0.000357 |
| Rushing yards | 4,936 | 0.109658 | 0.107339 | 0.002319 |
| Receiving yards | 12,108 | 0.098221 | 0.096351 | 0.001870 |
| Receptions | 15,135 | 0.133341 | 0.132100 | 0.001241 |

## Interpretation

**Research improvement, NOT betting validation.** These 2025 outcomes were previously inspected and discussed before developing the opportunity model. Even though the blending weights are learned using 2024 only, 2025 is **no longer an untouched final holdout** due to researcher iteration. New forward-captured results or a separately reserved untouched season are needed.

Additional blockers:
- Fixed hypothetical thresholds, not quoted sportsbooks lines. Multiple thresholds per player-game are dependent observations.
- Weekly player-stat rows still fail to represent some active zero-opportunity participants absent from the box score. Roster/snap eligibility resolution remains pending.
- No current injury-as-of or bookmaker offer eligibility proof.
- This model is not the live app simulator and does not estimate joint SGP probabilities.
- Historical improvement does not demonstrate real-world betting value.

Next: properly align weekly participation and offensive snap data, verify identity and DNP statuses, and evaluate only on a new untouched chronological set. Keep recommendations gated until proven.
