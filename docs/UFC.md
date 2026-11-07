# UFC Fight Center

Open `ufc.html` using a static HTTP server. The page keeps The Prop Shop's green
palette and works without a build step. It uses `ufc.css`, `ufc_app.js` and
`ufc_research_engine.js`.

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
Never put the key in browser code or committed files. The existing FighterAPI
REST integration writes `ufc_fighter_data.json` only when complete rate profiles
are available. This authenticated integration could not be exercised during
this change because no key was configured in the development environment.
Check the workflow's result and provider contract when enabling it.

Each run refetches profiles; old statistics are not relabeled as newly fetched.
The browser excludes research caches older than 30 days or without a timestamp
and source. Missing data yields PASS. The existing heuristic remains
experimental and unvalidated; no sportsbook edge is claimed. Numeric rate
fields use strikes per minute, takedowns/submission attempts per 15 minutes,
and percentages on a 0–100 scale.

Moneyline inputs accept signed American odds, store prices by event and bout,
and survive filtering, switching cards and reloads. They display implied and
no-vig probabilities and the two-price bookmaker margin. They do not supply a
model prediction or live sportsbook prices.

## Validation

```sh
node --check ufc_app.js
node test_ufc_research.js
node test_ufc_app.js
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
