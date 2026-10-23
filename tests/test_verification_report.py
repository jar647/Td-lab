import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path
from scripts.verification_report import report

class VerificationReportTests(unittest.TestCase):
    def test_missing_evidence_never_enables_bets(self):
        with tempfile.TemporaryDirectory() as folder:
            result=report(dt.datetime(2026,10,23,16,tzinfo=dt.timezone.utc),Path(folder))
            self.assertFalse(result["bet_recommendations_enabled"])
            self.assertFalse(all(result["gates"].values()))
    def test_even_valid_model_and_fresh_odds_require_game_day_clearance(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            (root/"probability_model.json").write_text(json.dumps({"status":"validated","train_weeks":4,"test_weeks":2,"train_players":250,"test_players":100,"holdout_brier":.14,"holdout_baseline_brier":.16}))
            (root/"hardrock_anytime_td.json").write_text(json.dumps({"retrieved_at_utc":"2026-10-23T15:59:00Z"}))
            (root/"verified_fixture_players.json").write_text(json.dumps({"links":[{"verified":True}]}))
            result=report(dt.datetime(2026,10,23,16,tzinfo=dt.timezone.utc),root)
            self.assertTrue(result["gates"]["model_calibrated"])
            self.assertTrue(result["gates"]["odds_fresh"])
            self.assertFalse(result["gates"]["official_game_day_active_confirmed"])
            self.assertFalse(result["bet_recommendations_enabled"])
if __name__=="__main__": unittest.main()
