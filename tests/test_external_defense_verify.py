import unittest
from scripts.external_defense_verify import verify

class VerificationTests(unittest.TestCase):
    def records(self):
        return [{"defense":f"T{i:02}", "position":p, "games":5,
                 "pass_yards":100 if p=="QB" else 0,
                 "rush_yards":10, "rec_yards":20, "receptions":2}
                for i in range(32) for p in ("QB","RB","WR","TE")]

    def test_matching_independent_totals(self):
        x=self.records()
        self.assertTrue(verify(x, [dict(r) for r in x], source_name="independent-provider")["independent_external_source_verified"])

    def test_discrepancy_blocks(self):
        x=self.records(); y=[dict(r) for r in x]; y[0]["pass_yards"]+=1
        self.assertEqual(verify(x,y,source_name="independent-provider")["status"],"BLOCKED")

    def test_missing_team_blocks(self):
        x=self.records()
        self.assertEqual(verify(x,x[:-4],source_name="independent-provider")["status"],"BLOCKED")

    def test_duplicate_blocks(self):
        x=self.records()
        with self.assertRaises(ValueError): verify(x,x+[x[0]],source_name="independent-provider")

    def test_same_source_rejected(self):
        x=self.records()
        with self.assertRaises(ValueError): verify(x,x,source_name="nflverse")

if __name__ == "__main__":
    unittest.main()
