"""NBA.com-only feed connectivity probe. Fails closed; never writes fabricated stats."""
import json
import sys
from datetime import datetime, timezone
from nba_api.stats.endpoints import leaguegamelog
from nba_api.live.nba.endpoints import scoreboard

season = "2026-27"
status = {"source": "NBA.com via nba_api", "season": season, "checked_at": datetime.now(timezone.utc).isoformat(), "ready": False}
try:
    games = scoreboard.ScoreBoard(timeout=15).get_dict()
    status["scoreboard_games"] = len(games.get("scoreboard", {}).get("games", []))
    logs = leaguegamelog.LeagueGameLog(season=season, player_or_team_abbreviation="P", timeout=20).get_data_frames()[0]
    required = {"PLAYER_ID", "PLAYER_NAME", "TEAM_ABBREVIATION", "GAME_ID", "GAME_DATE", "MIN", "PTS", "REB", "AST", "FG3M"}
    missing = sorted(required - set(logs.columns))
    if missing:
        raise ValueError("NBA game log missing required fields: " + ", ".join(missing))
    if logs.empty:
        raise ValueError("NBA game log is empty")
    status["player_game_rows"] = len(logs)
    status["ready"] = True
except Exception as exc:
    status["error"] = type(exc).__name__ + ": " + str(exc)[:250]
print(json.dumps(status, indent=2))
sys.exit(0 if status["ready"] else 1)
