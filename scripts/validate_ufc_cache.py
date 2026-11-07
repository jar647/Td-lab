#!/usr/bin/env python3
"""Validate public UFC cache without exposing credentials."""
import datetime
import json
import math
import pathlib

REQUIRED = ("slpm", "sapm", "strAcc", "strDef", "tdAvg", "tdAcc", "tdDef", "subAvg")
PERCENTAGES = {"strAcc", "strDef", "tdAcc", "tdDef"}


def validate(data):
    fighters = data.get("fighters")
    assert isinstance(fighters, dict) and fighters, "Cache must contain fighter profiles"
    complete = 0
    for name, profile in fighters.items():
        assert isinstance(name, str) and name.strip() and name == name.strip().casefold(), "Invalid lookup key"
        assert isinstance(profile, dict) and isinstance(profile.get("stats"), dict), "Missing fighter stats"
        available = 0
        for key in REQUIRED:
            value = profile["stats"].get(key)
            if value is None:
                continue
            assert type(value) in (int, float) and math.isfinite(value) and 0 <= value <= (100 if key in PERCENTAGES else 1000), f"Invalid {key} for {name}"
            available += 1
        complete += available == len(REQUIRED)
        if "fetched_at" in profile:
            fetched = datetime.datetime.fromisoformat(profile["fetched_at"].replace("Z", "+00:00"))
            assert fetched.tzinfo is not None, "Profile timestamp must include time zone"
    coverage = data.get("coverage", {})
    if coverage:
        assert coverage.get("profiles") == len(fighters), "Coverage count mismatch"
        expected = coverage.get("fighters_expected")
        assert type(expected) is int and expected >= len(fighters), "Expected count smaller than profiles"
        assert coverage.get("complete_profiles", complete) == complete, "Complete profile count mismatch"
        assert coverage.get("complete") == (complete == expected), "Incorrect completeness flag"
    for bout in data.get("bouts", []):
        assert isinstance(bout, dict) and "lines" not in bout, "Invalid public bout metadata"
    return len(fighters), complete


def main():
    path = pathlib.Path("ufc_fighter_data.json")
    if not path.exists():
        print("UFC cache unavailable: authenticated refresh not configured.")
        return
    count, complete = validate(json.loads(path.read_text()))
    print(f"UFC cache validated: {count} profiles, {complete} complete")


if __name__ == "__main__":
    main()
