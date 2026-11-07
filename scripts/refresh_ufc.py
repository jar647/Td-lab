#!/usr/bin/env python3
"""Refresh public ESPN cards and optional authenticated FighterAPI career rates.

FIGHTERAPI_KEY stays in Actions secrets. A missing key never prevents the public
schedule refresh; it leaves research unavailable rather than inventing metrics.
"""
import datetime
import json
import math
import os
import pathlib
import time
import urllib.request

METRICS = {
    "slpm": ("sig_landed_per_15", 15), "sapm": ("sig_absorbed_per_15", 15),
    "strAcc": ("sig_accuracy", 1), "strDef": ("sig_defense", 1),
    "tdAvg": ("td_per_15", 1), "tdAcc": ("td_accuracy", 1),
    "tdDef": ("td_defense", 1), "subAvg": ("sub_attempts_per_15", 1),
}


def write_json(path, payload):
    """Replace only complete, valid payloads, preserving the last good file."""
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
    request = urllib.request.Request("https://mcp.fighterapi.com/v1/" + method, data=json.dumps(args).encode(), headers={"Content-Type": "application/json", "x-api-key": key}, method="POST")
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = json.load(response)
    if not isinstance(raw, dict) or not isinstance(raw.get("data"), dict):
        raise ValueError("Unexpected FighterAPI REST envelope")
    return raw["data"]


def stats(profile):
    rates = profile.get("career_rates") or {}
    result = {}
    for key, (source, divisor) in METRICS.items():
        value = rates.get(source)
        explicit_percent = isinstance(value, str) and value.strip().endswith("%")
        if isinstance(value, bool) or value is None:
            return None
        if isinstance(value, str):
            try:
                value = float(value.strip().rstrip("%"))
            except ValueError:
                return None
        if not isinstance(value, (int, float)) or not math.isfinite(value):
            return None
        value = float(value) / divisor
        if key in ("strAcc", "strDef", "tdAcc", "tdDef"):
            if 0 <= value <= 1 and not explicit_percent:
                value *= 100
            elif not 0 <= value <= 100:
                return None
        if not 0 <= value <= 1000:
            return None
        result[key] = round(value, 5)
    return result


def refresh_fighters(now, key):
    schedule = api("get_schedule", {"days": 42}, key)
    bouts = schedule.get("bouts")
    if not isinstance(bouts, list):
        raise ValueError("Unexpected schedule.bouts")
    fighters, seen = {}, set()
    for bout in bouts:
        if not isinstance(bout, dict):
            continue
        for side in ("a", "b"):
            fid, name = bout.get("fighter_" + side), bout.get("fighter_" + side + "_name")
            if not fid or not isinstance(name, str) or not name.strip() or str(fid) in seen:
                continue
            seen.add(str(fid))
            try:
                data = api("get_fighter", {"fighter_id": str(fid)}, key)
                extracted = stats(data)
                if extracted:
                    fighters[name.strip().casefold()] = {"id": str(fid), "name": name, "stats": extracted, "record": data.get("fighter", {}).get("pro_record"), "fetched_at": now.isoformat()}
                else:
                    print("Incomplete career rates:", name)
            except Exception as exc:
                # Never log request objects, response bodies, or credential values.
                print("Fighter refresh error:", name, type(exc).__name__)
            time.sleep(0.12)
    if not fighters:
        raise ValueError("No complete fighter profiles; preserving the previous cache")
    write_json("ufc_fighter_data.json", {"generated_at": now.isoformat(), "source": "FighterAPI authenticated REST get_schedule/get_fighter", "fighters": fighters, "scheduled_bouts": len(bouts), "coverage": {"profiles": len(fighters), "fighters_expected": len(seen), "complete": len(fighters) == len(seen)}})
    print("Refreshed fighter profiles:", len(fighters))


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
        except Exception as exc:
            print("Research refresh failed:", type(exc).__name__)
            failed = True
    else:
        print("FIGHTERAPI_KEY absent: public schedule refreshed; authenticated research skipped.")
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
