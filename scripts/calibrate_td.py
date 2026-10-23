"""Fit a strictly out-of-sample touchdown probability calibration from graded snapshots.

Never interpret the TD LAB ranking score as a probability. Training requires
multiple eligible weeks and a later held-out week. Output stays unavailable
when there is insufficient trustworthy evidence.
"""
import json
import math
from pathlib import Path

HISTORY = Path("data/history")
DEST = Path("data/probability_model.json")
MIN_TRAIN_WEEKS = 4
MIN_TEST_WEEKS = 2
MIN_TRAIN_PLAYERS = 250
MIN_TEST_PLAYERS = 100

def score_to_bucket(score):
    return min(9, max(0, int(float(score) // 10)))

def load_weeks():
    weeks = []
    for path in sorted(HISTORY.glob("*-results.json")):
        obj = json.loads(path.read_text())
        if not obj.get("accuracy_eligible") or not obj.get("pregame_snapshot"):
            continue
        rows = []
        for p in obj.get("players", []):
            if isinstance(p.get("score"), (int, float)) and isinstance(p.get("scored_td"), bool):
                rows.append((score_to_bucket(p["score"]), int(p["scored_td"])))
        if rows:
            weeks.append((int(obj["season"]), int(obj["week"]), rows))
    return sorted(weeks)

def fit(rows):
    # Beta(2, 6) shrinkage is a conservative prior, not a claim of accuracy.
    overall = (2 + sum(y for _, y in rows)) / (8 + len(rows))
    bins = []
    for bucket in range(10):
        ys = [y for b, y in rows if b == bucket]
        bins.append((20 * overall + sum(ys)) / (20 + len(ys)))
    # Pool-adjacent-violators ensures higher rank scores never imply lower TD rates.
    groups = [{"start": i, "end": i, "sum": bins[i], "weight": 1} for i in range(10)]
    i = 0
    while i < len(groups)-1:
        if groups[i]["sum"]/groups[i]["weight"] > groups[i+1]["sum"]/groups[i+1]["weight"]:
            groups[i]["end"] = groups[i+1]["end"]
            groups[i]["sum"] += groups[i+1]["sum"]
            groups[i]["weight"] += groups[i+1]["weight"]
            groups.pop(i+1)
            i = max(0, i-1)
        else:
            i += 1
    values = [0.0]*10
    for g in groups:
        for j in range(g["start"], g["end"]+1):
            values[j] = g["sum"]/g["weight"]
    return values

def main():
    weeks = load_weeks()
    output = {"status": "unavailable", "method": "isotonic smoothed 10-point rank buckets", "source": "eligible frozen pregame snapshots with completed graded results", "train_weeks": 0, "test_weeks": 0, "reason": "Insufficient eligible, independent training and holdout weeks. No probabilities or betting edges published."}
    if len(weeks) >= MIN_TRAIN_WEEKS + MIN_TEST_WEEKS:
        train, test = weeks[:-MIN_TEST_WEEKS], weeks[-MIN_TEST_WEEKS:]
        training = [p for _,_,rows in train for p in rows]
        testing = [p for _,_,rows in test for p in rows]
        if len(training) >= MIN_TRAIN_PLAYERS and len(testing) >= MIN_TEST_PLAYERS:
            values = fit(training)
            brier = sum((values[b]-y)**2 for b,y in testing)/len(testing)
            baseline = sum(y for _,y in training)/len(training)
            baseline_brier = sum((baseline-y)**2 for _,y in testing)/len(testing)
            output.update({"status": "validated" if brier < baseline_brier else "unavailable", "train_weeks":len(train), "test_weeks":len(test), "train_players":len(training), "test_players":len(testing), "holdout_brier":round(brier,5), "holdout_baseline_brier":round(baseline_brier,5), "probability_by_score_decile": [round(v,5) for v in values] if brier < baseline_brier else None, "reason": "Passed held-out Brier comparison; still no guarantee of profitability." if brier < baseline_brier else "Did not outperform constant-rate baseline on held-out weeks."})
    DEST.parent.mkdir(parents=True, exist_ok=True)
    DEST.write_text(json.dumps(output, indent=2)+"\n")
    print("TD probability model:", output["status"], "|", output["reason"])

if __name__ == "__main__":
    main()
