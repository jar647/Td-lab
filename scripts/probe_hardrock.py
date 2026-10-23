"""Read-only OddsPapi access test. Never print API credentials or raw URLs."""
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://api.oddspapi.io/v4"
KEY = os.environ.get("ODDSPAPI_API_KEY", "")
if not KEY:
    sys.exit("Missing ODDSPAPI_API_KEY GitHub Actions secret.")

def get(endpoint, **params):
    url = BASE + "/" + endpoint + "?" + urllib.parse.urlencode({"apiKey": KEY, **params})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "TD-LAB-odds-probe/1.0"}), timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            if exc.code == 429 and attempt < 2:
                time.sleep(2 * (attempt + 1))
                continue
            raise RuntimeError("API returned HTTP " + str(exc.code)) from None
        except (urllib.error.URLError, TimeoutError):
            if attempt == 2:
                raise RuntimeError("API request failed or timed out") from None
            time.sleep(2)
    raise RuntimeError("API retry limit reached")

try:
    books = get("bookmakers")
    if isinstance(books, dict):
        books = books.get("bookmakers", books.get("data", []))
    hardrock = [b for b in books if isinstance(b, dict) and b.get("slug") == "hardrockbet"]
    print("Hard Rock bookmaker slug found:", bool(hardrock))
    if not hardrock:
        sys.exit("Hard Rock bookmaker not found in API response.")
    today = dt.datetime.now(dt.timezone.utc).date()
    fixtures = get("fixtures", sportId=14, **{"from": today.isoformat(), "to": (today + dt.timedelta(days=7)).isoformat()})
    if isinstance(fixtures, dict):
        fixtures = fixtures.get("fixtures", fixtures.get("data", []))
    nfl = [f for f in fixtures if isinstance(f, dict) and (str(f.get("tournamentId")) == "31" or f.get("tournamentName") == "NFL")]
    priced = [f for f in nfl if f.get("hasOdds") and f.get("fixtureId")]
    print("NFL fixtures next seven days:", len(nfl))
    print("NFL fixtures with any odds:", len(priced))
    if not priced:
        print("No priced NFL fixture to inspect yet. Connection and bookmaker checks completed.")
        sys.exit(0)
    odds = get("odds", fixtureId=priced[0]["fixtureId"], bookmakers="hardrockbet", oddsFormat="american")
    book = (odds.get("bookmakerOdds") or {}).get("hardrockbet", {})
    markets = book.get("markets") or {}
    print("Hard Rock odds present for sampled fixture:", bool(markets))
    print("Hard Rock market count for sampled fixture:", len(markets))
    print("Next: verify anytime-touchdown market IDs and player-name outcomes before publishing any prices.")
except (RuntimeError, ValueError, TypeError, KeyError) as exc:
    sys.exit("Odds provider probe failed: " + str(exc))
