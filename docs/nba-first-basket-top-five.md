# Daily top five first-basket scorers

The NBA page has a separate scan button above the Game Explorer. It ranks up to
five distinct players across today's upcoming games using the Eastern calendar
day. It retains the OVER 75+ / UNDER 85+ Best Props board separately.

This uses the existing opening-field-goal model: a smoothed team opening-goal
frequency multiplied by the player's share of team opening field goals. Free
throws are excluded. Estimates are experimental, uncalibrated probabilities,
not matchup ratings or verified betting edges. Candidates from one game are
alternatives, not a parlay: only one player scores its first field goal.

Projected starters are selected from recent starts and minutes among current
roster members with at least three earlier appearances and fifteen average
minutes. Only active, available, probable or unlisted injury statuses qualify.
Five supported starters per team and at least three verified current-season
opening sequences per team are required. Questionable/out players, stale feeds,
duplicate games, future results, previous seasons and started games cannot
supply recommendations. Feed/injury freshness is twelve hours, rosters seventy-two
hours, and injuries within ninety minutes of tipoff must be within fifteen
minutes. Games failing these checks appear under Games withheld.

Cards show team/game context, the experimental estimate, actual first-game and
first-team basket counts, and an Add to Quick Slip action. Adding recomputes the
board to reject expired or newly unavailable entries. If fewer than five
candidates qualify, fewer are displayed; no fillers are invented.

Run `node test_nba_first_basket.js` for model, daily slate and UI contracts.
