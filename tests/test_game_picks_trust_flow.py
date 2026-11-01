"""Exercise the real publisher with controlled source frames and no network."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import pandas as pd

if importlib.util.find_spec('nflreadpy') is None:
    sys.modules.setdefault('nflreadpy', types.ModuleType('nflreadpy'))
import game_picks as publisher
from test_game_trust import fixture


class PublisherTrustFlowTests(unittest.TestCase):
    def test_complete_publish_includes_audit_qb_split_and_no_epa_point_bonus(self):
        schedule = pd.DataFrame([{'season': 2026, 'week': w, 'game_type': 'REG',
            'game_id': f'g{w}', 'home_team': 'BUF', 'away_team': 'BAL',
            'home_score': 24 if w < 8 else None, 'away_score': 21 if w < 8 else None,
            'gameday': '2026-10-01' if w < 8 else '2026-11-01', 'gametime': '13:00'}
            for w in range(1, 9)])
        player = {'team': 'BAL', 'opp': 'BUF', 'pos': 'QB', 'player_id': 'lamar',
                  'player': 'Lamar Jackson', 'qbRole': 'EXPECTED_STARTER', 'starterContext': {'source': 'team'}}
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root/'data').mkdir()
            (root/'data/status.json').write_text(json.dumps({'season': 2026, 'week': 8}))
            (root/'data/matchups.json').write_text(json.dumps([player]))
            with patch.object(publisher, 'ROOT', root), \
                 patch.object(publisher.nflreadpy, 'load_schedules', return_value=schedule, create=True), \
                 patch.object(publisher.nflreadpy, 'load_pbp', return_value=pd.DataFrame(fixture()), create=True), \
                 patch.object(publisher.nflreadpy, 'load_injuries', return_value=pd.DataFrame(), create=True), \
                 patch.object(publisher.nflreadpy, 'load_rosters', return_value=pd.DataFrame(), create=True), \
                 patch.object(publisher, 'injury_research', return_value={}), \
                 patch.object(publisher, 'game_research_context', return_value={'venue': {'roof': 'outdoors'}}), \
                 patch.object(publisher, 'enrich_research', side_effect=lambda ctx, *args: ctx), \
                 patch.object(publisher, 'forecast_for_game', return_value={'available': False}), \
                 contextlib.redirect_stdout(io.StringIO()):
                publisher.main()
            feed = json.loads((root/'data/game_picks.json').read_text())
            game = feed['games'][0]
            self.assertEqual(game['model_version'], 'score-baseline-trust-v3')
            self.assertEqual(game['kickoff_at'], '2026-11-01T18:00:00+00:00')
            self.assertEqual(game['projected_home_points'], game['model_inputs']['baseline_home_points'])
            trust = game['model_inputs']['trust']
            self.assertEqual(trust['source_status'], 'RECONCILED')
            self.assertEqual(trust['qb_context']['BAL']['starter_led_offense']['games'], 3)
            self.assertFalse(trust['experimental_adjustment_enabled'])
            self.assertEqual(trust['calibration_status'], 'NOT_CALIBRATED')
            self.assertTrue((root/'data/game_context_audit.json').exists())
            self.assertTrue((root/'data/game_model_validation.json').exists())
            self.assertTrue((root/'data/game_score_results.json').exists())


if __name__ == '__main__':
    unittest.main()
