# NBA projection integrity audit — November 4, 2026

The Towns example exposed correctness and evidence problems. The old 25.6 rebounds + assists forecast should not have been promoted merely because its simulation frequency was high. Functional test success was not evidence of prediction accuracy.

## Findings and released corrections

1. **Rebound opportunity inflation.** Every modeled miss was credited as a player rebound. The engine now estimates the live-player-rebound fraction from earlier team/league box scores, leaving dead-ball/team rebounds uncredited. No sportsbook line enters that calculation.
2. **A zero-minute placeholder discarded valid history.** ESPN supplied Pacome Dadiet with MIN `--`, all-zero statistics, and `didNotPlay=false`. This invalidated the entire Knicks game on October 23, including Towns' valid 37 MIN / 10 REB / 3 AST record. A nonstarter placeholder is omitted only with explicit `--`/zero minutes and all-zero production. Missing minutes with nonzero production, or an absent minute field, still fail closed. Individual scoring and rebound identities and team minute completeness are checked.
3. **Unsupported rotation redistribution.** Filtering unsupported bench samples can stretch remaining players' minutes. A trial replacement using thin-sample bench players and historical workload caps worsened broader minutes MAE (about 4.99 → 5.61) and was rejected. The release does not claim to have validated a better minutes allocator. Instead, limited-sample workload jumps above an explicit recent range, and stat means above all observed prior outcomes, are withheld from recommendations. A lower alternate line or attractive odds cannot bypass those guards.

The workload guard uses a recent five-appearance bound: max(recent average + 2 minutes, empirical 90th percentile + 1 minute), and applies when fewer than ten valid player games support the estimate. This is a conservative review rule, not a fitted confidence interval. Such players show REVIEW rather than unsupported numeric projection cards. When the current model cannot run, scheduled-game cards do not silently substitute a different model.

## Walk-forward benchmark

Only earlier regular-season box scores are supplied to each forecast. A conservative four-hour completion buffer excludes games that might still have been in progress. The chronological comparison window begins October 29. Compare matching game/player/market observations, not different cohorts. The later window contains 46 matched games and 853 active player observations per market.

Mean absolute error; lower is better:

| Market | Prior engine | Corrected engine | Recent-average baseline |
|---|---:|---:|---:|
| Points | 4.96 | 4.93 | 5.04 |
| Rebounds | 2.05 | 1.93 | 1.93 |
| Assists | 1.47 | 1.48 | 1.47 |
| Minutes | 4.99 | 5.00 | 4.73 |

Average combined rebounds per game: **99.6 prior / 85.3 corrected / 87.4 actual**. The correction removes most of the overcount; it does not exactly reproduce actual totals. The internal game-cluster bootstrap estimates a rebound-MAE reduction of about 0.12 per game-averaged player, with a 95% interval of roughly 0.06–0.17. This is not independent external validation.

A separate ten-game diagnostic uses dated, immutable pregame absence snapshots, not today's injury report: active-player rebound MAE improves from about **1.89 to 1.67** (recent-average baseline 1.77). Minutes remain essentially unchanged. This subset is small and does not validate all availability scenarios, confirmed lineups, or defender effects.

**Interpretation:** rebound forecasts improve against the prior simulator. Broad rebound accuracy is approximately tied with a simple recent average; assists and minutes do not demonstrate superiority to that baseline. No calibrated win probability or verified betting edge is established.

## Towns reproduction

Using the same checked-in input sample as the screenshot:

- Prior rebounds + assists forecast: **25.6**.
- Corrected conditional simulation mean: **19.9**; prior seven-game sample mean: **17.3**.
- Simulated minutes: roughly **39.3 → 37.3**, but the regular-time allocation of 36.5 still exceeds the review bound of 36.0.
- **Not a qualified recommendation.** The cards withhold this projection and the ticket/slate exclude it.
- The user's book line of 16.5 is a comparison point only. The model was not fitted to that line.

## Regression and history protection

- New integrity tests cover dead-ball misses, valid zero-minute placeholders, malformed boxes, unsupported workload gates, and target-game leakage.
- CI compares the candidate with the pinned prior simulator on freshly fetched free input data. It requires lower matched rebound MAE and flags material regression in other markets. Those engineering tolerances are not statistical certification.
- The simulator version is `nba-possession-audit-v3`. Existing frozen forecasts keep their original versions and values; they are never relabeled or rewritten. New captures are graded separately.
- Recommended player props remain OVER-only with no three-point markets. Odds remain optional. NFL model logic is unchanged.

## Reproduce

The audit runs automatically in the NBA possession live-check job when relevant source changes. Its comparison JSON is uploaded as an Actions artifact. For a local reproduction, prepare the prior `nba_possession_engine.js` and its `nba_game_context.js` dependency from commit `ded8f5b275353e92f5228298c6e35da6255924dc` in one temporary directory, then run:

```bash
node scripts/audit_nba_projections.js /absolute/baseline/nba_possession_engine.js /tmp/nba-before.json
node scripts/audit_nba_projections.js "$PWD/nba_possession_engine.js" /tmp/nba-after.json
node scripts/compare_nba_projection_audits.js /tmp/nba-before.json /tmp/nba-after.json /tmp/nba-comparison.json
```

An optional fourth argument to the audit script selects `data/nba_projection_audit_availability.json` for the frozen-absence diagnostic. The committed `data/nba_projection_audit.json` records this audit's results and input provenance. Historical injury/roster announcements are unavailable for the broad box-score benchmark, so its DNP-inclusive and active-player diagnostics are not live betting performance. These observations are an internal chronological holdout; further prospective validation remains necessary.
