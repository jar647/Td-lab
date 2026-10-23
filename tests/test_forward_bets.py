import unittest
from scripts.grade_forward_bets import grade, profit

class ForwardBetTests(unittest.TestCase):
    def test_profit_math(self):
        self.assertEqual(profit(200, True), 2)
        self.assertEqual(profit(-150, True), 100/150)
        self.assertEqual(profit(200, False), -1)

    def test_no_unverified_or_postkickoff_bets(self):
        base = dict(season=2026, week=8, player_id="00-1", fixture_id="fixture",
                    captured_at_utc="2026-10-25T18:00:00Z",
                    kickoff_utc="2026-10-25T17:00:00Z", american_odds=200,
                    model_probability=.4, model_status="validated",
                    identity_verified=True)
        result = {(2026, 8): {"accuracy_eligible": True, "pregame_snapshot": True,
                  "players": [{"player_id": "00-1", "scored_td": True}]}}
        self.assertEqual(grade([{"decisions": [base]}], result)["graded_bets"], 0)
        base["captured_at_utc"] = "2026-10-25T16:00:00Z"
        base["identity_verified"] = False
        self.assertEqual(grade([{"decisions": [base]}], result)["graded_bets"], 0)

    def test_valid_frozen_bet_and_duplicate_rejection(self):
        row = dict(season=2026, week=8, player_id="00-1", fixture_id="fixture",
                   captured_at_utc="2026-10-25T16:00:00Z",
                   kickoff_utc="2026-10-25T17:00:00Z", american_odds=200,
                   model_probability=.4, model_status="validated",
                   identity_verified=True)
        results = {(2026, 8): {"accuracy_eligible": True, "pregame_snapshot": True,
                   "players": [{"player_id": "00-1", "scored_td": True}]}}
        summary = grade([{"decisions": [row, row]}], results)
        self.assertEqual(summary["graded_bets"], 1)
        self.assertEqual(summary["flat_stake_units"], 2)
        self.assertEqual(summary["rejected_count"], 1)

if __name__ == "__main__":
    unittest.main()
