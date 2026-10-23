#!/usr/bin/env python3
"""Build an ESPN-derived *partial* defensive audit from raw ESPN box scores.

Only box-score counting stats are included. ESPN box scores do not establish
targets or red-zone targets; this file MUST NOT be treated as full verification.
"""
import argparse
import json
from collections import defaultdict
from pathlib import Path

POSITIONS = ("QB", "RB", "WR", "TE")
# ESPN player box score category names and their common column labels.
COLUMNS = {
    "passing": ("YDS", "C/ATT"),
    "rushing": ("YDS", "CAR"),
    "receiving": ("YDS", "REC"),
}

def number(value):
    if value in ("", "--", "-", None):
        raise ValueError("Missing box score statistic")
    return int(str(value).replace(",", ""))

def derive(raw):
    if raw.get("source") != "ESPN NFL game summary (unofficial)" or raw.get("failures"):
        raise ValueError("Incomplete or unexpected ESPN evidence")
    totals = defaultdict(lambda: defaultdict(int))
    games_by_defense = defaultdict(set)
    seen = set()
    for game in raw.get("games", []):
        event_id = str(game["event_id"])
        if event_id in seen:
            raise ValueError("Duplicate ESPN event")
        seen.add(event_id)
        competitors = game["competitors"]
        if len(competitors) != 2:
            raise ValueError("Expected two competitors")
        team_ids = {str(c["team"]["id"]): c["team"]["abbreviation"] for c in competitors}
        if len(team_ids) != 2:
            raise ValueError("Duplicate team IDs")
        player_groups = game["boxscore_players"]
        if len(player_groups) != 2:
            raise ValueError("Expected two player groups")
        for group in player_groups:
            offense_id = str(group["team"]["id"])
            if offense_id not in team_ids:
                raise ValueError("Player group team not in game")
            defense = next(abbr for tid, abbr in team_ids.items() if tid != offense_id)
            games_by_defense[defense].add(event_id)
            for category in group.get("statistics", []):
                category_name = category.get("name", "").lower()
                if category_name not in COLUMNS:
                    continue
                labels = [str(label).upper() for label in category.get("labels", [])]
                wanted = COLUMNS[category_name]
                if not all(label in labels for label in wanted):
                    raise ValueError(f"ESPN {category_name} missing expected columns: {labels}")
                indices = [labels.index(label) for label in wanted]
                for athlete_entry in category.get("athletes", []):
                    athlete = athlete_entry.get("athlete", {})
                    position = athlete.get("position", {}).get("abbreviation", "").upper()
                    if position not in POSITIONS:
                        continue
                    stats = athlete_entry.get("stats", [])
                    if len(stats) <= max(indices):
                        raise ValueError("Incomplete ESPN player row")
                    # Rushing/receiving column labels can differ by category.
                    first = number(stats[indices[0]])
                    second_raw = stats[indices[1]]
                    if category_name == "passing":
                        # ESPN reports completions/attempts as e.g. "19/28".
                        parts = str(second_raw).split("/")
                        if len(parts) != 2:
                            raise ValueError("Unexpected ESPN C/ATT value")
                        second = number(parts[1])
                    else:
                        second = number(second_raw)
                    key = (defense, position)
                    if category_name == "passing" and position == "QB":
                        totals[key]["pass_yards_total"] += first
                        totals[key]["pass_attempts_total"] += second
                    elif category_name == "rushing":
                        totals[key]["rush_yards_total"] += first
                        totals[key]["rush_attempts_total"] += second
                    elif category_name == "receiving":
                        totals[key]["rec_yards_total"] += first
                        totals[key]["receptions_total"] += second
    if not seen:
        raise ValueError("No completed ESPN games")
    rows = []
    for defense in sorted(games_by_defense):
        for position in POSITIONS:
            row = {"defense": defense, "position": position,
                   "games": len(games_by_defense[defense])}
            row.update(totals[(defense, position)])
            rows.append(row)
    return {"source": "ESPN NFL game summary (unofficial)",
            "source_url": "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary",
            "derived_from_nflverse": False, "season": raw["season"],
            "weeks": raw["weeks"], "retrieved_at": raw["retrieved_at"],
            "status": "PARTIAL_NOT_VERIFIED",
            "unsupported_metrics": ["targets_total", "redzone_targets_total"],
            "game_count": len(seen), "rows": rows}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", type=Path, default=Path("data/espn_raw_game_audit.json"))
    parser.add_argument("--output", type=Path, default=Path("data/espn_partial_defense_audit.json"))
    args = parser.parse_args()
    report = derive(json.loads(args.raw.read_text()))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Created {len(report['rows'])} partial defense-position rows; NOT independently verified.")

if __name__ == "__main__":
    main()
