# NBA matchup discovery

The primary NBA view identifies where to look using recorded results, without sportsbook lines, prices, or simulated forecasts.

For each matchup it compares points, rebounds, and assists allowed to sourced primary positions (PG, SG, SF, PF, C), with ESPN Fantasy default position classifications supplying detailed labels when roster labels are broad with the league sample average. Totals combine all opposing players listed at that position; they are not a single player expectation. Each team uses up to ten earlier regular-season games. Games with less than 98% known position coverage by played minutes are omitted. Broad G/F labels are never guessed into specific positions.

Player recommendations match an above-average allowance to an above-average current rotation player at that position. A candidate needs five earlier appearances, recent minutes averaging at least twenty, at least fifteen minutes in the latest appearance, current roster membership, and fresh injury information. Out, doubtful, and questionable players are excluded. The best starting point and top three players are ranked by the size of the allowance excess and player production relative to rotation peers.

The suggested integer baseline is the highest standard milestone hit in at least four of the last five appearances and 70% of up to ten appearances. Dropdowns expose each integer threshold with exact hits, actual sample counts, and percentages for the last five and up to ten appearances. Six-plus means at least six, including exactly six. These are historical hit rates, not estimated future win probabilities. No recommendation is guaranteed or described as a verified betting edge.

Adding to Quick Slip preserves the selected integer-plus milestone and its observed hit count. The primary view does not require odds. Old simulation tools remain collapsed under an experimental section, and frozen pregame tracking is unchanged.

Sources refresh automatically through the existing NBA workflows. The roster feed preserves team player-ID arrays and adds ESPN position metadata. Detailed classifications describe the published primary position, not tracked minutes at each position. Current-source CI requires detailed position coverage and supported positional matches before release.

## NBA Best Props: 75/100 minimum

Every player recommendation surface (daily slate, position matchups, game-first
single/top-three/ticket, legacy quote recommendations and published-model picks)
requires current supported OVER evidence rated at least 75/100. There is no
lower-threshold fallback. Three-point and Under markets cannot be recommended.
First-basket picks remain PASS because they have no supported matchup rating.

The shared position-history rating allocates 30 points to opponent weakness at
the player's sourced position, 20 to production versus position peers (a usage
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
workload review, positive matchup adjustment and shared-outcome correlation gates
remain additional requirements for the game-first ticket. A line with zero
supported simulated overs is withheld without changing the matchup score.

Run `node test_nba_game_first_threshold.js`, `node tests/test_nba_matchup_discovery.js`,
`node tests/test_nba_matchup_ui.js`, `node test_nba_pipeline_ui.js`,
`node test_nba_ui.js` and `node tests/nba_game_first.test.js` for the core contracts.
