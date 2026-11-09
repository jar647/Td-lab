#!/usr/bin/env python3
"""Refresh ESPN cards and optional source-backed FighterAPI fighter research.

Credentials remain in Actions secrets. Cached rates are reused for seven days;
each profile keeps its original fetch time. Missing metrics remain null.
"""
import datetime
import json
import math
import os
import pathlib
import time
import urllib.error
import urllib.request

METRICS = {
    "slpm": ("sig_landed_per_15", 15), "sapm": ("sig_absorbed_per_15", 15),
    "strAcc": ("sig_accuracy", 1), "strDef": ("sig_defense", 1),
    "tdAvg": ("td_per_15", 1), "tdAcc": ("td_accuracy", 1),
    "tdDef": ("td_defense", 1), "subAvg": ("sub_attempts_per_15", 1),
}
PERCENTAGES = {"strAcc", "strDef", "tdAcc", "tdDef"}
RECORD_FIELDS = ("wins", "losses", "draws", "no_contests", "wins_ko", "wins_sub", "wins_dec", "losses_ko", "losses_sub", "losses_dec")
BOUT_FIELDS = ("bout_id", "event_id", "event_name", "event_date", "starts_at", "weight_class", "card_segment", "match_number", "title_fight", "scheduled_rounds", "status", "fighter_a", "fighter_a_name", "fighter_b", "fighter_b_name", "winner", "method", "method_display", "end_round", "end_clock")
SOURCE = "FighterAPI authenticated REST get_schedule/get_fighter"
_api_last_call = None
_api_remaining = None


class APIError(Exception):
    """Safe diagnostic: never retain response bodies or request credentials."""
    def __init__(self, status):
        self.status = int(status)
        super().__init__(f"HTTP {self.status}")


def write_json(path, payload):
    target = pathlib.Path(path)
    temporary = target.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n")
    temporary.replace(target)


def refresh_schedule(now):
    start = (now - datetime.timedelta(days=7)).strftime("%Y%m%d")
    end = (now + datetime.timedelta(days=42)).strftime("%Y%m%d")
    url = f"https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard?dates={start}-{end}&limit=100"
    request = urllib.request.Request(url, headers={"User-Agent": "ThePropShop/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        data = json.load(response)
    events = data.get("events")
    if not isinstance(events, list) or not events or not all(isinstance(e, dict) and e.get("id") and e.get("date") and isinstance(e.get("competitions"), list) for e in events):
        raise ValueError("No valid public cards; preserving the previous schedule")
    write_json("ufc_schedule.json", {"generated_at": now.isoformat(), "source": "ESPN UFC scoreboard", "events": events})
    print("Public UFC cards:", len(events))


def api(method, args, key):
    """Respect credit-sensitive rate limits and retry throttling twice at most."""
    global _api_last_call, _api_remaining
    cost = 2 if method == "get_schedule" else 5
    if _api_remaining is not None and _api_remaining < cost:
        raise APIError(402)
    for attempt in range(3):
        interval = 6.1 if _api_remaining is not None and _api_remaining < 100 else 1.05
        if _api_last_call is not None:
            time.sleep(max(0, interval - (time.monotonic() - _api_last_call)))
        request = urllib.request.Request("https://mcp.fighterapi.com/v1/" + method, data=json.dumps(args).encode(), headers={"Content-Type": "application/json", "x-api-key": key}, method="POST")
        _api_last_call = time.monotonic()
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                remaining = response.headers.get("X-Credits-Remaining")
                if remaining is not None:
                    try:
                        _api_remaining = max(0, float(remaining))
                    except (TypeError, ValueError):
                        pass
                raw = json.load(response)
        except urllib.error.HTTPError as exc:
            status = exc.code
            if status != 429 or attempt == 2:
                raise APIError(status) from None
            try:
                delay = min(60, max(6.1, float(exc.headers.get("Retry-After", "6.1"))))
            except (TypeError, ValueError):
                delay = 6.1
            time.sleep(delay)
            continue
        if not isinstance(raw, dict) or not isinstance(raw.get("data"), dict):
            raise ValueError("Unexpected FighterAPI REST envelope")
        return raw["data"]
    raise APIError(429)


def number(value):
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        return None
    if isinstance(value, str):
        if not value.strip():
            return None
        try:
            value = float(value.strip().rstrip("%"))
        except ValueError:
            return None
    return float(value) if math.isfinite(value) else None


def stats(profile):
    """Keep valid available rates even when the other metrics are unpublished."""
    rates = profile.get("career_rates") if isinstance(profile, dict) else None
    rates = rates if isinstance(rates, dict) else {}
    result = {}
    for key, (source, divisor) in METRICS.items():
        raw = rates.get(source)
        value = number(raw)
        if value is not None:
            value /= divisor
            if key in PERCENTAGES and 0 <= value <= 1 and not (isinstance(raw, str) and raw.strip().endswith("%")):
                value *= 100
            if value < 0 or value > (100 if key in PERCENTAGES else 1000):
                value = None
        result[key] = round(value, 5) if value is not None else None
    return result


def valid_stats(values):
    return isinstance(values, dict) and all(type(values.get(k)) in (int, float) and math.isfinite(values[k]) and 0 <= values[k] <= (100 if k in PERCENTAGES else 1000) for k in METRICS)


def age_days(profile, now):
    try:
        fetched = datetime.datetime.fromisoformat(profile.get("fetched_at", "").replace("Z", "+00:00"))
        if fetched.tzinfo is None:
            return math.inf
        age = (now - fetched).total_seconds() / 86400
        return age if age >= 0 else math.inf
    except (AttributeError, TypeError, ValueError):
        return math.inf


def profile_data(data, fid, name, now):
    fighter = data.get("fighter") if isinstance(data.get("fighter"), dict) else {}
    rates = data.get("career_rates") if isinstance(data.get("career_rates"), dict) else {}
    profile = {"id": str(fid), "name": name, "stats": stats(data), "fetched_at": now.isoformat()}
    for field, source, unit in (("height", "height_in", "in"), ("reach", "reach_in", "in"), ("weight", "weight_lbs", "lb")):
        value = number(fighter.get(source))
        if value is not None and value > 0:
            profile[source] = value
            profile[field] = f"{value:g} {unit}"
    for target, source in (("record", "pro_record"), ("stance", "stance"), ("date_of_birth", "date_of_birth"), ("gym", "gym")):
        value = fighter.get(source)
        if isinstance(value, str) and value.strip():
            profile[target] = value.strip()
    record = data.get("ufc_record") or data.get("record")
    if isinstance(record, dict):
        profile["ufc_record"] = {k: int(record[k]) for k in RECORD_FIELDS if type(record.get(k)) in (int, float) and math.isfinite(record[k]) and record[k] >= 0 and record[k] == int(record[k])}
    minutes = number(rates.get("minutes_fought"))
    if minutes is not None and minutes >= 0:
        profile["minutes_fought"] = minutes
    recent = data.get("recent_fights")
    if isinstance(recent, list):
        # Keep identities and source outcomes; do not label unknown outcomes as losses.
        recent = [b for b in recent if isinstance(b, dict) and str(fid) in (str(b.get("fighter_a")), str(b.get("fighter_b"))) and b.get("status") == "final"]
        recent.sort(key=lambda b: str(b.get("starts_at") or b.get("event_date") or ""), reverse=True)
        profile["recent_fights"] = [{k: b[k] for k in BOUT_FIELDS if k in b and (b[k] is None or type(b[k]) in (str, int, float, bool))} for b in recent[:5]]
    return profile


def refresh_fighters(now, key):
    target = pathlib.Path("ufc_fighter_data.json")
    try:
        old_data = json.loads(target.read_text())
        old = old_data.get("fighters", {})
        old = old if isinstance(old, dict) else {}
    except (OSError, ValueError, AttributeError):
        old = {}
    schedule = api("get_schedule", {"days": 42}, key)
    bouts = schedule.get("bouts")
    if not isinstance(bouts, list) or not bouts:
        raise ValueError("No scheduled bouts; preserving the previous cache")
    candidates = {}
    for bout in bouts:
        if not isinstance(bout, dict):
            raise ValueError("Malformed scheduled bout; preserving the previous cache")
        identities = []
        for side in ("a", "b"):
            fid, name = bout.get("fighter_" + side), bout.get("fighter_" + side + "_name")
            if not fid or not isinstance(name, str) or not name.strip():
                raise ValueError("Incomplete scheduled bout identities; preserving the previous cache")
            identities.append((str(fid), name.strip()))
        if identities[0][0] == identities[1][0]:
            raise ValueError("Duplicate fighter IDs within scheduled bout; preserving the previous cache")
        for fid, name in identities:
            candidates.setdefault(fid, name)
    if not candidates:
        raise ValueError("No scheduled fighter identities; preserving the previous cache")
    # The published cache is keyed by normalized name. Two distinct source IDs
    # with the same name would overwrite one another without warning.
    lookup_keys = [name.casefold() for name in candidates.values()]
    if len(set(lookup_keys)) != len(lookup_keys):
        raise ValueError("Ambiguous scheduled fighter names; preserving the previous cache")
    old_by_id = {str(p.get("id")): p for p in old.values() if isinstance(p, dict) and p.get("id")}
    fighters, pending = {}, []
    for fid, name in candidates.items():
        previous = old_by_id.get(fid)
        age = age_days(previous, now) if previous else math.inf
        if previous and age <= 30 and isinstance(previous.get("stats"), dict):
            # Nulls are retained, with the actual previous source fetch time.
            fighters[name.casefold()] = {**previous, "name": name}
        checked_age = age_days({"fetched_at": previous.get("checked_at")}, now) if previous else math.inf
        if previous and age <= 30 and (age <= (7 if valid_stats(previous.get("stats")) else 1) or checked_age <= (7 if valid_stats(previous.get("stats")) else 1)):
            continue
        pending.append((fid, name, previous))
    # Missing profiles first, then incomplete profiles; retain source schedule order within groups.
    pending.sort(key=lambda x: (x[2] is not None, valid_stats((x[2] or {}).get("stats"))))
    fetched, blocked = 0, None
    for fid, name, previous in pending:
        try:
            data = api("get_fighter", {"fighter_id": fid}, key)
            updated = profile_data(data, fid, name, now)
            if previous and age_days(previous, now) <= 30 and valid_stats(previous.get("stats")) and not valid_stats(updated["stats"]):
                # Preserve known-good rates and their actual source time when a
                # provider temporarily omits a rate. New descriptive fields may
                # still be retained; checked_at only controls retry cadence.
                updated = {**previous, **updated, "stats": previous["stats"],
                           "fetched_at": previous["fetched_at"], "checked_at": now.isoformat()}
            if not valid_stats(updated["stats"]):
                updated["checked_at"] = now.isoformat()
            fighters[name.casefold()] = updated
            fetched += 1
        except APIError as exc:
            print("Fighter refresh error:", name, f"HTTP {exc.status}")
            # Keep recent verified data after transient errors, without
            # changing its original fetch timestamp or fighter identity.
            if previous and age_days(previous, now) <= 30 and isinstance(previous.get("stats"), dict):
                fighters[name.casefold()] = {**previous, "name": name}
            # Any provider HTTP failure makes this refresh incomplete. Never publish
            # a partial card snapshot, including transient 5xx outages.
            blocked = exc.status
            break
        except Exception as exc:
            # Unexpected transport, decoding, or provider-envelope errors are
            # incomplete refreshes too. Never publish a mixed/partial snapshot.
            print("Fighter refresh error:", name, type(exc).__name__)
            raise RuntimeError("Fighter research refresh incomplete") from exc
    # Report the original provider failure before coverage checks. This keeps
    # authentication and rate-limit errors actionable without publishing data.
    if blocked is not None:
        raise APIError(blocked)
    if not fighters:
        raise ValueError("No source-backed fighter profiles; preserving the previous cache")
    # A previously verified profile may have expired while its source request fails.
    # Never publish a card that silently omits a scheduled fighter.
    if len(fighters) != len(candidates):
        raise ValueError("Incomplete scheduled fighter coverage; preserving the previous cache")
    payload = {"generated_at": now.isoformat(), "source": SOURCE, "fighters": fighters,
               "scheduled_bouts": len(bouts),
               "bouts": [{k: b[k] for k in BOUT_FIELDS if k in b and (b[k] is None or type(b[k]) in (str, int, float, bool))} for b in bouts if isinstance(b, dict)],
               "coverage": {"profiles": len(fighters), "complete_profiles": sum(valid_stats(p.get("stats")) for p in fighters.values()), "fighters_expected": len(candidates)}}
    payload["coverage"]["complete"] = payload["coverage"]["complete_profiles"] == len(candidates)
    write_json(target, payload)
    print("Fighter profiles:", len(fighters), "complete:", payload["coverage"]["complete_profiles"], "fetched:", fetched)
    return payload


def main():
    now = datetime.datetime.now(datetime.timezone.utc)
    failed = False
    try:
        refresh_schedule(now)
    except Exception as exc:
        print("Schedule refresh failed:", type(exc).__name__)
        failed = True
    key = os.getenv("FIGHTERAPI_KEY", "").strip()
    if key:
        try:
            refresh_fighters(now, key)
        except APIError as exc:
            print("Research refresh failed:", f"HTTP {exc.status}")
            failed = True
        except Exception as exc:
            print("Research refresh failed:", type(exc).__name__)
            failed = True
    else:
        print("FIGHTERAPI_KEY absent: authenticated research skipped.")
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
