"""Archive timestamped sportsbook snapshots for future *prospective* value audits.

Snapshots are saved only when fetched, never reconstructed from game results.
No betting ROI can be inferred without matching a pre-kickoff price and result.
"""
import datetime as dt
import json
from pathlib import Path

SOURCE = Path("data/hardrock_anytime_td.json")
ROOT = Path("data/odds_history")

def main():
    feed = json.loads(SOURCE.read_text())
    if feed.get("market_id") != 14388 or feed.get("outcome_id") != 14388:
        raise ValueError("Not verified YES anytime TD market")
    stamp = dt.datetime.fromisoformat(feed["retrieved_at_utc"].replace("Z", "+00:00"))
    if stamp.tzinfo is None:
        raise ValueError("Timestamp must include timezone")
    age = abs((dt.datetime.now(dt.timezone.utc) - stamp).total_seconds())
    if age > 900:
        raise ValueError("Refusing to archive feed older than 15 minutes")
    games = feed.get("games", [])
    if not games:
        raise ValueError("No games; refusing empty snapshot")
    for game in games:
        if not game.get("fixture_id") or not game.get("fixture_metadata", {}).get("startTime"):
            raise ValueError("Missing fixture identity or kickoff time")
        for p in game.get("selections", []):
            odds = p.get("american_odds")
            if not p.get("player_name") or not isinstance(odds, int) or -100 < odds < 100:
                raise ValueError("Malformed American odds selection")
        if game.get("selections"):
            pregame_games.append(game)
    if not pregame_games:
        raise ValueError("No verifiable pre-kickoff games; refusing snapshot")
    feed = {**feed, "games": pregame_games, "archive_policy": "Only odds captured before fixture kickoff; not verified game-day availability"}
    day = stamp.strftime("%Y-%m-%d")
    dest = ROOT / day / (stamp.strftime("%Y%m%dT%H%M%S%fZ") + ".json")
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        if json.loads(dest.read_text()) != feed:
            raise RuntimeError("Archived snapshot collision")
        print("Snapshot already archived", dest)
        return
    dest.write_text(json.dumps(feed, separators=(",", ":")) + "\n")
    print("Archived", dest, "with", len(games), "fixtures")

if __name__ == "__main__":
    main()
