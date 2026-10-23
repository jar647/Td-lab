"""Export verified Hard Rock YES anytime-TD prices. No credentials in output."""
import datetime as dt
import json
import os
import sys
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request

def get(endpoint, **params):
    key = os.environ.get("ODDSPAPI_API_KEY")
    if not key:
        raise RuntimeError("Missing ODDSPAPI_API_KEY")
    url = "https://api.oddspapi.io/v4/" + endpoint + "?" + urllib.parse.urlencode({"apiKey": key, **params})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "TD-LAB-feed/1.0"}), timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            if exc.code != 429 or attempt == 2:
                raise RuntimeError("Odds provider HTTP " + str(exc.code)) from None
        except (urllib.error.URLError, TimeoutError):
            if attempt == 2:
                raise RuntimeError("Odds provider unavailable") from None
        time.sleep(2 * (attempt + 1))
    raise RuntimeError("Odds provider retry limit reached")

def main():
    today = dt.datetime.now(dt.timezone.utc).date()
    data = get("fixtures", sportId=14, **{"from": today.isoformat(), "to": (today + dt.timedelta(days=7)).isoformat()})
    fixtures = data.get("fixtures", data.get("data", [])) if isinstance(data, dict) else data
    games = []
    for fixture in fixtures:
        if not isinstance(fixture, dict) or str(fixture.get("tournamentId")) != "31" or not fixture.get("fixtureId") or not fixture.get("hasOdds"):
            continue
        odds = get("odds", fixtureId=fixture["fixtureId"], bookmakers="hardrockbet", oddsFormat="american")
        market = (((odds.get("bookmakerOdds") or {}).get("hardrockbet") or {}).get("markets") or {}).get("14388") or {}
        yes = (market.get("outcomes") or {}).get("14388") or {}
        selections = []
        for player in (yes.get("players") or {}).values():
            if not isinstance(player, dict) or player.get("active") is not True:
                continue
            name, price = player.get("playerName"), str(player.get("priceAmerican") or "")
            if not name or not price.lstrip("+-").isdigit():
                continue
            price = int(price)
            if abs(price) < 100:
                raise RuntimeError("Invalid American odds; existing feed preserved")
            selections.append({"player_name": name, "american_odds": price})
        if selections:
            games.append({"fixture_id": str(fixture["fixtureId"]), "fixture_metadata": {k: fixture.get(k) for k in ("participant1Id", "participant2Id", "participant1Name", "participant2Name", "participant1Abbr", "participant2Abbr", "homeTeam", "awayTeam", "homeTeamName", "awayTeamName", "home", "away", "startTime", "startDate", "date") if fixture.get(k) is not None}, "selections": sorted(selections, key=lambda p:p["player_name"])})
    if not games:
        raise RuntimeError("No active Hard Rock anytime-TD prices; existing feed preserved")
    result = {"source": "OddsPapi / Hard Rock Bet", "market_id": 14388, "outcome_id": 14388, "retrieved_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(), "games": games}
    dest = Path("data/hardrock_anytime_td.json")
    dest.parent.mkdir(exist_ok=True)
    temporary = dest.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(result, indent=2) + "\n")
    temporary.replace(dest)
    print("Exported", len(games), "games and", sum(len(g["selections"]) for g in games), "active YES prices")

if __name__ == "__main__":
    main()
