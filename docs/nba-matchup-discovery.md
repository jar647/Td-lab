# NBA matchup discovery

The primary NBA view identifies where to look using recorded results, without sportsbook lines, prices, or simulated forecasts.

For each matchup it compares points, rebounds, and assists allowed to sourced primary positions (PG, SG, SF, PF, C), with ESPN Fantasy default position classifications supplying detailed labels when roster labels are broad with the league sample average. Totals combine all opposing players listed at that position; they are not a single player expectation. Each team uses up to ten earlier regular-season games. Games with less than 98% known position coverage by played minutes are omitted. Broad G/F labels are never guessed into specific positions.

OVER recommendations match an above-average allowance to an above-average current rotation player; UNDERs match below-average allowances to lower-production players at the same position. A candidate needs five earlier appearances, recent minutes averaging at least twenty, at least fifteen minutes in the latest appearance, current roster membership, and fresh injury information. Out, doubtful, and questionable players are excluded. The best starting point and top three players are ranked by their direction-specific matchup rating.

The suggested integer baseline is the highest standard milestone hit in at least four of the last five appearances and 70% of up to ten appearances. Dropdowns expose each integer threshold with exact hits, actual sample counts, and percentages for the last five and up to ten appearances. Six-plus means at least six, including exactly six. These are historical hit rates, not estimated future win probabilities. No recommendation is guaranteed or described as a verified betting edge.

Adding to Quick Slip preserves the selected integer-plus OVER milestone or strict UNDER line and its observed hit count. The primary view does not require odds. Old simulation tools remain collapsed under an experimental section, and frozen pregame tracking is unchanged.

Sources refresh automatically through the existing NBA workflows. The roster feed preserves team player-ID arrays and adds ESPN position metadata. Detailed classifications describe the published primary position, not tracked minutes at each position. Current-source CI checks detailed position coverage and enforces the side-specific minimum for every supported positional match.

## NBA Best Props: OVER 75/100, UNDER 85/100

Every player recommendation surface (daily slate, position matchups, game-first
single/top-three/ticket, legacy quote recommendations and published-model picks)
requires current supported evidence rated at least 75/100 for OVERs or 85/100 for UNDERs. There is no
lower-threshold fallback. Three-point markets cannot be recommended.
First-basket picks remain PASS because they have no supported matchup rating.

The shared position-history rating allocates 30 points to opponent weakness (OVER) or suppression (UNDER) at
the player's sourced position, 20 to direction-specific production versus position peers (a usage
proxy), 15 to recent form versus earlier appearances, 20 to projected minutes
and recent minutes stability, and 15 to availability and sample depth. Probable
status discounts the availability component; uncertain/out statuses are withheld.
Freshness, pregame cutoff, roster membership, minimum history, positional
coverage and baseline safeguards still run before scoring. Missing inputs mean
PASS, never an invented score. The score is a heuristic matchup rank, not a
calibrated win probability. Odds, EV, implied probability, selected thresholds,
and simulated hit frequency never enter it.

Combo recommendations use the minimum rating across their constituent markets;
a strong points matchup cannot hide weak rebound or assist evidence. Existing
workload review, direction-supported matchup adjustment and shared-outcome correlation gates
remain additional requirements for the game-first ticket. A line with zero
supported simulated outcomes for its selected side is withheld without changing the matchup score.

Run `node test_nba_game_first_threshold.js`, `node tests/test_nba_matchup_discovery.js`,
`node tests/test_nba_matchup_ui.js`, `node test_nba_pipeline_ui.js`,
`node test_nba_ui.js` and `node tests/nba_game_first.test.js` for the core contracts.

UNDER history and shared-outcome ticket grading use strict less-than comparisons;
integer pushes are never hits. UNDER ratings cannot borrow OVER evidence, and
combo markets require qualifying evidence for every component on the same side.
