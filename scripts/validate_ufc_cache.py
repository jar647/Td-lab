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
    generated = data.get("generated_at")
    generated_at = datetime.datetime.fromisoformat(generated.replace("Z", "+00:00")) if isinstance(generated, str) else None
    if generated_at is not None:
        assert generated_at.tzinfo is not None, "Cache timestamp must include time zone"
    complete = 0
    profile_ids = set()
    for name, profile in fighters.items():
        assert isinstance(name, str) and name.strip() and name == name.strip().casefold(), "Invalid lookup key"
        assert isinstance(profile, dict) and isinstance(profile.get("stats"), dict), "Missing fighter stats"
        fid = profile.get("id")
        assert fid is not None and isinstance(fid, (str, int)) and not isinstance(fid, bool) and str(fid).strip(), "Missing profile fighter ID"
        fid = str(fid).strip()
        assert fid not in profile_ids, "Duplicate profile fighter ID"
        profile_ids.add(fid)
        assert isinstance(profile.get("name"), str) and profile["name"].strip().casefold() == name, "Profile name and lookup key mismatch"
        available = 0
        for key in REQUIRED:
            value = profile["stats"].get(key)
            if value is None:
                continue
            assert type(value) in (int, float) and math.isfinite(value) and 0 <= value <= (100 if key in PERCENTAGES else 1000), f"Invalid {key} for {name}"
            available += 1
        complete += available == len(REQUIRED)
        timestamps = {}
        for field in ("fetched_at", "checked_at"):
            if field in profile:
                value = profile[field]
                assert isinstance(value, str), f"Invalid {field} for {name}"
                parsed = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
                assert parsed.tzinfo is not None, f"{field} must include time zone"
                if generated_at is not None:
                    assert parsed <= generated_at, f"{field} is later than cache generation for {name}"
                timestamps[field] = parsed
        if "checked_at" in timestamps and "fetched_at" in timestamps:
            assert timestamps["checked_at"] >= timestamps["fetched_at"], f"Check predates source fetch for {name}"
    coverage = data.get("coverage", {})
    if coverage:
        assert coverage.get("profiles") == len(fighters), "Coverage count mismatch"
        expected = coverage.get("fighters_expected")
        assert type(expected) is int and expected >= len(fighters), "Expected count smaller than profiles"
        assert coverage.get("complete_profiles", complete) == complete, "Complete profile count mismatch"
        assert coverage.get("complete") == (complete == expected), "Incorrect completeness flag"
    bouts = data.get("bouts", [])
    assert isinstance(bouts, list), "Invalid scheduled bout collection"
    expected_ids = {}
    normalized_names = {}
    seen_bout_ids = set()
    for bout in bouts:
        assert isinstance(bout, dict) and "lines" not in bout, "Invalid public bout metadata"
        bout_id = bout.get("bout_id")
        assert isinstance(bout_id, (str, int)) and not isinstance(bout_id, bool) and str(bout_id).strip(), "Missing scheduled bout ID"
        bout_id = str(bout_id).strip()
        assert bout_id not in seen_bout_ids, "Duplicate scheduled bout ID"
        seen_bout_ids.add(bout_id)
        identities = []
        for side in ("a", "b"):
            fid = bout.get("fighter_" + side)
            name = bout.get("fighter_" + side + "_name")
            assert isinstance(fid, (str, int)) and not isinstance(fid, bool) and str(fid).strip(), "Missing scheduled fighter ID"
            assert isinstance(name, str) and name.strip(), "Missing scheduled fighter name"
            fid, name = str(fid).strip(), name.strip()
            key = name.casefold()
            assert fid not in expected_ids or expected_ids[fid] == key, "Conflicting source fighter identity"
            assert key not in normalized_names or normalized_names[key] == fid, "Ambiguous scheduled fighter name"
            expected_ids[fid] = key
            normalized_names[key] = fid
            identities.append(fid)
        assert identities[0] != identities[1], "Duplicate fighter IDs in bout"
    if bouts:
        assert data.get("scheduled_bouts") == len(bouts), "Scheduled bout count mismatch"
        assert len(fighters) == len(expected_ids), "Scheduled fighter coverage mismatch"
        for fid, key in expected_ids.items():
            assert key in fighters and str(fighters[key].get("id")).strip() == fid, "Scheduled fighter profile missing or mismatched"
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
