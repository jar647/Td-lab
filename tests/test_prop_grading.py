"""Forward NFL prop grader regression checks."""
import unittest
import pandas as pd
from grade_prop_probabilities import evaluate

class PropGradingTests(unittest.TestCase):
    def fixtures(self):
        schedules = pd.DataFrame([{
            "game_type": "REG", "game_id": "2026_08_A_B",
            "home_team": "A", "away_team": "B",
            "home_score": 24, "away_score": 17,
        }])
        appearances = pd.DataFrame([
            {"game_id": "2026_08_A_B", "player_id": "p1", "team": "A",
             "passing_yards": 200, "rushing_yards": 0,
             "receiving_yards": 0, "receptions": 0},
            {"game_id": "2026_08_A_B", "player_id": "p2", "team": "B",
             "passing_yards": 100, "rushing_yards": 0,
             "receiving_yards": 0, "receptions": 0},
        ])
        prediction = {"player_id": "p1", "market": "PASS", "threshold": 199.5,
                      "model_probability": 0.6, "baseline_probability": 0.55}
        snapshot = {
            "game_id": "2026_08_A_B", "season": 2026, "week": 8,
            "model_version": "opportunity-2024-trained-eligible-fullseason-v2",
            "captured_at_utc": "2026-10-26T00:00:00+00:00",
            "conservative_game_day_cutoff_utc": "2026-10-28T00:00:00+00:00",
            "predictions": [prediction],
        }
        return schedules, appearances, snapshot

    def test_valid_frozen_prediction_is_graded(self):
        schedules, appearances, snap = self.fixtures()
        report = evaluate([snap], schedules, appearances)
        self.assertEqual(report["graded"], 1)
        self.assertEqual(report["current_model_graded"], 1)
        self.assertEqual(report["records"][0]["hit"], 1)
        self.assertFalse(report["bet_ready"])
        market=report["markets"]["PASS"]
        self.assertEqual(market["distinct_player_games"],1)
        self.assertEqual(market["distinct_game_market_players"],1)
        self.assertEqual(market["calibration_bins"][0]["range"],"60-70%")
        self.assertEqual(market["calibration_bins"][0]["observed"],1)
        self.assertIsInstance(market["expected_calibration_error"],float)
        self.assertEqual(report["snapshot_inventory"][snap["model_version"]]["final_games"],1)
        self.assertFalse(report["eligible_for_research_review"])

    def test_duplicate_forecast_rejected(self):
        schedules, appearances, snap = self.fixtures()
        snap["predictions"].append(dict(snap["predictions"][0]))
        with self.assertRaisesRegex(RuntimeError, "Duplicate frozen forecasts"):
            evaluate([snap], schedules, appearances)

    def test_after_cutoff_fails_closed(self):
        schedules, appearances, snap = self.fixtures()
        snap["captured_at_utc"] = "2026-10-29T00:00:00+00:00"
        report = evaluate([snap], schedules, appearances)
        self.assertEqual(report["graded"], 0)
        self.assertEqual(report["skipped"]["INVALID_CAPTURE_TIME"], 1)

    def test_unfinished_game_not_graded(self):
        schedules, appearances, snap = self.fixtures()
        schedules.loc[0, "home_score"] = float("nan")
        report = evaluate([snap], schedules, appearances)
        self.assertEqual(report["graded"], 0)
        self.assertEqual(report["skipped"]["GAME_NOT_FINAL"], 1)
        self.assertEqual(report["snapshot_inventory"][snap["model_version"]]["pending_final"],1)
        self.assertEqual(report["game_first_graded"],0)

if __name__ == "__main__":
    unittest.main()
