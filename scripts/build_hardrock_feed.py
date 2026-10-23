"""Export verified Hard Rock YES anytime-TD prices. No credentials in output."""
import datetime as dt
import json
import os
import sys
from pathlib import Path
from probe_hardrock import get

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
            selections.append({"player_name": name, "american_odds": int(price)})
        if selections:
            games.append({"fixture_id": str(fixture["fixtureId"]), "selections": sorted(selections, key=lambda p:p["player_name"])})
    result = {"source": "OddsPapi / Hard Rock Bet", "market_id": 14388, "outcome_id": 14388, "retrieved_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(), "games": games}
    dest = Path("data/hardrock_anytime_td.json")
    dest.parent.mkdir(exist_ok=True)
    dest.write_text(json.dumps(result, indent=2) + "\n")
    print("Exported", len(games), "games and", sum(len(g["selections"]) for g in games), "active YES prices")

if __name__ == "__main__":
    main()
