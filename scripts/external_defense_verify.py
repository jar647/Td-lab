"""Independent-source defensive audit gate. Never treat same-source reconciliation as external verification."""
from __future__ import annotations
import json
import math
from pathlib import Path

METRICS = ("pass_yards", "pass_attempts", "rush_yards", "rush_attempts",
           "rec_yards", "targets", "receptions", "redzone_targets")
POSITIONS = ("QB", "RB", "WR", "TE")

def verify(primary, external, *, source_name, tolerance=0):
    """Compare matching raw totals, not rounded per-game averages.

    external must be a separately obtained, independently sourced record set.
    The caller is responsible for verifying its provenance, season, week range,
    play inclusion rules, and position classifications.
    """
    if not source_name or source_name.lower() in ("nflverse", "internal", "same_source"):
        raise ValueError("Independent source identity required")
    if tolerance < 0:
        raise ValueError("Invalid tolerance")
    def index(records):
        result = {}
        for row in records:
            key = (row["defense"], row["position"])
            if key in result:
                raise ValueError(f"Duplicate defensive record: {key}")
            result[key] = row
        return result
    a, b = index(primary), index(external)
    issues = []
    expected = {(team, pos) for team in {k[0] for k in a} for pos in POSITIONS}
    if len({k[0] for k in a}) != 32 or set(a) != expected:
        issues.append("Primary source lacks complete 32-team positional coverage")
    if set(a) != set(b):
        issues.append(f"Record coverage mismatch: missing={sorted(set(a)-set(b))}, extra={sorted(set(b)-set(a))}")
    for key in sorted(set(a) & set(b)):
        if a[key].get("games") != b[key].get("games"):
            issues.append(f"{key}: games mismatch")
        for metric in (("pass_yards", "pass_attempts") if key[1] == "QB" else ("rush_yards", "rush_attempts", "rec_yards", "targets", "receptions", "redzone_targets")):
            metric += "_total"
            x, y = a[key].get(metric), b[key].get(metric)
            if isinstance(x, bool) or isinstance(y, bool) or not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
                issues.append(f"{key}: {metric} missing or nonnumeric")
            elif not math.isfinite(x) or not math.isfinite(y):
                issues.append(f"{key}: {metric} nonfinite")
            elif abs(x-y) > tolerance:
                issues.append(f"{key}: {metric} mismatch ({x} vs {y})")
    return {"independent_external_source_verified": not issues,
            "verification_source": source_name, "discrepancies": issues,
            "status": "VERIFIED" if not issues else "BLOCKED"}

def verify_files(primary_path, external_path, output_path, source_name):
    primary = json.loads(Path(primary_path).read_text())
    external = json.loads(Path(external_path).read_text())
    result = verify(primary, external, source_name=source_name)
    Path(output_path).write_text(json.dumps(result, indent=2) + "\n")
    if result["status"] != "VERIFIED":
        raise SystemExit("Independent defensive verification failed closed")
    return result
