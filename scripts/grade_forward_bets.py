"""Grade forward-captured TD LAB decisions only when IDs, prices and outcomes agree.

Input: data/forward/decisions/*.json, one file per pregame capture.
Each decision must carry immutable player_id, fixture_id, kickoff_utc, captured_at_utc,
american_odds, model_probability, and a unique game/player identity. Never infer
player IDs from abbreviated names or reuse post-kickoff odds.

Outputs research performance summaries, not betting recommendations.
"""
import json
from datetime import datetime, timezone
from pathlib import Path

INPUT = Path("data/forward/decisions")
RESULTS = Path("data/history")
OUTPUT = Path("data/forward/performance.json")

def when(value):
    d = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if d.tzinfo is None:
        raise ValueError("Timezone required")
    return d.astimezone(timezone.utc)

def profit(odds, won):
    if not isinstance(odds, int) or (-100 < odds < 100):
        raise ValueError("Invalid American odds")
    return (odds / 100 if odds > 0 else 100 / -odds) if won else -1.0

def grade(documents, results):
    eligible = []
    rejected = []
    seen = set()
    for doc in documents:
        for row in doc.get("decisions", []):
            try:
                season, week = int(row["season"]), int(row["week"])
                player = str(row["player_id"])
                fixture = str(row["fixture_id"])
                if not player or not fixture or not row.get("identity_verified"):
                    raise ValueError("Unverified player/fixture identity")
                captured, kickoff = when(row["captured_at_utc"]), when(row["kickoff_utc"])
                if captured >= kickoff:
                    raise ValueError("Not a pregame capture")
                key = (season, week, fixture, player)
                if key in seen:
                    raise ValueError("Duplicate decision")
                seen.add(key)
                probability = row.get("model_probability")
                if not isinstance(probability, (int, float)) or isinstance(probability, bool) or not 0 < probability < 1:
                    raise ValueError("No valid frozen model probability")
                if row.get("model_status") != "validated":
                    raise ValueError("Model not validated at capture")
                price = row["american_odds"]
                profit(price, False)
                result = results.get((season, week))
                if not result or not result.get("accuracy_eligible") or not result.get("pregame_snapshot"):
                    raise ValueError("No eligible graded pregame result")
                matches = [p for p in result.get("players", []) if str(p.get("player_id")) == player]
                if len(matches) != 1 or not isinstance(matches[0].get("scored_td"), bool):
                    raise ValueError("No unique graded touchdown outcome")
                won = matches[0]["scored_td"]
                eligible.append({"season": season, "week": week, "player_id": player,
                                 "fixture_id": fixture, "american_odds": price,
                                 "model_probability": probability, "won": won,
                                 "units": round(profit(price, won), 5)})
            except (KeyError, ValueError, TypeError, OverflowError) as exc:
                rejected.append(str(exc))
    units = sum(x["units"] for x in eligible)
    return {"status": "research_only", "bet_ready": False,
            "graded_bets": len(eligible), "wins": sum(x["won"] for x in eligible),
            "win_rate": round(sum(x["won"] for x in eligible) / len(eligible), 5) if eligible else None,
            "flat_stake_units": round(units, 5),
            "roi": round(units / len(eligible), 5) if eligible else None,
            "rejected_count": len(rejected), "rejection_reasons": rejected[:25],
            "records": eligible,
            "warning": "Hypothetical flat-stake returns from verified frozen prices; no guarantee of execution, availability or profitability."}

def main():
    documents = [json.loads(p.read_text()) for p in sorted(INPUT.glob("*.json"))]
    results = {}
    for path in sorted(RESULTS.glob("*-results.json")):
        obj = json.loads(path.read_text())
        results[(int(obj["season"]), int(obj["week"]))] = obj
    summary = grade(documents, results)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(summary, indent=2) + "\n")
    print("Forward tracker:", summary["graded_bets"], "graded;", summary["rejected_count"], "rejected")

if __name__ == "__main__":
    main()
