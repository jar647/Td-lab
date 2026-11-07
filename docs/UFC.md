# UFC Fight Center

Open `ufc.html` using a static HTTP server. The page keeps The Prop Shop's green
palette and works without a build step. It uses `ufc.css`, `ufc_app.js` and
`ufc_research_engine.js` and `ufc_matchup_research.js`.

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

## Validation

```sh
node --check ufc_app.js
node test_ufc_research.js
node test_ufc_app.js
node test_ufc_matchup_research.js
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
