"""Fetch a free National Weather Service hourly forecast for an NFL stadium."""
from datetime import date, datetime, time, timezone
import json
import math
import re
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from game_context import TEAM_COORDS

USER_AGENT = "CoOkItUp/1.0 (+https://github.com/jar647/Td-lab)"
_POINT_CACHE = {}
_HOURLY_CACHE = {}


def _request_json(url):
    req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/geo+json"})
    with urlopen(req, timeout=12) as response:
        return json.load(response)


def parse_wind_mph(value):
    if not value:
        return None
    nums = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", str(value))]
    if not nums:
        return None
    return sum(nums[:2]) / min(2, len(nums))


def kickoff_utc(game, home_team):
    try:
        game_date = date.fromisoformat(str(game.get("gameday"))[:10])
        raw_time = str(game.get("gametime") or "").strip()
        parts = raw_time.split(":")
        if len(parts) < 2:
            return None
        local = datetime.combine(game_date, time(int(parts[0]), int(parts[1])))
        # nflverse gametime is Eastern time, including road/neutral venues.
        # https://github.com/nflverse/nflreadr/blob/main/data-raw/dictionary_schedules.csv
        local = local.replace(tzinfo=ZoneInfo('America/New_York'))
        return local.astimezone(timezone.utc)
    except (KeyError, TypeError, ValueError):
        return None


def select_hourly_period(periods, kickoff):
    if not kickoff:
        return None
    candidates = []
    for period in periods or []:
        try:
            starts = datetime.fromisoformat(period["startTime"].replace("Z", "+00:00"))
            ends = datetime.fromisoformat(period["endTime"].replace("Z", "+00:00"))
        except (KeyError, TypeError, ValueError):
            continue
        if starts <= kickoff < ends:
            return period
        delta = abs((starts - kickoff).total_seconds())
        if delta <= 3600:
            candidates.append((delta, period))
    return min(candidates, key=lambda x:x[0])[1] if candidates else None


def forecast_for_game(game, home_team, roof=None):
    """Return a timestamped forecast, or explicit missing/unavailable status."""
    if str(game.get('location','')).lower() == 'neutral':
        return {"available": False, "source": "NWS", "reason": "Neutral-site stadium coordinates are unverified; designated home stadium weather is not used."}
    if str(roof or "").lower() in ("dome", "closed"):
        return {"available": False, "source": "NWS", "reason": "Indoor venue; outdoor weather is not a game-condition input."}
    coords = TEAM_COORDS.get(home_team)
    kickoff = kickoff_utc(game, home_team)
    if not coords or not kickoff:
        return {"available": False, "source": "NWS", "reason": "Stadium coordinates or scheduled Eastern kickoff time unavailable."}
    lat, lon = coords
    point_key = (lat, lon)
    try:
        if point_key not in _POINT_CACHE:
            point = _request_json(f"https://api.weather.gov/points/{lat},{lon}")
            _POINT_CACHE[point_key] = point.get("properties", {}).get("forecastHourly")
        hourly_url = _POINT_CACHE[point_key]
        if not hourly_url:
            return {"available": False, "source": "NWS", "reason": "NWS hourly forecast endpoint unavailable for this stadium."}
        if hourly_url not in _HOURLY_CACHE:
            _HOURLY_CACHE[hourly_url] = _request_json(hourly_url)
        payload = _HOURLY_CACHE[hourly_url]
        period = select_hourly_period(payload.get("properties", {}).get("periods"), kickoff)
        if not period:
            return {"available": False, "source": "NWS", "reason": "Kickoff is outside the available hourly forecast window."}
        precip = period.get("probabilityOfPrecipitation") or {}
        temp = period.get("temperature")
        return {"available": True, "source": "National Weather Service hourly forecast",
                "forecast_time": period.get("startTime"),
                "updated_at": payload.get("properties", {}).get("updated"),
                "temperature_f": temp if isinstance(temp, (int, float)) and math.isfinite(temp) else None,
                "wind_mph": parse_wind_mph(period.get("windSpeed")),
                "wind_direction": period.get("windDirection"),
                "precipitation_probability": precip.get("value"),
                "condition": period.get("shortForecast")}
    except (HTTPError, URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
        return {"available": False, "source": "NWS", "reason": f"Forecast fetch failed: {type(exc).__name__}."}
