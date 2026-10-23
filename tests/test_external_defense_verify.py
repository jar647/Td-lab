import unittest
import tempfile
import json
from pathlib import Path
from scripts.external_defense_verify import verify, verify_files

class VerificationTests(unittest.TestCase):
    def records(self):
        return [{"defense":f"T{i:02}", "position":p, "games":5,
                 **({"pass_yards_total":100, "pass_attempts_total":30} if p=="QB" else {"rush_yards_total":10, "rush_attempts_total":3, "rec_yards_total":20, "targets_total":4, "receptions_total":2, "redzone_targets_total":1})}
                for i in range(32) for p in ("QB","RB","WR","TE")]

    def test_matching_independent_totals(self):
        x=self.records()
        self.assertTrue(verify(x, [dict(r) for r in x], source_name="independent-provider")["independent_external_source_verified"])

    def test_discrepancy_blocks(self):
        x=self.records(); y=[dict(r) for r in x]; y[0]["pass_yards_total"]+=1
        self.assertEqual(verify(x,y,source_name="independent-provider")["status"],"BLOCKED")

    def test_missing_team_blocks(self):
        x=self.records()
        self.assertEqual(verify(x,x[:-4],source_name="independent-provider")["status"],"BLOCKED")

    def test_duplicate_blocks(self):
        x=self.records()
        with self.assertRaises(ValueError): verify(x,x+[x[0]],source_name="independent-provider")

    def test_missing_external_provenance_fails_closed(self):
        rows=self.records()
        with tempfile.TemporaryDirectory() as d:
            a,b,o=[Path(d)/name for name in ("primary.json","external.json","result.json")]
            a.write_text(json.dumps({"season":2026,"week":7,"lookback_weeks":5,"rows":rows,"source":"nflverse PBP"}))
            b.write_text(json.dumps({"season":2026,"week":7,"lookback_weeks":5,"rows":rows,"source":"other"}))
            with self.assertRaises(ValueError): verify_files(a,b,o,"other")

    def test_same_source_rejected(self):
        x=self.records()
        with self.assertRaises(ValueError): verify(x,x,source_name="nflverse")

if __name__ == "__main__":
    unittest.main()
