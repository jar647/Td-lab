"""NFL probability engine phase 1: fail-closed matchup feed quality audit.
Run: python probability_feed_gate.py [data/matchups.json]
No third-party dependencies. No claim of externally verified roster completeness.
"""
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

MARKETS = {
    "passYards": ("QB", "playerPassYards", "playerPassAttempts", 20),
    "rushYards": ("RB,QB", "playerRushYards", "playerCarries", 5),
    "recYards": ("WR,TE,RB", "playerRecYards", "playerTargets", 3),
    "receptions": ("WR,TE,RB", "playerReceptions", "playerTargets", 3),
}
def finite(value):
    try:
        x = float(value)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None

def audit(rows):
    if not isinstance(rows, list):
        raise ValueError("Matchup feed must be a JSON array")
    games = defaultdict(list)
    for p in rows:
        if not isinstance(p, dict):
            continue
        team, opp = p.get("team"), p.get("opp")
        if team and opp and team != opp:
            games[tuple(sorted((str(team), str(opp))))].append(p)
    output = []
    for matchup, players in sorted(games.items()):
        issues, supported = [], []
        team_counts = Counter(p.get("team") for p in players)
        if any(team_counts[t] < 15 for t in matchup):
            issues.append("LOW_ROSTER_COVERAGE: fewer than 15 player records for a team; completeness unverified")
        for team in matchup:
            if not any(p.get("team") == team and p.get("pos") == "QB" for p in players):
                issues.append("MISSING_QB: " + team)
        seen = set()
        for p in players:
            name, team = p.get("player"), p.get("team")
            key = (team, name)
            if key in seen:
                issues.append("DUPLICATE_PLAYER: " + str(key))
            seen.add(key)
            if not name:
                issues.append("UNNAMED_PLAYER")
                continue
            for market, (positions, avg_key, vol_key, minimum) in MARKETS.items():
                if p.get("pos") not in positions.split(","):
                    continue
                recent = [finite(g.get(market)) for g in p.get("last5GameStats", []) if isinstance(g, dict)]
                recent = [x for x in recent if x is not None and x >= 0]
                avg, vol = finite(p.get(avg_key)), finite(p.get(vol_key))
                if len(recent) >= 3 and avg is not None and avg >= 0 and vol is not None and vol >= minimum and p.get("playerAppearancesVerified") is not False:
                    supported.append({"player": name, "team": team, "market": market, "sample_games": len(recent)})
        if len(supported) < 10:
            issues.append("THIN_MARKET_COVERAGE: fewer than 10 supported player markets")
        # The feed itself cannot establish that every active player is present,
        # that injuries are current, or that source timestamps predate kickoff.
        issues.extend(["EXTERNAL_ROSTER_UNVERIFIED", "PREGAME_INJURY_SNAPSHOT_UNVERIFIED", "SOURCE_ASOF_UNVERIFIED"])
        output.append({"matchup": list(matchup), "player_records": dict(team_counts),
                       "supported_markets": len(supported), "issues": sorted(set(issues)),
                       "probability_ready": False,
                       "reason": "External roster, injury and pregame timestamp checks not yet implemented"})
    return {"schema_version": 1, "games": output, "matchups_checked": len(output),
            "probability_ready_games": 0,
            "disclaimer": "A passing internal feed audit is not a calibrated probability model."}

def main():
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "data/matchups.json")
    result = audit(json.loads(path.read_text(encoding="utf-8")))
    print(json.dumps(result, indent=2))
    if len(sys.argv) > 2:
        Path(sys.argv[2]).write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return 0 if result["matchups_checked"] else 1

if __name__ == "__main__":
    raise SystemExit(main())
