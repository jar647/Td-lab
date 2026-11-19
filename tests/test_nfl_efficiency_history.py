import unittest
import pandas as pd
from scripts.prepare_nfl_efficiency_history import FIELDS, prepare


class EfficiencyHistoryTests(unittest.TestCase):
    def sample(self):
        return {"season_type": "REG", "position": "WR", "week": 4,
                "game_id": "2025_04_A_B", "team": "A", "player_id": "wr",
                "player_display_name": "Receiver", **{key: 0 for key in FIELDS.values()}}

    def test_zero_appearance_and_dated_position_are_preserved(self):
        row = self.sample()
        result = prepare(pd.DataFrame([row, {**row, "season_type": "POST", "week": 20}]))
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["seasonGameStats"][0]["receptions"], 0)
        self.assertEqual(result[0]["seasonGameStats"][0]["position"], "WR")
        self.assertEqual(result[0]["seasonGameStats"][0]["week"], 4)

    def test_duplicate_and_missing_evidence_is_not_invented(self):
        row = self.sample()
        with self.assertRaisesRegex(ValueError, "identity"):
            prepare(pd.DataFrame([row, row]))
        with self.assertRaisesRegex(ValueError, "schema"):
            prepare(pd.DataFrame([row]).drop(columns=["targets"]))
        result = prepare(pd.DataFrame([{**row, "targets": None}]))
        self.assertEqual(result, [])


if __name__ == "__main__":
    unittest.main()
