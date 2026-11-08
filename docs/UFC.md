# UFC Fight Center

Open `ufc.html` using a static HTTP server. The page keeps The Prop Shop's green
palette and works without a build step. It uses `ufc.css`, `ufc_app.js` and
`ufc_research_engine.js` and `ufc_matchup_research.js`.

## One top pick per fight

Each scheduled fight leads with one **Top pick**, its reason and its main risk.
No price input is needed. The fixed selection rule is in `ufc_pick_engine.js`:
strong standard totals (2.5 for three-round bouts, 4.5 for five-round bouts) can
take priority when the winner evidence competes; a concentrated method route
must agree with the independent winner lean; otherwise use the supported winner
lean or a qualified total. There is no automatically selected Over 0.5 shortcut.
The expanded basis explains the observations and opposing evidence.

This is an unvalidated selection policy, not calibrated accuracy, betting value
or expected return. Thresholds are explicit judgment rules, not fitted model
parameters. Unsupported fights return one clear PASS. Live, final, unavailable
and stale scheduled states do not receive a fresh pre-fight selection. Price
tools remain optional and cannot change the top pick.

A missing takedown accuracy can be mathematically unused when that fighter has
a verified zero takedown rate; a missing takedown defense can be unused when the
opponent has zero takedown volume. Such percentages remain null and visible,
never filled with invented zeros. Invalid supplied values still block the
model, and completed-input scores remain unchanged. A selection based on these
conditional-valid inputs is labeled as using limited source data.

## Data and refresh

The live ESPN scoreboard supplies events, bouts, records, weight classes, venues,
times and results. Card segments are never inferred from fight count or start
time. Unpublished main-card/prelim segments have disabled filters with counts.

Run `python scripts/refresh_ufc.py` to write `ufc_schedule.json`. The daily
`refresh-ufc.yml` workflow commits this fallback even without an API key. If the
live request fails or has an invalid shape, the browser uses the newest valid
schedule from local storage or this file, up to seven days old, and labels it
as saved. It preserves the previous visible card on refresh failure. Local
storage is optional; blocked storage does not prevent use.

For authenticated fighter career rates, configure `FIGHTERAPI_KEY` in this
repository's GitHub Actions secrets and run **Refresh UFC fighter research**.
Credentials stay in Actions secrets. `ufc_fighter_data.json` retains available
partial profiles, measurements, UFC record and up to five source-supplied
completed results. Missing metrics remain null. Authenticated refresh was
verified on the first integration run: 71 of 84 profiles had all eight rates.

Profiles are reused for seven days to avoid repeatedly charging for unchanged
research. `fetched_at` remains the true rate fetch time; `checked_at` records a
retry that returned incomplete replacement rates. The browser excludes individual
profiles older than 30 days. The refresher paces requests using remaining-credit
headers, retries throttling twice, and stops on authentication or credit errors
while retaining available cache entries. Explicit card segment metadata can
supplement ESPN labels by matching event and bout IDs.

The fight breakdown explains the existing career-rate heuristic using actual
metric values: striking attack, absorbed strikes, takedowns and submission
activity. It surfaces a statistical lean, the strongest opposing scored area,
and possible paths clearly labeled as inferences. Odds never enter that score.
Partial profiles still produce factual comparisons, but no overall lean until
both fighters have all eight valid metrics. Recent results are displayed as
facts and are not silently added to the score. The heuristic remains
experimental, uncalibrated and unvalidated; these changes do not prove predictive
accuracy or a betting edge. Career averages do not account for opponent quality,
current injuries, weight cuts or style changes. Rate fields use strikes per
minute, takedowns/submissions per 15 minutes and percentages on a 0–100 scale.

Moneyline inputs accept signed American odds, store prices by event and bout,
and survive filtering, switching cards and reloads. They display implied and
no-vig probabilities and the two-price bookmaker margin. They do not supply a
model prediction or live sportsbook prices.

## Public finish records and durations

`python scripts/refresh_ufc_history.py` writes `ufc_history_data.json` from public
ESPN athlete histories, overall records and explicit competition formats. It
uses no FighterAPI credits or credentials. Profiles are keyed by the verified
ESPN athlete ID. Professional method records include regional promotions and
are labeled as overall professional records; duration samples are restricted
to available UFC/DWCS bouts. Decision counts are only added when complete
observed outcomes reconcile with the supplied totals and KO/submission counts.
They are never inferred by subtracting other methods from total wins.

The daily UFC workflow runs this public refresh even when authenticated research
fails. It reuses profiles for 24 hours and shares cached historical format lookups.
The page excludes individual public record/history components older than seven
days; a fresh history fetch cannot make a stale method record appear current.
The initial public refresh retrieved 84 profiles with history and method records,
plus 470 explicit format lookups.

## Round totals and win methods

Each bout has a **Round totals & win method** section. Confirmed three-round
fights offer 0.5/1.5/2.5 lines; confirmed five-round fights also offer 3.5/4.5.
Unknown formats remain unconfirmed. A 2.5 line means 12:30 elapsed, not the start
of round three. Each line has its own saved Over/Under prices.

Totals evidence uses dated, completed bouts with a known scheduled distance,
valid final round and elapsed finish clock, and a resolved ordinary outcome.
Only matching three-/five-round formats are compared. Current/future bouts,
NCs, draws, DQs, technical decisions and exact-threshold finishes are excluded.
Shared bouts are counted once. A historical research lean requires at least
three eligible fights per fighter, six unique combined, a majority in the same
direction for both, and at least 60% combined support. These thresholds are a
transparent research rule, not fitted or calibrated prediction parameters.

KO/TKO, submission and decision evidence compares a fighter's actual win-method
counts with the opponent's actual loss-method counts. When a complete provider
record is absent, dated recent results can supply an explicitly limited sample.
A method to research requires at least three recorded wins and three opposing
losses, with more than half in that method on both sides. Conditional method
shares are never presented as the chance of winning a prop. Missing counts stay
unavailable; striking volume and submission attempts are not substitutes for
finish records. Career counts fetched after the target event remain context,
not verified pre-fight evidence.

Entered American prices show break-even rates only. No odds feed, calibrated
prop probability, value/EV claim, automatic bet or moneyline-to-prop conversion
is added. The six fighter/method rows omit draw/other outcomes and are never
normalized as an exhaustive market. Prices are saved independently by event,
bout, method and total-round line.

## Validation

```sh
node --check ufc_app.js
node test_ufc_research.js
node test_ufc_app.js
node test_ufc_matchup_research.js
node test_ufc_prop_research.js
node test_ufc_pick_engine.js
PYTHONDONTWRITEBYTECODE=1 python -m unittest discover -s tests -p test_ufc_refresh.py
```

For browser regression coverage, make Playwright available to Node, start
`python -m http.server 8000`, then run `node test_ufc_browser.js`. The test uses
system Chromium at `/usr/bin/chromium`; override with `UFC_CHROMIUM_PATH`.
`UFC_TEST_URL` and `UFC_ARTIFACT_DIR` can override the local URL and screenshot
directory. It tests recorded ESPN schedule data and explicitly synthetic route
fixtures for card segments and research; test fixtures never enter production
cache files. It covers mobile overflow, search, persistence, error recovery,
filtering and research rendering. Screenshots default to `/tmp/ufc-artifacts`.

