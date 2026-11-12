# Public daily recommendation ledger

`results.html` links from NFL, NBA, UFC and the NFL analyst. The default date is
today in America/New_York when recorded picks exist; filters cover all game
dates, sports, boards and outcomes. CSV exports the filtered underlying records.

## Capture policy

`scripts/update_recommendation_results.cjs` uses the same NBA modules and the
actual selection functions extracted from the deployed NFL analyst and UFC app.
It records NBA Best Props, game-first best/top-three/default ticket, first-basket
top five, NFL analyst top-three/default ticket and TD position leaders, and UFC
top pick plus supported predicted winners. Manual custom prices, lines,
exclusions, simulator-only hypotheticals and real-money execution are not public
recommendations and are not captured by this server ledger.

Every first observation freezes the exact game/player identity, line, side,
score or evidence category, source model hash, source timestamps and capture
time. Only captures strictly before the recorded event start enter statistics.
A later change to line or score becomes an informational revision, never a
replacement or another primary trial. Models with different selection logic are
kept separate. UI-only NFL changes do not reset its model hash. Changing top-five
boards may produce more than five distinct records over the whole day.

The first committed seed contains actual new pregame captures. Earlier
unrecorded recommendations are deliberately not reconstructed from final data.
Ten-minute scheduled runs and source-file pushes continue capture and grading.
GitHub can delay schedules; coverage is not guaranteed for a game missed before
start. The report shows stale/failed source coverage explicitly. Source dates
remain real when data refreshes fail.

## Results

NBA uses final official player box scores by ID/team. Integer-plus milestones
settle inclusively; regular OVER/UNDER lines are strict with pushes. Missing
fields never become zero. DNP is void. First basket means first made field goal,
excludes free throws and requires a starting appearance; a bench appearance is
void, unknown starter/opening evidence remains unresolved.

NFL uses official nflverse final schedules and weekly boxes, joined to current
roster GSIS/PFR IDs and independently verified offensive snaps through the
existing `snap_verified_weekly` helper. Missing participation stays unresolved,
not an assumed DNP or zero-stat loss. Rushing/receiving TDs exclude passing TDs.
Result inputs refresh at most hourly; source delays can defer grading.

UFC uses final public bout histories or final schedule results keyed by bout ID.
Winner, win method and round totals settle on captured identities and lines.
Draw/no contest and cancellations are void. Missing winner, method or finish
clock stays unresolved. Result corrections are regraded from official data;
frozen predictions remain unchanged. Sportsbook-specific house rules may differ.

Wins/(wins+losses) excludes pending/live, awaiting result data, void and push.
ROI uses one unit only for picks with an actual pre-start price observed no later
than capture; no default -110, fabricated quote or implied payout is inserted.
Price coverage is separate from total pick coverage. These are hypothetical
returns at recorded prices, not proof of executed bets.

## Does score help?

Group by sport, board, model hash, market and side; never pool NBA UNDERs with
OVERs, NFL raw ranks with /100 scores, or UFC evidence labels with probabilities.
Five-point score bands show W/L, hit rate, Wilson intervals, game counts and
priced ROI. First-basket/scenario frequencies use separate estimate bands.
Mean estimate and Brier scores use only settled predictions. These are
uncalibrated forecasts, not interpreted as /100 matchup scores.

Predeclared comparison splits are NBA matchup score 90, NFL TD score 60, and NFL raw analyst rank 100. Each comparison requires thirty settled picks in each group,
thirty distinct games and ten dates before even a descriptive comparison.
It never asserts statistical significance or promotes a model. Shared games,
player exposure, source selection and line difficulty confound raw hit-rate
comparisons; the dashboard says so. Wilson intervals assume pick-level trials
and may understate uncertainty under correlation. A high hit rate alone does
not demonstrate profitability, especially without observed prices.

Run `node test_recommendation_ledger.js` and the normal NFL/NBA/UFC regressions.
