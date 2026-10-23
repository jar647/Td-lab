"""Machine-readable verification gates. Never equate a matchup rank with a betting edge."""
import datetime as dt
import json
from pathlib import Path

ROOT = Path("data")
def report(now=None, root=ROOT):
    now = now or dt.datetime.now(dt.timezone.utc)
    def read(name, default):
        path = root / name
        return json.loads(path.read_text()) if path.exists() else default
    model = read("probability_model.json", {})
    audit = read("history_audit.json", {})
    odds = read("hardrock_anytime_td.json", {})
    external = read("external_defense_verification.json", {})
    defense_audit = read("defense_stats_audit.json", {})
    try:
        stamp = dt.datetime.fromisoformat(odds["retrieved_at_utc"].replace("Z","+00:00"))
        fresh = stamp.tzinfo is not None and 0 <= (now-stamp).total_seconds() <= 900
    except (KeyError, ValueError, TypeError):
        fresh = False
    calibrated = (model.get("status") == "validated" and model.get("train_weeks",0)>=4
        and model.get("test_weeks",0)>=2 and model.get("train_players",0)>=250
        and model.get("test_players",0)>=100
        and model.get("holdout_brier",1)<model.get("holdout_baseline_brier",0))
    # Weekly roster status and injury reports are NOT game-day inactive confirmations.
    gates = {
        "model_calibrated": bool(calibrated),
        "independent_defensive_stats_verified": bool(external.get("status") == "VERIFIED" and external.get("independent_external_source_verified") is True and defense_audit.get("independent_external_source_verified") is True),
        "odds_fresh": bool(fresh),
        "official_game_day_active_confirmed": False,
        "independent_fixture_player_identity_verified": (root/"verified_fixture_players.json").exists()
            and any(x.get("verified") is True for x in read("verified_fixture_players.json",{}).get("links",[]))
    }
    return {"generated_at_utc":now.isoformat(),"status":"VERIFICATION_INCOMPLETE" if not all(gates.values()) else "REVIEW_REQUIRED",
        "gates":gates,"eligible_graded_weeks":audit.get("eligible_graded_weeks",0),
        "train_weeks":model.get("train_weeks",0),"test_weeks":model.get("test_weeks",0),
        "bet_recommendations_enabled":False,
        "explanation":"No BET recommendation without independently calibrated probability, fresh matched odds, and confirmed game-day status."}

def main():
    output=report()
    (ROOT/"verification_status.json").write_text(json.dumps(output,indent=2)+"\n")
    print(json.dumps(output))
if __name__=="__main__":
    main()
