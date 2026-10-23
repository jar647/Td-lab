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
    print("Market container type:", type(markets).__name__)
    print("Market sample IDs:", [str(k)[:80] for k in list(markets)[:5]] if isinstance(markets, dict) else [])
    matches = []
    iterable = markets.items() if isinstance(markets, dict) else enumerate(markets)
    for market_id, market in iterable:
        if not isinstance(market, dict):
            continue
        label = " ".join(str(market.get(k, "")) for k in ("name", "marketName", "label", "description", "marketType", "marketId"))
        if any(term in (str(market_id) + " " + label).lower() for term in ("touchdown", "anytime", "td scorer", "to score")):
            matches.append((str(market_id), label[:140], market))
    print("Touchdown-related market count:", len(matches))
    for market_id, label, market in matches[:20]:
        print("Candidate market:", market_id[:80], "|", label, "| keys:", sorted(market.keys()))
        for field in ("outcomes", "selections", "runners", "prices"):
            values = market.get(field)
            if isinstance(values, (list, dict)):
                sample = list(values.values())[:2] if isinstance(values, dict) else values[:2]
                print(" ", field, "count:", len(values), "sample:", json.dumps(sample, ensure_ascii=True, default=str)[:450])
    if not matches:
        print("No named touchdown markets detected; inspect market keys/metadata before integrating.")
        for mid, m in list(markets.items())[:3]:
            if isinstance(m, dict):
                print("Anonymous market:", str(mid)[:30], "keys:", sorted(m.keys()))
                print("Anonymous market safe structure:", json.dumps(m, default=str)[:750])
        try:
            catalog = get("markets")
            if isinstance(catalog, dict):
                print("Market catalog top-level keys:", list(catalog)[:12])
                entries = catalog.get("markets", catalog.get("data", []))
            else:
                entries = catalog
            if isinstance(entries, dict):
                entries = list(entries.values())
            if isinstance(entries, list):
                td = [m for m in entries if isinstance(m, dict) and any(k in json.dumps(m).lower() for k in ("touchdown", "anytime scorer"))]
                print("Market catalog entries:", len(entries), "touchdown-labeled:", len(td))
                for item in td[:12]:
                    print("Catalog touchdown match:", json.dumps(item, default=str)[:500])
                player_props = [m for m in td if m.get("sportId") == 14 and m.get("playerProp") is True]
                print("NFL touchdown player-prop definitions:", len(player_props))
                nfl_props = [m for m in entries if isinstance(m, dict) and str(m.get("sportId")) == "14" and m.get("playerProp") is True]
                print("All NFL player-prop definitions:", len(nfl_props))
                for m in nfl_props[:12]:
                    print("NFL player prop sample:", m.get("marketId"), str(m.get("marketName"))[:100])
                available_td = [m for m in td if str(m.get("marketId")) in markets]
                print("Touchdown-labeled definitions present in sampled game:", len(available_td))
                for m in available_td[:12]:
                    print("Available touchdown definition:", m.get("marketId"), str(m.get("marketName"))[:100], "playerProp:", m.get("playerProp"))
                for item in player_props[:15]:
                    mid = str(item.get("marketId"))
                    print("Player market:", mid, str(item.get("marketName"))[:90], "present in sampled game:", mid in markets)
        except RuntimeError as exc:
            print("Market catalog lookup unavailable:", str(exc))
    print("Read-only discovery only. No odds published to TD LAB.")
except (RuntimeError, ValueError, TypeError, KeyError) as exc:
    sys.exit("Odds provider probe failed: " + str(exc))
