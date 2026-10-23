"""Exercise the production module entry point and fail-closed odds publishing."""
import datetime as dt
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from scripts import build_hardrock_feed as exporter
from scripts.capture_forward_bets import capture


class OddsPipelineTests(unittest.TestCase):
    def test_workflow_entry_point_with_unvalidated_model(self):
        # Run exactly as Actions does, in a checkout without installed packages.
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            shutil.copytree(Path(__file__).resolve().parents[1] / "scripts", root / "scripts")
            data = root / "data"
            data.mkdir()
            stamp = dt.datetime.now(dt.timezone.utc).isoformat()
            documents = {
                "hardrock_anytime_td.json": {"retrieved_at_utc": stamp, "market_id": 14388, "outcome_id": 14388},
                "probability_model.json": {"status": "unavailable"},
                "matchups.json": [],
                "status.json": {"season": 2026, "week": 7},
            }
            for name, value in documents.items():
                (data / name).write_text(json.dumps(value))
            proc = subprocess.run([sys.executable, "-m", "scripts.capture_forward_bets"],
                                  cwd=root, capture_output=True, text=True, timeout=15)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertIn("model not validated", proc.stdout)
            frozen = list((data / "forward/decisions").glob("*.json"))
            self.assertEqual(len(frozen), 1)
            self.assertEqual(json.loads(frozen[0].read_text())["decisions"], [])

    def test_empty_provider_result_preserves_last_good_feed(self):
        with tempfile.TemporaryDirectory() as folder:
            destination = Path(folder) / "hardrock_anytime_td.json"
            destination.write_text('{"existing": true}')
            with patch.object(exporter, "get", return_value=[]), patch.object(exporter, "Path", return_value=destination):
                with self.assertRaisesRegex(RuntimeError, "existing feed preserved"):
                    exporter.main()
            self.assertEqual(json.loads(destination.read_text()), {"existing": True})

    def test_invalid_provider_price_preserves_last_good_feed(self):
        fixture = {"tournamentId": 31, "fixtureId": "fixture", "hasOdds": True}
        prices = {"bookmakerOdds": {"hardrockbet": {"markets": {"14388": {
            "outcomes": {"14388": {"players": {"1": {
                "active": True, "playerName": "Test, Player", "priceAmerican": 99
            }}}}
        }}}}}
        with patch.object(exporter, "get", side_effect=[[fixture], prices]):
            with self.assertRaisesRegex(RuntimeError, "Invalid American odds"):
                exporter.main()

    def test_future_odds_are_rejected_before_model_checks(self):
        now = dt.datetime(2026, 10, 23, 16, tzinfo=dt.timezone.utc)
        odds = {"retrieved_at_utc": (now + dt.timedelta(minutes=1)).isoformat()}
        rows, reason = capture(odds, {}, [], {}, [], now)
        self.assertEqual(rows, [])
        self.assertIn("future-dated", reason)


if __name__ == "__main__":
    unittest.main()
