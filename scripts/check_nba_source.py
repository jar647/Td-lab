"""Test NBA.com live and stats endpoints independently; fail closed."""
import json
import sys
from datetime import datetime, timezone
from nba_api.live.nba.endpoints import scoreboard, boxscore
from nba_api.stats.endpoints import leaguegamelog

status = {"source": "NBA.com via nba_api", "season": "2026-27",
          "checked_at": datetime.now(timezone.utc).isoformat(),
          "live_scoreboard": False, "live_boxscore": False,
          "historical_game_logs": False, "ready": False}
try:
    payload = scoreboard.ScoreBoard(timeout=15).get_dict()
    games = payload.get("scoreboard", {}).get("games", [])
    status["scoreboard_games"] = len(games)
    status["live_scoreboard"] = bool(games)
    if not games:
        raise ValueError("No games returned from live scoreboard")
    game_id = next((g.get("gameId") for g in games if g.get("gameStatus") == 3 and g.get("gameId")), None)
    if game_id:
        try:
            b = boxscore.BoxScore(game_id=game_id, timeout=15).get_dict()
            game = b.get("game", {})
            players = game.get("homeTeam", {}).get("players", []) + game.get("awayTeam", {}).get("players", [])
            status["boxscore_players"] = len(players)
            status["live_boxscore"] = bool(players)
        except Exception as exc:
            status["boxscore_error"] = f"{type(exc).__name__}: {str(exc)[:220]}"
    else:
        status["boxscore_error"] = "No completed game in scoreboard snapshot"
except Exception as exc:
    status["scoreboard_error"] = f"{type(exc).__name__}: {str(exc)[:220]}"
try:
    logs = leaguegamelog.LeagueGameLog(season="2026-27", player_or_team_abbreviation="P", timeout=12).get_data_frames()[0]
    required = {"PLAYER_ID","PLAYER_NAME","TEAM_ABBREVIATION","GAME_ID","GAME_DATE","MIN","PTS","REB","AST","FG3M"}
    missing = sorted(required - set(logs.columns))
    if missing or logs.empty:
        raise ValueError(f"Invalid or empty game logs; missing={missing}")
    status["historical_game_logs"] = True
    status["player_game_rows"] = len(logs)
except Exception as exc:
    status["stats_error"] = f"{type(exc).__name__}: {str(exc)[:220]}"
status["ready"] = status["live_scoreboard"] and status["live_boxscore"] and status["historical_game_logs"]
print(json.dumps(status, indent=2), flush=True)
sys.exit(0 if status["ready"] else 1)
