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
TEAM_TIMEZONES = {
    "ARI":"America/Phoenix", "ATL":"America/New_York", "BAL":"America/New_York",
    "BUF":"America/New_York", "CAR":"America/New_York", "CHI":"America/Chicago",
    "CIN":"America/New_York", "CLE":"America/New_York", "DAL":"America/Chicago",
    "DEN":"America/Denver", "DET":"America/Detroit", "GB":"America/Chicago",
    "HOU":"America/Chicago", "IND":"America/Indiana/Indianapolis", "JAX":"America/New_York",
    "KC":"America/Chicago", "LA":"America/Los_Angeles", "LAC":"America/Los_Angeles",
    "LV":"America/Los_Angeles", "MIA":"America/New_York", "MIN":"America/Chicago",
    "NE":"America/New_York", "NO":"America/Chicago", "NYG":"America/New_York",
    "NYJ":"America/New_York", "PHI":"America/New_York", "PIT":"America/New_York",
    "SEA":"America/Los_Angeles", "SF":"America/Los_Angeles", "TB":"America/New_York",
    "TEN":"America/Chicago", "WAS":"America/New_York",
}
_POINT_CACHE = {}
_HOURLY_CACHE = {}


def _aware_datetime(value):
    """Unknown or timezone-free dates cannot establish pregame evidence."""
    try:
        parsed = value if isinstance(value, datetime) else datetime.fromisoformat(value.replace("Z", "+00:00")) if isinstance(value, str) else None
        return parsed if parsed is not None and parsed.tzinfo is not None and parsed.utcoffset() is not None else None
    except (TypeError, ValueError, OverflowError):
        return None


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
        # nflverse gametime is Eastern for every stadium (dictionary_schedules).
        local = local.replace(tzinfo=ZoneInfo("America/New_York"))
        return local.astimezone(timezone.utc)
    except (KeyError, TypeError, ValueError):
        return None


def select_hourly_period(periods, kickoff):
    kickoff = _aware_datetime(kickoff)
    if kickoff is None or not isinstance(periods, (list, tuple)):
        return None
    candidates = []
    for period in periods:
        if not isinstance(period, dict):
            continue
        starts = _aware_datetime(period.get("startTime"))
        ends = _aware_datetime(period.get("endTime"))
        if starts is None or ends is None or ends <= starts:
            continue
        if starts <= kickoff < ends:
            return period
        delta = abs((starts - kickoff).total_seconds())
        if delta <= 3600:
            candidates.append((delta, period))
    return min(candidates, key=lambda x:x[0])[1] if candidates else None


def forecast_for_game(game, home_team, roof=None, now=None):
    """Return a timestamped forecast, or explicit missing/unavailable status."""
    if str(game.get("location", "")).strip().lower() == "neutral":
        return {"available": False, "source": "NWS", "reason": "Verified neutral-site coordinates unavailable; home-stadium weather is not used."}
    if str(roof or "").lower() in ("dome", "closed"):
        return {"available": False, "source": "NWS", "reason": "Indoor venue; outdoor weather is not a game-condition input."}
    coords = TEAM_COORDS.get(home_team)
    kickoff = kickoff_utc(game, home_team)
    if not coords or not kickoff:
        return {"available": False, "source": "NWS", "reason": "Stadium coordinates or scheduled local kickoff time unavailable."}
    clock = _aware_datetime(now if now is not None else datetime.now(timezone.utc))
    if clock is None:
        return {"available": False, "source": "NWS", "reason": "Timezone-aware current time is required to verify forecast freshness."}
    if clock >= kickoff:
        return {"available": False, "source": "NWS", "kickoff_at": kickoff.isoformat(),
                "reason": "Pregame weather research closes at kickoff."}
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
        properties = payload.get("properties") if isinstance(payload, dict) else None
        properties = properties if isinstance(properties, dict) else {}
        timestamp_field = next((key for key in ("updated", "updateTime", "generatedAt") if properties.get(key) is not None), None)
        raw_update = properties.get(timestamp_field) if timestamp_field else None
        updated_at = raw_update if isinstance(raw_update, str) else None
        stamp = _aware_datetime(updated_at)
        evidence = {"available": False, "source": "NWS", "updated_at": updated_at,
                    "source_timestamp_field": timestamp_field, "kickoff_at": kickoff.isoformat()}
        if stamp is None:
            return {**evidence, "reason": "A dated, timezone-aware NWS forecast update is required; missing or malformed update time."}
        age = (clock-stamp).total_seconds()
        if age > 12*3600:
            return {**evidence, "reason": "NWS forecast update is stale (older than 12 hours); prior source timestamp retained."}
        if age < -300 or stamp >= kickoff:
            return {**evidence, "reason": "NWS forecast update is in the future or not before kickoff; no verified pregame forecast."}
        period = select_hourly_period(properties.get("periods"), kickoff)
        if not period:
            return {**evidence, "reason": "Kickoff is outside the available hourly forecast window."}
        precip = period.get("probabilityOfPrecipitation") or {}
        temp = period.get("temperature")
        return {"available": True, "source": "National Weather Service hourly forecast",
                "forecast_time": period.get("startTime"),
                "updated_at": updated_at,
                "source_timestamp_field": timestamp_field,
                "temperature_f": temp if isinstance(temp, (int, float)) and math.isfinite(temp) else None,
                "wind_mph": parse_wind_mph(period.get("windSpeed")),
                "wind_direction": period.get("windDirection"),
                "precipitation_probability": precip.get("value"),
                "condition": period.get("shortForecast")}
    except (HTTPError, URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
        return {"available": False, "source": "NWS", "reason": f"Forecast fetch failed: {type(exc).__name__}."}

