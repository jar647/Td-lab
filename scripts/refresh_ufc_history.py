#!/usr/bin/env python3
"""Cache public ESPN method records and explicitly formatted UFC/DWCS history.

This script uses public GET requests only. Overall professional records include
regional promotions; they must not be presented as UFC-only records. Missing
scheduled formats and decision counts stay unknown rather than being inferred.
"""
import concurrent.futures
import datetime
import json
import math
import pathlib
import re
import threading
import urllib.request

UTC = datetime.timezone.utc
SOURCE = "ESPN public athlete histories and overall professional records"
HISTORY_SOURCE = "ESPN completed UFC/DWCS history; scheduled rounds from explicit competition format"
RECORD_SOURCE = "ESPN overall professional record"
ATHLETE_URL = "https://site.api.espn.com/apis/common/v3/sports/mma/ufc/athletes/{}"
RECORD_URL = "https://sports.core.api.espn.com/v2/sports/mma/leagues/ufc/athletes/{}/records?lang=en&region=us"
COMPETITION_URL = "https://sports.core.api.espn.com/v2/sports/mma/leagues/ufc/events/{}/competitions/{}?lang=en&region=us"
UID = re.compile(r"(?:^|~)l:(\d+)~e:(\d+)~c:(\d+)(?:$|~)")
STAT_NAMES = {"wins": "wins", "losses": "losses", "draws": "draws",
              "noContests": "no_contests", "tkos": "wins_ko",
              "submissions": "wins_sub", "tkoLosses": "losses_ko",
              "submissionLosses": "losses_sub"}


def get_json(url):
    request = urllib.request.Request(url, headers={"User-Agent": "ThePropShop/1.0"}, method="GET")
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)


def date(value):
    try:
        parsed = datetime.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)
    except (ValueError, TypeError):
        return None


def count(value):
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = float(value)
        return int(number) if math.isfinite(number) and number >= 0 and number.is_integer() else None
    except (ValueError, TypeError, OverflowError):
        return None


def method_kind(value):
    value = str(value or "").lower().strip()
    # Technical decisions and disqualifications are not ordinary full decisions.
    if "technical" in value or "disqual" in value:
        return None
    if value.startswith(("ko", "tko")):
        return "ko"
    if value.startswith(("submission", "sub-", "sub ")) or value == "sub":
        return "sub"
    if value.startswith("decision"):
        return "dec"
    return None


def records(payload, events, now):
    """Read explicit overall counts; decisions require complete observed history."""
    items = payload.get("items", []) if isinstance(payload, dict) else []
    overall = next((item for item in items if isinstance(item, dict) and item.get("name") == "overall"), None)
    if not overall or not isinstance(overall.get("stats"), list):
        return None
    output = {}
    for item in overall["stats"]:
        if not isinstance(item, dict):
            continue
        key, value = STAT_NAMES.get(item.get("name")), count(item.get("value"))
        if key and value is not None:
            output[key] = value
    if "wins" not in output or "losses" not in output:
        return None
    # Count decisions from the complete professional history, never by subtraction.
    unique = {}
    for key, event in events.items():
        if isinstance(event, dict):
            unique[event.get("uid") or key] = event
    for outcome, prefix, total in (("W", "wins", output["wins"]), ("L", "losses", output["losses"])):
        rows = [event for event in unique.values() if event.get("gameResult") == outcome]
        kinds = [method_kind((event.get("status") or {}).get("result", {}).get("name")) for event in rows]
        complete = len(rows) == total and all(kinds) and all(date(row.get("gameDate")) and date(row["gameDate"]) <= now for row in rows)
        coherent = all(output.get(prefix + "_" + kind, kinds.count(kind)) == kinds.count(kind) for kind in ("ko", "sub"))
        if complete and coherent:
            output[prefix + "_dec"] = kinds.count("dec")
    return output


def explicit_rounds(payload):
    try:
        value = count(payload["format"]["regulation"]["periods"])
        return value if value in (3, 5) else None
    except (KeyError, TypeError):
        return None


class Formats:
    """Share one public competition request per bout, including concurrent users."""
    def __init__(self, fetch, previous=None):
        self.fetch = fetch
        self.values = {str(key): value for key, value in (previous or {}).items()
                       if isinstance(value, dict) and value.get("scheduled_rounds") in (3, 5)
                       and value.get("source") == "ESPN explicit competition format"}
        self.pending = {}
        self.lock = threading.Lock()

    def get(self, event_id, bout_id, now):
        with self.lock:
            previous = self.values.get(bout_id)
            if previous and str(previous.get("event_id")) == event_id:
                return previous["scheduled_rounds"]
            creator = bout_id not in self.pending
            future = self.pending.setdefault(bout_id, concurrent.futures.Future())
        if creator:
            try:
                payload = self.fetch(COMPETITION_URL.format(event_id, bout_id))
                # Reject an unrelated competition response when its ID is supplied.
                value = explicit_rounds(payload) if isinstance(payload, dict) and str(payload.get("id", bout_id)) == bout_id else None
                if value is not None:
                    with self.lock:
                        self.values[bout_id] = {"event_id": event_id, "scheduled_rounds": value,
                                                "source": "ESPN explicit competition format", "fetched_at": now.isoformat()}
                future.set_result(value)
            except Exception:
                future.set_result(None)
        return future.result()


def history(fighter_id, name, events, formats, now):
    candidates = {}
    for key, event in events.items():
        if not isinstance(event, dict):
            continue
        match = UID.search(str(event.get("uid") or key))
        when = date(event.get("gameDate"))
        opponent = event.get("opponent") or {}
        outcome = event.get("gameResult")
        if not match or match[1] != "3321" or not when or when > now or outcome not in ("W", "L", "D", "NC") or not opponent.get("id"):
            continue
        event_id, bout_id = match[2], match[3]
        candidates[bout_id] = (when, event_id, event)
    result = []
    for bout_id, (when, event_id, event) in sorted(candidates.items(), key=lambda item: item[1][0], reverse=True)[:8]:
        opponent = event["opponent"]
        status = event.get("status") or {}
        method = status.get("result") or {}
        opponent_id = str(opponent["id"])
        result.append({"bout_id": bout_id, "event_id": event_id, "event_name": event.get("name"),
                       "event_date": when.isoformat(), "starts_at": when.isoformat(), "status": "final",
                       "fighter_a": fighter_id, "fighter_a_name": name,
                       "fighter_b": opponent_id, "fighter_b_name": opponent.get("displayName") or opponent.get("fullName"),
                       "winner": fighter_id if event["gameResult"] == "W" else opponent_id if event["gameResult"] == "L" else None,
                       "method": method.get("name"), "method_display": method.get("displayName"),
                       "end_round": count(status.get("period")), "end_clock": status.get("displayClock"),
                       "scheduled_rounds": formats.get(event_id, bout_id, now)})
    return result


def targets(schedule, fighter_data, now):
    output = {}
    events = schedule.get("events", []) if isinstance(schedule, dict) else []
    eligible = [event for event in events if isinstance(event, dict) and date(event.get("date"))
                and now - datetime.timedelta(days=1) <= date(event["date"]) <= now + datetime.timedelta(days=42)]
    for event in sorted(eligible, key=lambda item: date(item["date"])):
        competitions = event.get("competitions", [])
        if competitions and all((item.get("status") or {}).get("type", {}).get("completed") is True for item in competitions):
            continue
        for bout in competitions:
            for competitor in bout.get("competitors", []):
                athlete = competitor.get("athlete") or {}
                identifier = str(competitor.get("id") or athlete.get("id") or "")
                if identifier.isdigit():
                    output.setdefault(identifier, athlete.get("fullName") or athlete.get("displayName") or identifier)
    if not output:
        for profile in fighter_data.get("fighters", {}).values():
            if isinstance(profile, dict) and str(profile.get("id", "")).isdigit():
                output.setdefault(str(profile["id"]), profile.get("name") or str(profile["id"]))
    return output


def load_json(path):
    try:
        value = json.loads(path.read_text())
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def usable(profile):
    return isinstance(profile, dict) and (bool(profile.get("recent_fights")) or
            isinstance(profile.get("method_record"), dict) and "wins" in profile["method_record"] and "losses" in profile["method_record"])


def refresh(root=pathlib.Path("."), fetch=get_json, now=None):
    now = now or datetime.datetime.now(UTC)
    root = pathlib.Path(root)
    path = root / "ufc_history_data.json"
    previous = load_json(path)
    existing = previous.get("fighters", {})
    output = {str(key): value for key, value in existing.items() if usable(value) and str(value.get("id")) == str(key)}
    wanted = targets(load_json(root / "ufc_schedule.json"), load_json(root / "ufc_fighter_data.json"), now)
    formats = Formats(fetch, previous.get("formats", {}))

    def profile(item):
        fighter_id, fallback_name = item
        old = output.get(fighter_id, {})
        times = [date(old.get(key)) for key in ("method_record_fetched_at", "history_fetched_at")]
        if all(stamp and datetime.timedelta(0) <= now - stamp < datetime.timedelta(hours=24) for stamp in times):
            return fighter_id, old
        try:
            payload = fetch(ATHLETE_URL.format(fighter_id))
            athlete = payload.get("athlete") or {}
            if str(athlete.get("id")) != fighter_id:
                return fighter_id, old
            name = athlete.get("fullName") or athlete.get("displayName") or fallback_name
            result = dict(old, id=fighter_id, name=name)
            events = payload.get("eventsMap")
            if isinstance(events, dict):
                result.update(recent_fights=history(fighter_id, name, events, formats, now),
                              history_source=HISTORY_SOURCE, history_fetched_at=now.isoformat())
            try:
                record = records(fetch(RECORD_URL.format(fighter_id)), events or {}, now)
                if record is not None:
                    result.update(method_record=record, method_record_scope="overall_professional",
                                  method_record_source=RECORD_SOURCE, method_record_fetched_at=now.isoformat())
            except Exception:
                pass  # Preserve the prior method record and its original timestamp.
            return fighter_id, result
        except Exception:
            return fighter_id, old

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for fighter_id, value in pool.map(profile, wanted.items()):
            if usable(value):
                output[fighter_id] = value
    if not output:
        raise ValueError("No usable public histories or method records; preserving previous cache")
    payload = {"generated_at": now.isoformat(), "source": SOURCE, "fighters": output,
               "formats": formats.values,
               "coverage": {"profiles": len(output), "fighters_requested": len(wanted),
                            "profiles_with_history": sum(bool(value.get("recent_fights")) for value in output.values()),
                            "profiles_with_method_record": sum(bool(value.get("method_record")) for value in output.values())}}
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n")
    temporary.replace(path)
    return payload


if __name__ == "__main__":
    result = refresh()
    print("Public ESPN history profiles:", len(result["fighters"]))
