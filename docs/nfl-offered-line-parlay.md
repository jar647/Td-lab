The NFL parlay builder now compares user-entered sportsbook alternatives before
choosing a complete ticket. It reuses the existing player-volume engine and
keeps the NFL minimum of 60/100, OVER-only yardage/reception markets, player
eligibility checks and existing Quick Slip records. The five-player anytime-TD
builder is unchanged.

Users can enter multiple lines for a player/market, including players outside
the visible top three. The player pool is derived from the same matchup board;
it does not require the default alternate to have qualified first. Each entered
OVER line must be a whole or half-point line with valid American odds. There is
no inferred book offering or invented price.

For the offered pool, game workers collect requested player-market outcomes
from the same 10,000 seeded draws. A separate search worker compares complete
two-to-four-player combinations with one leg per player. Same-game outcomes
are counted jointly; different-game mode uses distinct games and explicitly
assumes independence across games. The bounded search weighs matchup quality,
observed workload consistency, line difficulty and joint outcomes. It excludes
unsupported lines, strongly conflicting pairs, ambiguous fixtures and filler
legs. It does not claim a globally optimal or profitable ticket.

Changing sources or offered options invalidates the selected ticket. Exact
selected lines, odds, research scores, model version and selection evidence are
saved to Quick Slip only after a complete valid comparison. Existing selections
are retained. Individual leg odds are never multiplied into an invented SGP
price; the actual combined quote is reviewed after selection.

Receiver efficiency now uses observed season-total catches/targets with a
3-catch/6-target prior, and total receiving yards/catches with a 35-yard/3-catch
prior. The old formula applied these priors to per-game averages, retaining
their strength even as evidence grew. The new version is
`game-first-volume-v5-counts-catch`; the explicit `legacy` profile remains
available for paired diagnostics.

The correction was compared using public nflverse 2024 and 2025 weekly player
statistics. Only strictly earlier weeks enter each forecast; current depth
charts, injury designations, opponent factors and prices are omitted. Weeks
11 onward form each season's comparison holdout. The retained snapshot showed
passing-yard MAE decreasing from 63.80 to 63.15 in 2024 and 69.52 to 67.98 in
2025; reception and receiving-yard MAE and fixed-threshold Brier scores also
improved in both comparison holdouts. The CI job regenerates this evidence from
the source data and checks the same predeclared gate.

These are conditional retrospective diagnostics, not frozen historical
forecasts or prospective calibration. Historical pregame injury announcements
are unavailable, missing target-game appearances are not fabricated as zero,
and sampling intervals cannot measure all structural model error. Simulation
percentages remain uncalibrated research frequencies. No BET or verified-edge
gate is enabled by this change.
