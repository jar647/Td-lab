"""Leakage-safe NFL team matchup features from completed nflverse plays.

The helpers intentionally use only regular-season plays before the requested
week. EPA and success-rate adjustments are research features, not calibrated
betting probabilities.
"""
from collections import defaultdict
import math

EPA_SCORE_WEIGHT = 5.0
SUCCESS_SCORE_WEIGHT = 12.0
MIN_CONTEXT_GAMES = 3

# Approximate NFL home-stadium coordinates used only for great-circle travel
# estimates. These are not road routes or actual team charter itineraries.
TEAM_COORDS = {
    "ARI": (33.5276, -112.2626), "ATL": (33.7554, -84.4008),
    "BAL": (39.2780, -76.6227), "BUF": (42.7738, -78.7870),
    "CAR": (35.2258, -80.8530), "CHI": (41.8623, -87.6167),
    "CIN": (39.0954, -84.5160), "CLE": (41.5061, -81.6995),
    "DAL": (32.7473, -97.0945), "DEN": (39.7439, -105.0201),
    "DET": (42.3400, -83.0456), "GB": (44.5013, -88.0622),
    "HOU": (29.6847, -95.4107), "IND": (39.7601, -86.1639),
    "JAX": (30.3239, -81.6373), "KC": (39.0489, -94.4839),
    "LA": (33.9535, -118.3392), "LAC": (33.9535, -118.3392),
    "LV": (36.0909, -115.1833), "MIA": (25.9580, -80.2389),
    "MIN": (44.9738, -93.2581), "NE": (42.0909, -71.2643),
    "NO": (29.9511, -90.0812), "NYG": (40.8135, -74.0745),
    "NYJ": (40.8135, -74.0745), "PHI": (39.9008, -75.1675),
    "PIT": (40.4468, -80.0158), "SEA": (47.5952, -122.3316),
    "SF": (37.4030, -121.9700), "TB": (27.9759, -82.5033),
    "TEN": (36.1665, -86.7713), "WAS": (38.9076, -76.8645),
}


def _num(row, key):
    try:
        value = float(row.get(key))
        return value if math.isfinite(value) else None
    except (TypeError, ValueError):
        return None


def _flag(row, key):
    value = _num(row, key)
    return bool(value) if value is not None else False


def _summarize(rows, team, side):
    team_key = "posteam" if side == "offense" else "defteam"
    plays = [r for r in rows if r.get(team_key) == team and
             r.get("play_type") in ("run", "pass") and not _flag(r, "no_play")]
    valid = [(r, _num(r, "epa")) for r in plays]
    valid = [(r, epa) for r, epa in valid if epa is not None]
    if not valid:
        return {"games": 0, "plays": 0}

    def avg(pairs):
        return sum(v for _, v in pairs) / len(pairs) if pairs else None

    all_epa = [(r, epa) for r, epa in valid]
    pass_epa = [(r, epa) for r, epa in valid if r.get("play_type") == "pass"]
    rush_epa = [(r, epa) for r, epa in valid if r.get("play_type") == "run"]
    games = {r.get("game_id") for r, _ in valid if r.get("game_id")}
    successful = [(r, epa) for r, epa in valid if
                  (_num(r, "success") if _num(r, "success") is not None else epa > 0)]
    explosive = [(r, epa) for r, epa in valid if
                 (_num(r, "yards_gained") or 0) >= (20 if r.get("play_type") == "pass" else 10)]
    pass_plays = len(pass_epa)
    sacks = sum(_flag(r, "sack") for r, _ in pass_epa)
    turnovers = sum(_flag(r, "interception") or _flag(r, "fumble_lost") for r, _ in valid)
    result = {
        "games": len(games), "plays": len(valid),
        "epa_per_play": avg(all_epa), "success_rate": len(successful) / len(valid),
        "explosive_rate": len(explosive) / len(valid),
        "pass_rate": pass_plays / len(valid), "pass_epa": avg(pass_epa),
        "rush_epa": avg(rush_epa),
    }
    if side == "offense":
        result["turnovers_per_game"] = turnovers / max(1, len(games))
    else:
        result["sacks_per_game"] = sacks / max(1, len(games))
    return result


def team_context(play_rows, season, week, team):
    """Return season-to-date and last-four-game offense/defense rates."""
    rows = []
    for row in play_rows:
        try:
            row_season, row_week = int(row.get("season")), int(row.get("week"))
        except (TypeError, ValueError):
            continue
        if row_season != int(season) or row_week >= int(week):
            continue
        if str(row.get("season_type", "REG")).upper() not in ("REG", "2"):
            continue
        rows.append(row)

    offense = _summarize(rows, team, "offense")
    defense = _summarize(rows, team, "defense")
    team_game_weeks = sorted({(int(r["week"]), r.get("game_id")) for r in rows
                              if r.get("posteam") == team or r.get("defteam") == team})
    recent_ids = {game_id for _, game_id in team_game_weeks[-4:] if game_id}
    recent = [r for r in rows if r.get("game_id") in recent_ids]
    return {"offense": offense, "defense": defense,
            "recent_offense": _summarize(recent, team, "offense"),
            "recent_defense": _summarize(recent, team, "defense")}


def matchup_context(home, away):
    """Summarize both directional offense-vs-defense comparisons."""
    def side(off, defense):
        o, d = off["offense"], defense["defense"]
        has_rates = all(isinstance(x, (int, float)) for x in
                        (o.get("epa_per_play"), d.get("epa_per_play"),
                         o.get("success_rate"), d.get("success_rate")))
        if not has_rates:
            return {"available": False, "score_adjustment": 0.0,
                    "warning": "Fewer than three complete games of play-by-play context; no EPA adjustment applied."}
        games = min(o.get("games", 0), d.get("games", 0))
        if games < MIN_CONTEXT_GAMES:
            return {"available": False, "score_adjustment": 0.0,
                    "warning": "Fewer than three complete games of play-by-play context; no EPA adjustment applied."}
        ro, rd = off.get("recent_offense", {}), defense.get("recent_defense", {})
        # Blend the season-to-date matchup with the latest four games. The
        # recent rate is shrunk toward the season rate to limit early noise.
        recent_games = min(ro.get("games", 0), rd.get("games", 0))
        recent_weight = min(0.4, 0.1 * recent_games)
        offense_epa = o["epa_per_play"]
        defense_epa = d["epa_per_play"]
        offense_success = o["success_rate"]
        defense_success = d["success_rate"]
        if recent_games and isinstance(ro.get("epa_per_play"), (int, float)) and isinstance(rd.get("epa_per_play"), (int, float)):
            offense_epa = (1 - recent_weight) * offense_epa + recent_weight * ro["epa_per_play"]
            defense_epa = (1 - recent_weight) * defense_epa + recent_weight * rd["epa_per_play"]
            offense_success = (1 - recent_weight) * offense_success + recent_weight * ro["success_rate"]
            defense_success = (1 - recent_weight) * defense_success + recent_weight * rd["success_rate"]
        epa_delta = offense_epa - defense_epa
        success_delta = offense_success - defense_success
        raw = EPA_SCORE_WEIGHT * epa_delta + SUCCESS_SCORE_WEIGHT * success_delta
        # Shrink early-season estimates; maximum is the empirically tested EPA
        # challenger correction, while the score distribution remains uncalibrated.
        shrink = min(1.0, games / 6.0)
        return {"available": True, "offense_games": o["games"], "defense_games": d["games"],
                "offense_epa_per_play": offense_epa, "defense_epa_allowed_per_play": defense_epa,
                "offense_success_rate": offense_success, "defense_success_allowed_rate": defense_success,
                "recent_form_games": recent_games, "recent_form_weight": recent_weight,
                "epa_per_play_delta": epa_delta, "success_rate_delta": success_delta,
                "explosive_rate_offense": o.get("explosive_rate"),
                "explosive_rate_defense_allowed": d.get("explosive_rate"),
                "pass_epa_offense": o.get("pass_epa"), "pass_epa_defense_allowed": d.get("pass_epa"),
                "rush_epa_offense": o.get("rush_epa"), "rush_epa_defense_allowed": d.get("rush_epa"),
                "plays_per_game": o.get("plays", 0) / max(1, o.get("games", 0)),
                "turnovers_per_game": o.get("turnovers_per_game"),
                "defensive_sacks_per_game": d.get("sacks_per_game"),
                "score_adjustment": raw * shrink,
                "warning": "Play-by-play matchup adjustment is experimental and not calibrated."}

    return {"home_offense_vs_away_defense": side(home, away),
            "away_offense_vs_home_defense": side(away, home)}


def adjusted_projection(home_points, away_points, context):
    home = context["home_offense_vs_away_defense"]["score_adjustment"]
    away = context["away_offense_vs_home_defense"]["score_adjustment"]
    return round(max(0.0, home_points + home), 1), round(max(0.0, away_points + away), 1)


def travel_estimate(away_team, home_team, neutral=False):
    """Approximate away-team flight distance to the host city, when known."""
    if neutral:
        return {"available": False, "warning": "Neutral-site venue coordinates are not available."}
    origin, destination = TEAM_COORDS.get(away_team), TEAM_COORDS.get(home_team)
    if not origin or not destination:
        return {"available": False, "warning": "Stadium coordinates are unavailable."}
    lat1, lon1 = map(math.radians, origin)
    lat2, lon2 = map(math.radians, destination)
    dlat, dlon = lat2-lat1, lon2-lon1
    a = math.sin(dlat/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2
    miles = 3958.7613 * 2 * math.asin(math.sqrt(a))
    return {"available": True, "air_distance_miles": round(miles),
            "estimated_flight_hours": round(miles/500 + 1.0, 1),
            "warning": "Great-circle estimate at 500 mph plus 1 hour; actual charter route and team itinerary are unknown."}


def residual_context(game, home, away):
    """Compact, pregame-only covariates used to find comparable score residuals."""
    def number(key):
        try:
            value = float(game.get(key))
            return value if math.isfinite(value) else None
        except (TypeError, ValueError):
            return None
    location = game.get("location")
    neutral = str(location).strip().lower() == "neutral" if location is not None else False
    travel = travel_estimate(away, home, neutral)
    return {"home_rest": number("home_rest"), "away_rest": number("away_rest"),
            "travel_miles": travel.get("air_distance_miles") if travel.get("available") else None}
