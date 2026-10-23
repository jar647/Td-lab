"""Chronological retrospective evaluation. Never authorizes live betting."""
import json
from pathlib import Path
from scripts.calibrate_td import fit, score_to_bucket

source = Path("data/retrospective/weekly.json")
target = Path("data/retrospective/evaluation.json")

def evaluate(doc):
    weeks = sorted(doc["weeks"], key=lambda w: (w["season"], w["week"]))
    if len(weeks) < 12:
        raise ValueError("Insufficient historical weeks")
    def extract(items):
        return [(score_to_bucket(p["score"]), int(p["scored_td"])) for w in items for p in w["players"] if isinstance(p.get("scored_td"), bool)]
    seasons = sorted({int(w["season"]) for w in weeks})
    if len(seasons) < 2:
        raise ValueError("Require at least two seasons for season-separated holdout")
    held_out_season = seasons[-1]
    training_weeks = [w for w in weeks if int(w["season"]) < held_out_season]
    testing_weeks = [w for w in weeks if int(w["season"]) == held_out_season]
    if len(training_weeks) < 8 or len(testing_weeks) < 8:
        raise ValueError("Require at least 8 training and 8 held-out weeks")
    train, test = extract(training_weeks), extract(testing_weeks)
    if len(train) < 500 or len(test) < 200:
        raise ValueError("Insufficient player observations")
    estimates = fit(train)
    base = sum(y for _, y in train) / len(train)
    model = sum((estimates[b]-y)**2 for b,y in test)/len(test)
    naive = sum((base-y)**2 for _,y in test)/len(test)
    # Break down held-out accuracy by position and score bucket to reveal
    # whether apparent improvement is concentrated in one subgroup.
    by_position = {}
    for pos in ("RB", "WR", "TE", "QB"):
        subset = [(score_to_bucket(p["score"]), int(p["scored_td"]))
                  for w in testing_weeks for p in w["players"]
                  if p.get("pos") == pos and isinstance(p.get("scored_td"), bool)]
        if not subset:
            continue
        pos_model = sum((estimates[b] - y) ** 2 for b, y in subset) / len(subset)
        pos_base = sum((base - y) ** 2 for _, y in subset) / len(subset)
        by_position[pos] = {"players": len(subset),
                            "observed_td_rate": round(sum(y for _, y in subset) / len(subset), 5),
                            "model_brier": round(pos_model, 6),
                            "baseline_brier": round(pos_base, 6),
                            "beats_baseline": pos_model < pos_base}
    by_bucket = []
    for bucket in range(10):
        subset = [y for b, y in test if b == bucket]
        by_bucket.append({"bucket": bucket, "count": len(subset),
                          "estimated_td_rate": round(estimates[bucket], 5),
                          "observed_td_rate": round(sum(subset) / len(subset), 5) if subset else None})
    return dict(by_position=by_position, by_score_bucket=by_bucket, status="research_only", bet_ready=False, train_weeks=len(training_weeks),
                test_weeks=len(testing_weeks), train_seasons=sorted({int(w["season"]) for w in training_weeks}),
                holdout_season=held_out_season, train_players=len(train), test_players=len(test),
                model_brier=round(model,6), baseline_brier=round(naive,6),
                beats_baseline=model<naive,
                warning="Retrospective results may contain hindsight and do not establish live betting value.")

if __name__ == "__main__":
    result = evaluate(json.loads(source.read_text()))
    target.write_text(json.dumps(result, indent=2)+"\n")
    print(json.dumps(result, indent=2))
