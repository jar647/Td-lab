#!/usr/bin/env python3
"""Offline tests for UFC source parsing, cache timestamps and coverage guardrails."""
import datetime
import unittest
from refresh_ufc import stats, valid_stats, age_days, profile_data, number

NOW = datetime.datetime(2026, 11, 7, tzinfo=datetime.timezone.utc)

class RefreshUnitTests(unittest.TestCase):
    def test_percent_formats(self):
        rates = {'sig_landed_per_15': 60, 'sig_absorbed_per_15': 45,
                 'sig_accuracy': '0.48', 'sig_defense': '52%',
                 'td_per_15': 1.5, 'td_accuracy': 0.4,
                 'td_defense': '75', 'sub_attempts_per_15': 0.2}
        parsed = stats({'career_rates': rates})
        self.assertEqual(parsed['slpm'], 4)
        self.assertEqual(parsed['strAcc'], 48)
        self.assertEqual(parsed['strDef'], 52)
        self.assertEqual(parsed['tdAcc'], 40)
        self.assertTrue(valid_stats(parsed))

    def test_missing_invalid_values(self):
        self.assertIsNone(number(float('nan')))
        self.assertIsNone(number(True))
        self.assertIsNone(stats({'career_rates': {'sig_accuracy': 101}})['strAcc'])
        self.assertFalse(valid_stats(stats({})))

    def test_timestamp_staleness(self):
        self.assertEqual(age_days({'fetched_at': '2026-11-06T00:00:00+00:00'}, NOW), 1)
        self.assertEqual(age_days({'fetched_at': '2026-11-08T00:00:00+00:00'}, NOW), float('inf'))
        self.assertEqual(age_days({'fetched_at': '2026-11-06T00:00:00'}, NOW), float('inf'))

    def test_source_profile_identity(self):
        profile = profile_data({'fighter': {'pro_record': '10-2'}, 'career_rates': {}}, '123', 'Test Fighter', NOW)
        self.assertEqual(profile['id'], '123')
        self.assertEqual(profile['record'], '10-2')
        self.assertFalse(valid_stats(profile['stats']))

if __name__ == '__main__':
    unittest.main()
