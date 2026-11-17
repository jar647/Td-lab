# NFL research upgrade

This work extends `game_picks.py`, the existing opponent/QB score fit, and the
Game Odds page. It does not introduce another simulator.

## First implementation

- Share the prop collector's verified, exact-game injury evidence with score
  research and the existing lineup scenarios. Keep source dates and identity
  joins; missing reports do not establish health. Questionable does not mean OUT.
- Support a unique, fresh, sourced first-unit quarterback depth chart. Conflicting
  evidence, unavailable player effects and blocked quarterbacks remain explicit
  gaps. Depth charts describe an expected lineup, not confirmed participation.
- Explain existing opponent-adjusted offensive and defensive scoring effects,
  ranks and sample counts before sportsbook inputs are required.
- Add separate league-relative pass/rush EPA research. Defensive EPA **allowed**
  enters with the same sign as offensive EPA: allowing more favors offense.
  These observed signals are distinct from schedule-adjusted scoring ratings.
- Reject undated, stale, future and wrong-venue weather inputs. Weather still
  conditions historical residual sampling; it does not receive invented points.
- Freeze the revised lineup evidence policy under its own version. Preserve all
  original forecasts and use the existing paired-error simulation and grading.

EPA point corrections remain disabled. The historical subtraction-based
challenger and its recorded comparisons are retained as historical evidence;
the new research does not silently replace that model or its results.

## Validation and next implementation

The checked-in score-model comparison contains 710 retrospective games. The
opponent/QB candidate's margin MAE is 10.1969 versus 10.3494 for the baseline;
total MAE is 10.4352 versus 10.5247. Both paired improvement intervals cross zero.
This evidence does not validate the new injury/starter evidence policy or prove
calibrated probabilities. No promotion is justified by those point estimates.

The next analytical feature should build inspectable historical matchup
comparisons using feature vectors calculated **before each historical game**:
opponent strength, pass/rush efficiency, pace, rest and verified conditions.
Today's ratings must not be assigned retrospectively to earlier matchups.
Historical realized QB identities, injuries or kickoff weather must not be
substituted for unavailable dated pregame evidence.

Evaluate that feature against the current engine with chronological development
and later evaluation seasons. Record sample sizes, missing-context exclusions,
margin/total errors, Brier scores and reliability bins with uncertainty. Select
parameters on development data only. Assess both score errors and probability
quality before changing forecasts; keep new prospective lineup-policy results
separate from baseline and prior policy versions.

Coaching records remain descriptive. Scheme changes, football-style historical
comparables, actual travel itineraries and independently validated injury-policy
probabilities remain unfinished. Existing rest/travel/weather residual matching
is conditional historical sampling, not proof that all those effects are modeled.
