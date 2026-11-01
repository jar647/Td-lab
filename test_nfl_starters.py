import copy
import unittest
from nfl_starters import apply_starter_context

class StarterContextTests(unittest.TestCase):
    def setUp(self):
        self.confirmation = {'season': 2026, 'week': 8, 'team': 'BAL', 'opponent': 'BUF',
                             'player_id': 'lamar', 'source': 'https://www.baltimoreravens.com/news/test',
                             'reported_at': '2026-10-30T17:56:00Z'}
        self.rows = [{'team': 'BAL', 'opp': 'BUF', 'pos': 'QB', 'player_id': pid,
                      'availability': 'ROSTER_ACTIVE', 'injuryReportStatus': 'NOT_REPORTED'}
                     for pid in ('lamar', 'huntley')]

    def test_confirmed_return_sets_roles_without_claiming_active(self):
        apply_starter_context(self.rows, 2026, 8, [self.confirmation])
        self.assertEqual(self.rows[0]['qbRole'], 'EXPECTED_STARTER')
        self.assertEqual(self.rows[1]['qbRole'], 'BACKUP')
        self.assertEqual(self.rows[0]['injuryReportStatus'], 'NOT_REPORTED')
        self.assertNotIn('gameDayAvailability', self.rows[0])

    def test_confirmation_never_carries_into_another_week_or_opponent(self):
        original = copy.deepcopy(self.rows)
        apply_starter_context(self.rows, 2026, 9, [self.confirmation])
        self.assertEqual(self.rows, original)
        self.rows[0]['opp'] = 'KC'
        apply_starter_context(self.rows, 2026, 8, [self.confirmation])
        self.assertNotIn('qbRole', self.rows[1])

    def test_out_and_missing_starter_do_not_promote_backup(self):
        self.rows[0]['injuryReportStatus'] = 'OUT'
        apply_starter_context(self.rows, 2026, 8, [self.confirmation])
        self.assertNotIn('qbRole', self.rows[1])
        apply_starter_context(self.rows[1:], 2026, 8, [self.confirmation])
        self.assertNotIn('qbRole', self.rows[1])

if __name__ == '__main__':
    unittest.main()
