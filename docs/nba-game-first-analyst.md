# NBA Game-First Analyst: implementation contract

Goal: reproduce the NFL Game-First Matchup Research workflow in the NBA Edition without making sportsbook odds a prerequisite for discovering matchup opportunities.

## User flow
1. Select a scheduled NBA game.
2. Click **Analyze game & build research ticket**.
3. Display matchup breakdown and actionable defensive weaknesses, tied to relevant opposing players.
4. Display a research ticket of up to five OVER player props with suggested alternate lines, game-specific projected stats, scenario hit frequencies, sample sizes, injury/rotation caveats and individual explanations.
5. Allow user to change each alternate line and recompute the modeled hit frequency; exclude markets and rebuild.
6. Show the best single research candidate and three ranked player recommendations.
7. Save candidates to Quick Slip with the suggested line and experimental probability.
8. Odds entry is optional and used only for a separate value/price assessment.

## Constraints
- Exclude player UNDER and three-point markets from recommended tickets.
- Multiple players from one game allowed, but do not treat correlated legs as independent.
- Research ticket is not a verified priced SGP. Show uncalibrated simulation warning where appropriate.
- Never fabricate matchup stats, injuries, projections, or hit frequencies. Show unavailable or PASS when inputs are inadequate.
- Preserve NFL functionality and existing frozen pregame prediction tracking.

## Implementation milestones
- [x] Audit NFL UI and model interfaces, map equivalent NBA feed contracts.
- [x] Build NBA game-first candidate ranking and correlation-aware research ticket module.
- [x] Add NBA controls for alternate lines, excluded markets, ticket rebuild.
- [x] Add game-first UI, best single, top three, Quick Slip integration.
- [x] Automated unit and integration tests for stale data, missing starters, correlations, and empty slates.
- [ ] Verify live deployment in a browser and frozen prediction grading.


## Implementation and verification
The research ticket consumes the existing possession engine with 1,000 seeded shared outcomes. Player-specific rates and rotation budgets drive forecasts. The interface ranks only OVER points/rebounds/assists and combination markets, excludes uncertain players, supports 1–5 legs, line edits, exclusions, rebuilding and Quick Slip with numeric lines and scenario rates. Joint frequency counts all legs winning in the same simulated game; pairs below 80% of their independent joint baseline are excluded. This threshold is an explicit heuristic, not a fitted correlation model.

Research ranks are not calibrated win probabilities. Sources and model assumptions still limit accuracy. Official defender tracking is optional and omitted when stale or unavailable. Existing immutable NBA and NFL pregame capture and grading remain unchanged. Older saved UNDER selections can still be displayed and graded; new recommendations are OVER only. The two-sided math helpers remain covered to protect historical behavior.

Local checks: both Python discovery suites, all JavaScript contracts, real-feed research tests and browser interactions. CI and deployment must also pass before release. Automatic odds-provider checks run only for odds-provider changes; research-only changes do not require sportsbook prices.
