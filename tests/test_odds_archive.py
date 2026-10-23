"""Tests for archived pre-kickoff sportsbook snapshots."""
import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from scripts import archive_odds

class OddsArchiveTests(unittest.TestCase):
    def test_archive_excludes_games_already_started(self):
        now = dt.datetime.now(dt.timezone.utc)
        def game(name, hours):
            return {"fixture_id": name,
                    "fixture_metadata": {"startTime": (now + dt.timedelta(hours=hours)).isoformat()},
                    "selections": [{"player_name": "Test, Player", "american_odds": 150}]}
        data = {"market_id": 14388, "outcome_id": 14388,
                "retrieved_at_utc": now.isoformat(),
                "games": [game("started", -1), game("future", 4)]}
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "odds.json"
            source.write_text(json.dumps(data))
            with patch.object(archive_odds, "SOURCE", source), patch.object(archive_odds, "ROOT", Path(tmp) / "archive"):
                archive_odds.main()
            archived = list((Path(tmp) / "archive").rglob("*.json"))
            self.assertEqual(len(archived), 1)
            saved = json.loads(archived[0].read_text())
            self.assertEqual([g["fixture_id"] for g in saved["games"]], ["future"])

    def test_no_pregame_fixtures_fails(self):
        now = dt.datetime.now(dt.timezone.utc)
        data = {"market_id": 14388, "outcome_id": 14388, "retrieved_at_utc": now.isoformat(),
                "games": [{"fixture_id": "started",
                           "fixture_metadata": {"startTime": (now - dt.timedelta(hours=1)).isoformat()},
                           "selections": [{"player_name": "Test, Player", "american_odds": 150}]}]}
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "odds.json"
            source.write_text(json.dumps(data))
            with patch.object(archive_odds, "SOURCE", source), patch.object(archive_odds, "ROOT", Path(tmp) / "archive"):
                with self.assertRaises(ValueError):
                    archive_odds.main()

if __name__ == "__main__":
    unittest.main()
