"""Prepare public nflverse weekly box statistics for a chronological diagnostic.

The audit reconstructs prior-only model inputs; this is not an archive of
historical injury reports, book prices, or previously issued forecasts.
"""
import argparse
import json
from pathlib import Path

import nflreadpy as nfl
import pandas as pd

FIELDS = {"passYards": "passing_yards", "passAttempts": "attempts",
          "rushYards": "rushing_yards", "rushAttempts": "carries",
          "recYards": "receiving_yards", "receptions": "receptions", "targets": "targets",
          "passTDs": "passing_tds", "rushTDs": "rushing_tds", "recTDs": "receiving_tds"}


def prepare(frame):
    required = {"season_type", "position", "week", "game_id", "team", "player_id",
                "player_display_name"} | set(FIELDS.values())
    if not required.issubset(frame.columns):
        raise ValueError("Historical player schema is incomplete")
    frame = frame[frame.season_type.eq("REG") & frame.position.isin(["QB", "RB", "WR", "TE"])].sort_values(["week", "game_id"])
    if frame.duplicated(["game_id", "team", "player_id"]).any():
        raise ValueError("Ambiguous historical player-game identity")
    records = []
    for (team, player), group in frame.groupby(["team", "player_id"]):
        history = []
        for _, row in group.iterrows():
            if any(pd.isna(row[column]) for column in FIELDS.values()):
                continue
            history.append({"week": int(row.week), "gameId": row.game_id, "position": str(row.position),
                            **{key: float(row[column]) for key, column in FIELDS.items()}})
        if history:
            records.append({"team": team, "player_id": player,
                            "player": str(group.iloc[-1].player_display_name),
                            "pos": str(group.iloc[-1].position), "market": "ATD",
                            "playerAppearancesVerified": True, "seasonGameStats": history})
    return records


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("season", type=int)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    source = nfl.load_player_stats([args.season]).to_pandas()
    records = prepare(source)
    if not records:
        raise ValueError("No historical player records returned")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(records), encoding="utf-8")
    print(f"nflverse {args.season}: {len(records)} team-player histories")
