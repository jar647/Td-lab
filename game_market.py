"""Normalize documented nflverse schedule markets into home-team bet notation.

Source: https://github.com/nflverse/nflreadr/blob/main/data-raw/dictionary_schedules.csv
spread_line is the home team's expected winning margin (positive home favorite).
Our homeSpread is the handicap added to the home score (negative home favorite).
Schedule lines are closing proxies, never timestamped executable quotes.
"""
import math

SCHEDULE_SOURCE = "nflverse_schedule_closing_proxy"


def number(value):
    if isinstance(value, bool) or value is None or value == "":
        return None
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def american(value):
    result = number(value)
    return int(result) if result is not None and result.is_integer() and 100 <= abs(result) <= 100000 else None


def schedule_market(game):
    explicit = number(game.get("home_spread"))
    margin_line = number(game.get("spread_line"))
    converted = -margin_line if margin_line is not None else None
    if explicit is not None and converted is not None and abs(explicit - converted) > 1e-9:
        raise ValueError("Conflicting home_spread and documented nflverse spread_line")
    spread = explicit if explicit is not None else converted
    total = number(game.get("total_line"))
    return {
        "market_home_spread": spread if spread is not None and abs(spread) <= 35 else None,
        "market_total": total if total is not None and 15 <= total <= 90 else None,
        "home_moneyline": american(game.get("home_moneyline")),
        "away_moneyline": american(game.get("away_moneyline")),
        "home_spread_odds": american(game.get("home_spread_odds")),
        "away_spread_odds": american(game.get("away_spread_odds")),
        "over_odds": american(game.get("over_odds")),
        "under_odds": american(game.get("under_odds")),
        "market_source": SCHEDULE_SOURCE,
        "spread_convention": "home_score + market_home_spread - away_score",
        "executable_pregame_quote": False,
    }
