"""Game-score research uses the same exact, dated injury evidence as props."""
import copy
from datetime import datetime, timedelta, timezone
import unittest

import pandas as pd

from nfl_live_injuries import INJURIES_URL
from nfl_score_context import merge_score_injury_reports

NOW = datetime(2026, 11, 14, 18, tzinfo=timezone.utc)
PID = '00-0038134'
GAME = '2026_10_KC_ATL'


def fixture():
    return [{'season': 2026, 'week': 10, 'game_id': GAME, 'home_team': 'ATL',
             'away_team': 'KC', 'gameday': '2026-11-15', 'gametime': '13:00'}]


def roster():
    return [{'season': 2026, 'gsis_id': PID, 'espn_id': '4567048', 'team': 'KC',
             'full_name': 'Kenneth Walker III', 'position': 'RB'}]


def evidence(status='QUESTIONABLE', **changes):
    return dict(dict(status=status, team='KC', opponent='ATL', gameId=GAME,
                season=2026, week=10, athleteId='4567048', source=INJURIES_URL,
                reportedAt='2026-11-14T16:33:00Z', observedAt=NOW.isoformat(),
                sourceUpdatedAt='2026-11-14T17:59:00Z'), **changes)


def payload(report=None, status='ok'):
    return {'season': 2026, 'week': 10, 'availability_diagnostics': {'injuries': {
        'live_source': {'reports': {PID: evidence() if report is None else report},
                        'diagnostics': {'status': status, 'observed_at': NOW.isoformat()}}}}}


class NFLScoreContextTests(unittest.TestCase):
    def merge(self, base=None, status=None, **kwargs):
        return merge_score_injury_reports(base or {}, payload() if status is None else status,
            kwargs.pop('players', []), kwargs.pop('slate', fixture()), kwargs.pop('rosters', roster()),
            2026, 10, now=kwargs.pop('now', NOW))

    def test_current_questionable_is_visible_without_becoming_an_out(self):
        source = payload()
        before = copy.deepcopy(source)
        result = self.merge(status=source)['KC']
        report = result['reports'][0]
        self.assertEqual(result['coverage'], 'REPORTED_WITH_LIVE_SOURCE')
        self.assertEqual(result['live_report_count'], 1)
        self.assertEqual(report['player'], 'Kenneth Walker III')
        self.assertEqual(report['position'], 'RB')
        self.assertEqual(report['designation'], 'QUESTIONABLE')
        self.assertEqual(report['game_id'], GAME)
        self.assertEqual(report['source'], INJURIES_URL)
        self.assertFalse(report['cached'])
        self.assertFalse(result['official_inactives_confirmed'])
        self.assertIn('Questionable is not OUT', result['model_use'])
        self.assertEqual(source, before)

    def test_excluded_player_uses_roster_identity_without_needing_prop_candidate(self):
        report = self.merge(status=payload(evidence('OUT')), players=[])['KC']['reports'][0]
        self.assertEqual(report['player_id'], PID)
        self.assertEqual(report['player'], 'Kenneth Walker III')
        self.assertEqual(report['designation'], 'OUT')
        self.assertEqual(report['live_evidence']['athleteId'], '4567048')

    def test_weaker_live_status_does_not_clear_nflverse_out_or_erase_practice(self):
        base = {'KC': {'source': 'nflverse injury reports', 'coverage': 'REPORTED', 'reports': [
            {'player_id': PID, 'player': 'Kenneth Walker III', 'position': 'RB',
             'designation': 'Out', 'practice': 'DNP', 'injury': 'Ankle', 'source_updated_at': '2026-11-14T15:00Z'}]}}
        before = copy.deepcopy(base)
        report = self.merge(base=base)['KC']['reports'][0]
        self.assertEqual(report['designation'], 'OUT')
        self.assertEqual(report['practice'], 'DNP')
        self.assertEqual(report['injury'], 'Ankle')
        self.assertEqual(report['source_updated_at'], '2026-11-14T15:00Z')
        self.assertEqual(report['live_evidence']['status'], 'QUESTIONABLE')
        self.assertEqual(base, before)

    def test_exact_game_out_survives_source_failure_but_stale_questionable_does_not(self):
        old = evidence('OUT', observedAt='2026-11-14T17:00Z', sourceUpdatedAt='2026-11-14T16:59Z')
        later = NOW + timedelta(hours=5)
        result = self.merge(status=payload(old, status='unavailable'), now=later)['KC']
        self.assertEqual(result['reports'][0]['designation'], 'OUT')
        self.assertTrue(result['reports'][0]['cached'])
        old['status'] = 'QUESTIONABLE'
        self.assertEqual(self.merge(status=payload(old), now=later)['KC']['reports'], [])

    def test_foreign_stale_unscoped_future_and_malformed_evidence_is_not_applied(self):
        changes = [{'team': 'SEA'}, {'opponent': 'BUF'}, {'gameId': 'different-game'},
                   {'season': 2025}, {'week': 9}, {'athleteId': '999'},
                   {'source': 'https://example.test/injuries'}, {'status': 'ACTIVE'}, {'status': []},
                   {'observedAt': '2026-11-14T19:00Z'}, {'sourceUpdatedAt': '2026-11-14T19:00Z'},
                   {'reportedAt': '2026-11-01T18:00Z'}, {'observedAt': 'not-a-time'},
                   {'sourceUpdatedAt': None}]
        for change in changes:
            with self.subTest(change=change):
                self.assertEqual(self.merge(status=payload(evidence(**change)))['KC']['reports'], [])
        for status in [{'season': 2025, **{k: v for k, v in payload().items() if k != 'season'}},
                       {'season': 2026, 'week': 9, 'availability_diagnostics': payload()['availability_diagnostics']},
                       {'availability_diagnostics': None}, {'season': 2026, 'week': 10, 'availability_diagnostics': {'injuries': None}}]:
            self.assertEqual(self.merge(status=status)['KC']['reports'], [])

    def test_ambiguous_roster_or_duplicate_fixture_cannot_establish_identity(self):
        for people in [roster()+[dict(roster()[0], team='SEA')],
                       roster()+[dict(roster()[0], gsis_id='other-id')]]:
            self.assertEqual(self.merge(rosters=people)['KC']['reports'], [])
        self.assertNotIn('KC', self.merge(slate=fixture()+fixture()))

    def test_pandas_inputs_work_and_missing_sources_do_not_confirm_health(self):
        result = self.merge(rosters=pd.DataFrame(roster()), slate=pd.DataFrame(fixture()))['KC']
        self.assertEqual(result['report_count'], 1)
        no_source = self.merge(status={})['KC']
        self.assertEqual(no_source['reports'], [])
        self.assertEqual(no_source['coverage'], 'SOURCE_UNAVAILABLE')
        self.assertFalse(no_source['official_inactives_confirmed'])

    def test_old_fixture_outs_do_not_carry_to_new_games_or_after_kickoff(self):
        changed = fixture()
        changed[0]['game_id'] = '2026_10_KC_OTHER'
        self.assertEqual(self.merge(status=payload(evidence('OUT')), slate=changed)['KC']['reports'], [])
        self.assertEqual(self.merge(status=payload(evidence('OUT')), now=NOW+timedelta(days=2)), {})

    def test_missing_live_feed_retains_current_roster_nflverse_out_only(self):
        base = {'KC': {'reports': [{'player_id': PID, 'designation': 'OUT'},
                                   {'player_id': 'former-player', 'designation': 'OUT'}]}}
        result = self.merge(base=base, status={})['KC']
        self.assertEqual([r['player_id'] for r in result['reports']], [PID])
        self.assertEqual(result['reports'][0]['designation'], 'OUT')

    def test_naive_observation_time_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'timezone'):
            self.merge(now=NOW.replace(tzinfo=None))


if __name__ == '__main__':
    unittest.main()
