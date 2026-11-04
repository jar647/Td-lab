# NBA matchup discovery

The primary NBA view identifies where to look using recorded results, without sportsbook lines, prices, or simulated forecasts.

For each matchup it compares points, rebounds, and assists allowed to sourced primary positions (PG, SG, SF, PF, C) with the league sample average. Totals combine all opposing players listed at that position; they are not a single player expectation. Each team uses up to ten earlier regular-season games. Games with less than 98% known position coverage by played minutes are omitted. Broad G/F labels are never guessed into specific positions.

Player recommendations match an above-average allowance to an above-average current rotation player at that position. A candidate needs five earlier appearances, recent minutes averaging at least twenty, at least fifteen minutes in the latest appearance, current roster membership, and fresh injury information. Out, doubtful, and questionable players are excluded. The best starting point and top three players are ranked by the size of the allowance excess and player production relative to rotation peers.

The suggested integer baseline is the highest standard milestone hit in at least four of the last five appearances and 70% of up to ten appearances. Dropdowns expose each integer threshold with exact hits, actual sample counts, and percentages for the last five and up to ten appearances. Six-plus means at least six, including exactly six. These are historical hit rates, not estimated future win probabilities. No recommendation is guaranteed or described as a verified betting edge.

Adding to Quick Slip preserves the selected integer-plus milestone and its observed hit count. The primary view does not require odds. Old simulation tools remain collapsed under an experimental section, and frozen pregame tracking is unchanged.

Sources refresh automatically through the existing NBA workflows. The roster feed preserves team player-ID arrays and adds ESPN position metadata. Current-source CI requires detailed position coverage and supported positional matches before release.
