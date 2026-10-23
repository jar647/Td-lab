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
    train, test = extract(weeks[:-4]), extract(weeks[-4:])
    if len(train) < 500 or len(test) < 200:
        raise ValueError("Insufficient player observations")
    estimates = fit(train)
    base = sum(y for _, y in train) / len(train)
    model = sum((estimates[b]-y)**2 for b,y in test)/len(test)
    naive = sum((base-y)**2 for _,y in test)/len(test)
    return dict(status="research_only", bet_ready=False, train_weeks=len(weeks)-4,
                test_weeks=4, train_players=len(train), test_players=len(test),
                model_brier=round(model,6), baseline_brier=round(naive,6),
                beats_baseline=model<naive,
                warning="Retrospective results may contain hindsight and do not establish live betting value.")

if __name__ == "__main__":
    result = evaluate(json.loads(source.read_text()))
    target.write_text(json.dumps(result, indent=2)+"\n")
    print(json.dumps(result, indent=2))
