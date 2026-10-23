"""Compare supported ESPN totals against the primary defensive audit, without false verification."""
import argparse
import json
from pathlib import Path

SUPPORTED = {
    "QB": ("pass_yards_total", "pass_attempts_total"),
    "RB": ("rush_yards_total", "rush_attempts_total", "rec_yards_total", "receptions_total"),
    "WR": ("rush_yards_total", "rush_attempts_total", "rec_yards_total", "receptions_total"),
    "TE": ("rush_yards_total", "rush_attempts_total", "rec_yards_total", "receptions_total"),
}

def compare(primary, espn):
    problems = []
    if primary.get("season") != espn.get("season"):
        problems.append("Season mismatch")
    weeks = espn.get("weeks", [])
    if not isinstance(weeks, list) or len(weeks) != primary.get("lookback_weeks") or max(weeks, default=-1) != primary.get("week") - 1:
        problems.append("Week window mismatch")
    a = {(r["defense"], r["position"]): r for r in primary.get("rows", [])}
    b = {(r["defense"], r["position"]): r for r in espn.get("rows", [])}
    if len(a) != len(primary.get("rows", [])) or len(b) != len(espn.get("rows", [])):
        problems.append("Duplicate defense-position rows")
    if set(a) != set(b) or len(a) != 128:
        problems.append("Incomplete 32-team positional coverage")
    checked = 0
    for key in sorted(set(a) & set(b)):
        if a[key].get("games") != b[key].get("games"):
            problems.append(f"{key}: game count differs")
        for metric in SUPPORTED[key[1]]:
            x, y = a[key].get(metric), b[key].get(metric, 0)
            if not isinstance(x, (int, float)) or not isinstance(y, (int, float)) or isinstance(x, bool) or isinstance(y, bool):
                problems.append(f"{key}: missing {metric}")
            elif x != y:
                problems.append(f"{key}: {metric} {x} vs ESPN {y}")
            checked += 1
    return {"source": "ESPN NFL game summary (unofficial)",
            "status": "PARTIAL_MATCH" if not problems else "BLOCKED",
            "independent_external_source_verified": False,
            "supported_metrics_checked": checked,
            "unsupported_metrics": ["targets_total", "redzone_targets_total"],
            "discrepancies": problems[:300], "discrepancy_count": len(problems),
            "season": primary.get("season"), "week": primary.get("week"),
            "lookback_weeks": primary.get("lookback_weeks")}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--primary", type=Path, default=Path("data/defense_stats_audit.json"))
    parser.add_argument("--espn", type=Path, default=Path("data/espn_partial_defense_audit.json"))
    parser.add_argument("--output", type=Path, default=Path("data/espn_comparison.json"))
    args = parser.parse_args()
    result = compare(json.loads(args.primary.read_text()), json.loads(args.espn.read_text()))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({k: v for k, v in result.items() if k != "discrepancies"}))
    if result["status"] != "PARTIAL_MATCH":
        raise SystemExit("ESPN comparison blocked; see discrepancies")

if __name__ == "__main__":
    main()
