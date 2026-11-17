"""Exercise the real publisher with controlled source frames and no network."""
import contextlib
from datetime import datetime, timedelta, timezone
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

if 'nflreadpy' not in sys.modules and importlib.util.find_spec('nflreadpy') is None:
    sys.modules.setdefault('nflreadpy', types.ModuleType('nflreadpy'))
import game_picks as publisher
from tests.test_game_trust import fixture
from nfl_live_injuries import INJURIES_URL

NOW = datetime(2026, 10, 31, 12, tzinfo=timezone.utc)


class PublisherTrustFlowTests(unittest.TestCase):
    def publish(self, live_report=False, injury_failure=False):
        games = []
        for w in range(1, 9):
            home = 'BUF' if w % 2 or w == 8 else 'BAL'
            away = 'BAL' if home == 'BUF' else 'BUF'
            games.append({'season': 2026, 'week': w, 'game_type': 'REG',
                'game_id': f'g{w}', 'home_team': home, 'away_team': away,
                'home_score': 24 if w < 8 else None, 'away_score': 21 if w < 8 else None,
                'home_qb_id': 'allen' if home == 'BUF' else 'lamar',
                'away_qb_id': 'allen' if away == 'BUF' else 'lamar',
                'gameday': '2026-10-01' if w < 8 else '2026-11-01', 'gametime': '13:00',
                'temp': 99, 'wind': 70})
        schedule = pd.DataFrame(games)
        players = [
            {'team': 'BAL', 'opp': 'BUF', 'pos': 'QB', 'player_id': 'lamar',
             'player': 'Lamar Jackson', 'qbRole': 'EXPECTED_STARTER', 'starterContext': {'source': 'team'}},
            {'team': 'BUF', 'opp': 'BAL', 'pos': 'QB', 'player_id': 'allen', 'player': 'Josh Allen'},
            {'team': 'BAL', 'opp': 'BUF', 'pos': 'WR', 'player_id': 'receiver', 'player': 'Questionable Receiver'},
        ]
        roster = pd.DataFrame([
            {'season': 2026, 'team': p['team'], 'gsis_id': p['player_id'], 'espn_id': str(100+i),
             'position': p['pos'], 'full_name': p['player']}
            for i, p in enumerate(players)
        ])
        status = {'season': 2026, 'week': 8}
        if live_report:
            # Exercise the actual collector-evidence bridge with a fixed clock,
            # exact roster identity, and a report inside this fixture's window.
            status['availability_diagnostics'] = {'injuries': {'live_source': {
                'diagnostics': {'status': 'ok', 'observed_at': NOW.isoformat()},
                'reports': {'receiver': {'status': 'QUESTIONABLE', 'team': 'BAL', 'opponent': 'BUF',
                    'gameId': 'g8', 'season': 2026, 'week': 8, 'athleteId': '102',
                    'source': INJURIES_URL, 'reportedAt': (NOW-timedelta(minutes=30)).isoformat(),
                    'observedAt': NOW.isoformat(), 'sourceUpdatedAt': (NOW-timedelta(minutes=5)).isoformat()}},
            }}}
        merge = publisher.merge_score_injury_reports

        def scoped_merge(*args):
            return merge(*args, now=NOW)

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root/'data').mkdir()
            (root/'data/status.json').write_text(json.dumps(status))
            (root/'data/matchups.json').write_text(json.dumps(players))
            with patch.object(publisher, 'ROOT', root), \
                 patch.object(publisher.nflreadpy, 'load_schedules', return_value=schedule, create=True), \
                 patch.object(publisher.nflreadpy, 'load_pbp', return_value=pd.DataFrame(fixture()), create=True), \
                 patch.object(publisher.nflreadpy, 'load_injuries', return_value=pd.DataFrame(),
                              side_effect=RuntimeError('offline injuries') if injury_failure else None, create=True), \
                 patch.object(publisher.nflreadpy, 'load_rosters', return_value=roster, create=True) as load_rosters, \
                 patch.object(publisher.nflreadpy, 'load_snap_counts', return_value=pd.DataFrame(), create=True), \
                 patch.object(publisher, 'injury_research', wraps=publisher.injury_research) as injury_research, \
                 patch.object(publisher, 'merge_score_injury_reports', side_effect=scoped_merge) as shared_reports, \
                 patch.object(publisher, 'build_scenario', wraps=publisher.build_scenario) as scenario, \
                 patch.object(publisher, 'forecast_for_game', return_value={'available': False}), \
                 contextlib.redirect_stdout(io.StringIO()):
                publisher.main()
            feed = json.loads((root/'data/game_picks.json').read_text())
            self.assertTrue((root/'data/game_context_audit.json').exists())
            self.assertTrue((root/'data/game_model_validation.json').exists())
            self.assertTrue((root/'data/game_score_results.json').exists())
        load_rosters.assert_called_once_with([2026])
        self.assertTrue(injury_research.call_args.args[1].equals(roster))
        self.assertTrue(shared_reports.call_args.args[4].equals(roster))
        return feed['games'][0], injury_research.call_args.args[0], scenario.call_args.args[7]

    def assert_baseline_safeguards(self, game):
        self.assertEqual(game['model_version'], 'score-baseline-trust-v3')
        self.assertEqual(game['kickoff_at'], '2026-11-01T18:00:00+00:00')
        for side in ('home', 'away'):
            self.assertEqual(game[f'projected_{side}_points'], game['model_inputs'][f'baseline_{side}_points'])
        trust = game['model_inputs']['trust']
        self.assertEqual(trust['source_status'], 'RECONCILED')
        self.assertEqual(trust['qb_context']['BAL']['starter_led_offense']['games'], 3)
        self.assertFalse(trust['experimental_adjustment_enabled'])
        self.assertEqual(trust['calibration_status'], 'NOT_CALIBRATED')
        research = game['model_inputs']['matchup_research']
        self.assertEqual(research['status'], 'RESEARCH_ONLY')
        self.assertEqual(research['through_week'], 7)
        self.assertFalse(research['score_adjustments_applied'])
        self.assertIsNone(game['model_inputs']['residual_context']['temperature_f'])
        self.assertIsNone(game['model_inputs']['residual_context']['wind_mph'])
        self.assertIsNone(game['model_inputs']['research_context']['venue']['temperature_f'])
        self.assertIsNone(game['model_inputs']['research_context']['venue']['wind_mph'])
        self.assertTrue(research['strength']['available'])
        self.assertEqual({r['team'] for r in research['opportunities']}, {'BUF', 'BAL'})
        for direction in game['model_inputs']['matchup'].values():
            self.assertEqual(direction['score_adjustment'], 0)
            self.assertFalse(direction['adjustment_applied'])
        for market in ('ml', 'ats', 'total'):
            self.assertEqual(game[market]['status'], 'PASS')
            self.assertIsNone(game[market]['pick'])

    def test_complete_publish_includes_audit_qb_split_and_no_epa_point_bonus(self):
        game, _, _ = self.publish()
        self.assert_baseline_safeguards(game)

    def test_shared_questionable_evidence_reaches_research_and_lineup_without_out_penalty(self):
        game, _, scenario_reports = self.publish(live_report=True)
        self.assert_baseline_safeguards(game)
        report = game['model_inputs']['research_context']['teams']['BAL']['injuries']
        self.assertEqual(report['live_report_count'], 1)
        self.assertEqual(report['reports'][0]['player_id'], 'receiver')
        self.assertEqual(report['reports'][0]['designation'], 'QUESTIONABLE')
        self.assertEqual(report['reports'][0]['game_id'], 'g8')
        self.assertEqual(scenario_reports['BAL']['reports'], report['reports'])
        lineup = game['model_inputs']['lineup_scenario']
        self.assertTrue(lineup['available'])
        self.assertEqual(lineup['version'], 'nfl-qb-lineup-scenario-v2')
        self.assertEqual(lineup['injuries']['BAL']['reports'], report['reports'])
        self.assertEqual(lineup['injuries']['BAL']['live_report_count'], 1)
        for units in lineup['injuries'].values():
            for unit in units['units']:
                self.assertEqual(unit['status'], 'NO_KNOWN_OUTS')
                self.assertFalse(unit['applied'])
                self.assertEqual(unit['shift'], 0)
        self.assertEqual(lineup['home'], lineup['before_absence_adjustment']['home'])
        self.assertEqual(lineup['away'], lineup['before_absence_adjustment']['away'])

    def test_injury_source_failure_retains_roster_identity_for_shared_live_evidence(self):
        game, unavailable_injuries, scenario_reports = self.publish(live_report=True, injury_failure=True)
        self.assert_baseline_safeguards(game)
        self.assertIsNone(unavailable_injuries)
        report = game['model_inputs']['research_context']['teams']['BAL']['injuries']
        self.assertIn('Injury source: offline injuries', report['source_error'])
        self.assertEqual(report['live_report_count'], 1)
        self.assertEqual(report['reports'][0]['designation'], 'QUESTIONABLE')
        self.assertEqual(scenario_reports['BAL']['reports'], report['reports'])


if __name__ == '__main__':
    unittest.main()
