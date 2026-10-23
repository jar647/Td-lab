"""Audit eligible touchdown calibration history without rewriting pregame snapshots.

Run with: python scripts/audit_history.py
This report is diagnostic only; it does not backfill predictions or create
betting probabilities from information that was unavailable before kickoff.
"""
import json
from pathlib import Path

HISTORY = Path("data/history")
DEST = Path("data/history_audit.json")

def audit(folder=HISTORY):
    snapshots = {}
    results = {}
    errors = []
    for path in sorted(folder.glob("*.json")):
        try:
            obj = json.loads(path.read_text())
            if not isinstance(obj, dict) or "season" not in obj or "week" not in obj:
                continue
            key = f'{int(obj["season"])}-week-{int(obj["week"])}'
            if path.name.endswith("-results.json"):
                results[key] = obj
            elif "players" in obj:
                snapshots[key] = obj
        except (OSError, ValueError, TypeError, KeyError) as exc:
            errors.append({"file": path.name, "error": str(exc)})
    entries = []
    for key in sorted(set(snapshots) | set(results)):
        snapshot = snapshots.get(key)
        result = results.get(key)
        entries.append({
            "week": key,
            "snapshot_present": snapshot is not None,
            "snapshot_captured_at": snapshot.get("captured_at") if snapshot else None,
            "snapshot_candidates": len(snapshot.get("players", [])) if snapshot else 0,
            "results_present": result is not None,
            "graded_players": len(result.get("players", [])) if result else 0,
            "eligible_for_accuracy": bool(snapshot and result and result.get("accuracy_eligible") and result.get("pregame_snapshot")),
            "warning": "Historical results without a verified pregame snapshot cannot be used as prospective accuracy evidence." if result and not snapshot else None
        })
    return {
        "snapshot_weeks": len(snapshots),
        "graded_weeks": len(results),
        "eligible_graded_weeks": sum(e["eligible_for_accuracy"] for e in entries),
        "weeks": entries,
        "errors": errors,
        "policy": "No reconstructed or post-kickoff predictions may be relabeled as frozen pregame predictions."
    }

def main():
    output = audit()
    DEST.parent.mkdir(parents=True, exist_ok=True)
    DEST.write_text(json.dumps(output, indent=2) + "\n")
    print(json.dumps({k: output[k] for k in ("snapshot_weeks", "graded_weeks", "eligible_graded_weeks", "errors")}))
    if output["errors"]:
        raise SystemExit("Historical files could not be audited")

if __name__ == "__main__":
    main()
