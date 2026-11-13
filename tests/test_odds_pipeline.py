"""Exercise the production module entry point and fail-closed odds publishing."""
import datetime as dt
from contextlib import chdir
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from scripts import build_hardrock_feed as exporter
from scripts.capture_forward_bets import capture
from scripts.odds_provider import ProviderRateLimit


class OddsPipelineTests(unittest.TestCase):
    def test_cli_reports_fresh_prices_only_after_success(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'github-output'
            with patch.dict(os.environ, {'GITHUB_OUTPUT': str(output)}), patch.object(exporter, 'main') as refresh:
                exporter.cli()
            refresh.assert_called_once_with()
            self.assertEqual(dict(line.split('=', 1) for line in output.read_text().splitlines()),
                             {'fresh_prices': 'true', 'mode': 'fresh_prices'})

    def test_cli_known_rate_limits_skip_new_prices_and_preserve_retained_feed(self):
        for source in ('http_429', 'persisted_cooldown'):
            with self.subTest(source=source), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                data = root / 'data'; data.mkdir()
                retained = data / 'hardrock_anytime_td.json'
                original = b'{"retrieved_at_utc":"2020-01-01T00:00:00Z","retained":"unchanged"}\n'
                retained.write_bytes(original)
                output = root / 'github-output'
                limited = ProviderRateLimit((dt.datetime.now(dt.timezone.utc)+dt.timedelta(minutes=15)).isoformat(),
                                            'fixtures', source)
                with chdir(root), patch.dict(os.environ, {'GITHUB_OUTPUT': str(output)}), patch.object(exporter, 'get', side_effect=limited):
                    exporter.cli()
                self.assertEqual(retained.read_bytes(), original, '429 must not refresh or re-date retained prices')
                self.assertEqual(dict(line.split('=', 1) for line in output.read_text().splitlines()),
                                 {'fresh_prices': 'false', 'mode': 'provider_rate_limit'})
                self.assertFalse((data / 'odds_history').exists(), 'no new archive is created for a failed refresh')
                self.assertFalse((data / 'forward/decisions').exists(), 'no new priced decision is frozen')

    def test_cli_authentication_and_unknown_errors_fail_without_success_outputs(self):
        for failure in ('Odds provider HTTP 401', 'Odds provider HTTP 403',
                        'Missing ODDSPAPI_API_KEY', 'Odds provider unavailable',
                        'No active Hard Rock anytime-TD prices; existing feed preserved'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as folder:
                output = Path(folder) / 'github-output'
                with patch.dict(os.environ, {'GITHUB_OUTPUT': str(output)}), patch.object(exporter, 'main', side_effect=RuntimeError(failure)):
                    with self.assertRaisesRegex(RuntimeError, re.escape(failure)):
                        exporter.cli()
                self.assertFalse(output.exists(), 'unknown failures cannot announce a successful research-only mode')

    def test_workflow_skips_only_new_archive_and_capture_without_fresh_export(self):
        workflow = (Path(__file__).resolve().parents[1] / '.github/workflows/update-hardrock-odds.yml').read_text()
        steps = re.split(r'(?m)^      - name: ', workflow)[1:]
        step_for = lambda command: next(step for step in steps if command in step)
        self.assertRegex(step_for('scripts.build_hardrock_feed'), r'(?m)^\s+id:\s*export\s*$')
        for command in ('scripts.archive_odds', 'scripts.capture_forward_bets'):
            self.assertIn("steps.export.outputs.fresh_prices == 'true'", step_for(command))
        for command in ('scripts.grade_forward_bets', 'scripts.verification_report', 'git commit'):
            self.assertNotRegex(step_for(command), r'(?m)^\s+if:', 'grading, audit and safe status publishing continue after a known 429')
        self.assertNotIn('continue-on-error', workflow, 'authentication and unknown failures must still stop the workflow')

    def test_direct_archive_still_rejects_stale_prices(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            shutil.copytree(Path(__file__).resolve().parents[1] / 'scripts', root / 'scripts')
            data = root / 'data'; data.mkdir()
            feed = data / 'hardrock_anytime_td.json'
            original = json.dumps({'market_id': 14388, 'outcome_id': 14388,
                                   'retrieved_at_utc': '2020-01-01T00:00:00Z', 'games': []}).encode()
            feed.write_bytes(original)
            proc = subprocess.run([sys.executable, '-m', 'scripts.archive_odds'], cwd=root,
                                  capture_output=True, text=True, timeout=15)
            self.assertNotEqual(proc.returncode, 0)
            self.assertIn('feed older than 15 minutes', proc.stderr)
            self.assertFalse((data / 'odds_history').exists())
            self.assertEqual(feed.read_bytes(), original)

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

    def test_publish_retains_documented_fixture_identity_fields(self):
        fixture = {"tournamentId": 31, "fixtureId": "fixture", "hasOdds": True,
                   "participant1Id": 10, "participant2Id": 20,
                   "participant1Name": "Miami Dolphins", "participant2Name": "Buffalo Bills",
                   "participant1Abbr": "MIA", "participant2Abbr": "BUF"}
        prices = {"bookmakerOdds": {"hardrockbet": {"markets": {"14388": {
            "outcomes": {"14388": {"players": {"1": {
                "active": True, "playerName": "Test, Player", "priceAmerican": 200
            }}}}
        }}}}}
        with tempfile.TemporaryDirectory() as folder:
            destination = Path(folder) / "hardrock_anytime_td.json"
            with patch.object(exporter, "get", side_effect=[[fixture], prices]), patch.object(exporter, "Path", return_value=destination):
                exporter.main()
            published = json.loads(destination.read_text())
            metadata = published["games"][0]["fixture_metadata"]
            self.assertEqual(metadata["participant1Id"], 10)
            self.assertEqual(metadata["participant2Name"], "Buffalo Bills")
            self.assertFalse(destination.with_suffix(".json.tmp").exists())

    def test_future_odds_are_rejected_before_model_checks(self):
        now = dt.datetime(2026, 10, 23, 16, tzinfo=dt.timezone.utc)
        odds = {"retrieved_at_utc": (now + dt.timedelta(minutes=1)).isoformat()}
        rows, reason = capture(odds, {}, [], {}, [], now)
        self.assertEqual(rows, [])
        self.assertIn("future-dated", reason)


if __name__ == "__main__":
    unittest.main()
