import json, pathlib, subprocess, sys, tempfile, unittest

SCRIPT = pathlib.Path(__file__).with_name("nba_tracker.py")

class TrackerTipoffTests(unittest.TestCase):
    def run_tracker(self, final_date):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / "data").mkdir()
            (root / "nba_tracker.py").write_text(SCRIPT.read_text())
            locked = "2026-11-10T18:00:00+00:00"
            tipoff = "2026-11-10T19:00:00+00:00"
            snapshot = {"game_id": 123, "tipoff": tipoff, "home_team":"AAA", "away_team":"BBB", "locked_at": locked,
                        "model": "test", "projections": [
                            {"player_id": "7", "market": "points", "projection": 20,
                             "result": "pending", "actual": None}]}
            (root / "data/nba_projection_tracker.json").write_text(json.dumps({"snapshots": [snapshot]}))
            (root / "data/nba_games.json").write_text(json.dumps({"games": [{
                "id": 123, "date": final_date, "status": "STATUS_FINAL",
                "home": "AAA", "away": "BBB",
                "players": [{"id": 7, "team": "AAA", "name": "Test Player",
                             "stats": {"MIN": "32:00", "PTS": 21}}]}]}))
            subprocess.run([sys.executable, str(root / "nba_tracker.py")], check=True,
                           capture_output=True, text=True)
            result = json.loads((root / "data/nba_projection_tracker.json").read_text())
            return result["snapshots"][0]["projections"][0]["result"]

    def test_same_tipoff_grades(self):
        self.assertEqual(self.run_tracker("2026-11-10T19:00:00+00:00"), "within_20pct")

    def test_rescheduled_tipoff_does_not_grade(self):
        self.assertEqual(self.run_tracker("2026-11-11T19:00:00+00:00"), "pending")

if __name__ == "__main__":
    unittest.main()
