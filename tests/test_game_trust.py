import copy
import unittest
from game_context import team_context
from game_trust import reconcile_contexts, quarterback_context, validation_report


def fixture():
    rows = []
    for week in range(1, 8):
        for offense, defense in [('BAL', 'BUF'), ('BUF', 'BAL')]:
            for play in range(24):
                rows.append({'season': 2026, 'season_type': 'REG', 'week': week,
                    'game_id': f'g{week}', 'play_id': play + (100 if offense == 'BUF' else 0),
                    'posteam': offense, 'defteam': defense, 'play_type': 'pass' if play < 12 else 'run',
                    'epa': .2 if offense == 'BUF' else -.1, 'success': int(play % 2 == 0),
                    'yards_gained': 25 if play % 3 == 0 else 2, 'sack': int(play == 0),
                    'interception': int(play == 1), 'fumble_lost': 0, 'no_play': 0,
                    'passer_player_id': ('lamar' if week < 4 else 'backup') if offense == 'BAL' and play < 12 else ('allen' if play < 12 else None)})
    return rows


class GameTrustTests(unittest.TestCase):
    def setUp(self):
        self.rows = fixture()
        self.contexts = {t: team_context(self.rows, 2026, 8, t) for t in ('BAL', 'BUF')}
        self.games = {t: {f'g{w}' for w in range(1, 8)} for t in ('BAL', 'BUF')}

    def test_independent_reducer_reconciles_counts_rates_and_game_coverage(self):
        audit = reconcile_contexts(self.rows, self.contexts, self.games, 2026, 8)
        self.assertEqual(audit['status'], 'RECONCILED')
        self.assertFalse(audit['external_verification'])
        self.assertEqual(audit['teams']['BAL']['counts']['offense']['plays'], 168)
        self.assertEqual(len(audit['source_sha256']), 64)

    def test_changed_display_stat_cannot_pass(self):
        self.contexts['BAL']['offense']['epa_per_play'] += .001
        with self.assertRaisesRegex(ValueError, 'aggregation mismatch'):
            reconcile_contexts(self.rows, self.contexts, self.games, 2026, 8)

    def test_missing_completed_game_and_duplicate_plays_block_publication(self):
        with self.assertRaisesRegex(ValueError, 'coverage mismatch'):
            rows = [r for r in self.rows if r['game_id'] != 'g1']
            reconcile_contexts(rows, self.contexts, self.games, 2026, 8)
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            reconcile_contexts(self.rows + [self.rows[0]], self.contexts, self.games, 2026, 8)

    def test_future_week_cannot_be_present_even_if_aggregate_matches(self):
        future = copy.deepcopy(self.rows[0]); future['week'] = 8
        with self.assertRaisesRegex(ValueError, 'leaked'):
            reconcile_contexts(self.rows + [future], self.contexts, self.games, 2026, 8)

    def test_missing_epa_is_reported_and_never_invented(self):
        self.rows[0]['epa'] = None
        contexts = {t: team_context(self.rows, 2026, 8, t) for t in ('BAL', 'BUF')}
        audit = reconcile_contexts(self.rows, contexts, self.games, 2026, 8)
        self.assertEqual(audit['epa_missing_plays'], 1)
        self.assertEqual(audit['teams']['BAL']['counts']['offense']['plays'], 167)

    def test_returning_qb_uses_distinct_led_games_and_flags_recent_backup_sample(self):
        qb = [{'team': 'BAL', 'pos': 'QB', 'player_id': 'lamar', 'player': 'Lamar Jackson',
               'qbRole': 'EXPECTED_STARTER', 'starterContext': {'source': 'team'}}]
        result = quarterback_context(self.rows, 'BAL', qb)
        self.assertEqual(result['status'], 'RETURNING_STARTER_SAMPLE_MISMATCH')
        self.assertEqual(result['recent_games_other_primary_qb'], 4)
        self.assertEqual(result['starter_led_offense']['games'], 3)
        self.assertFalse(result['point_adjustment_applied'])
        self.assertEqual(quarterback_context(self.rows, 'BUF', [])['status'], 'STARTER_UNCONFIRMED')

    def test_retrospective_evidence_does_not_certify_probabilities(self):
        rows = [{'game_id': str(w), 'season': 2025, 'week': w, 'baseline_margin': 4.,
                 'baseline_total': 45., 'projected_margin': 3., 'projected_total': 44.,
                 'actual_margin': 3., 'actual_total': 44.} for w in range(1, 11)]
        result = validation_report({'records': rows})
        self.assertEqual(result['status'], 'NOT_CALIBRATED')
        self.assertFalse(result['experimental_adjustment_enabled'])
        self.assertEqual(result['metrics']['margin']['mean_improvement'], 1.)
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            validation_report({'records': rows + rows})


if __name__ == '__main__':
    unittest.main()
