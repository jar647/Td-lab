# NBA Game-First Analyst: implementation contract

Goal: reproduce the NFL Game-First Matchup Research workflow in the NBA Edition without making sportsbook odds a prerequisite for discovering matchup opportunities.

## User flow
1. Select a scheduled NBA game.
2. Click **Analyze game & build research ticket**.
3. Display matchup breakdown and actionable defensive weaknesses, tied to relevant opposing players.
4. Display a research ticket of up to four OVER player props with suggested alternate lines, game-specific projected stats, scenario hit frequencies, sample sizes, injury/rotation caveats and individual explanations.
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
- [ ] Audit NFL UI and model interfaces, map equivalent NBA feed contracts.
- [ ] Build NBA game-first candidate ranking and correlation-aware research ticket module.
- [ ] Add NBA controls for alternate lines, excluded markets, ticket rebuild.
- [ ] Add game-first UI, best single, top three, Quick Slip integration.
- [ ] Automated unit and integration tests for stale data, missing starters, correlations, and empty slates.
- [ ] Verify live deployment in a browser and frozen prediction grading.
