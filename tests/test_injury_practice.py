"""Ensure practice injuries never get converted to game-day OUT decisions."""
import unittest
import pandas as pd
from build_feed import availability, practice_flags

class InjuryPracticeTests(unittest.TestCase):
    def test_practice_dnp_is_warning_not_game_out(self):
        rows=pd.DataFrame([dict(season=2026,week=8,gsis_id="id1",report_status=None,practice_status="Did Not Participate")])
        self.assertEqual(availability(rows,8),{})
        self.assertEqual(practice_flags(rows,8),{"id1":"DNP_PRACTICE"})

    def test_full_participation_clears_previous_practice_risk(self):
        rows=pd.DataFrame([
            dict(season=2026,week=8,gsis_id="id1",report_status=None,practice_status="Limited Participation"),
            dict(season=2026,week=8,gsis_id="id1",report_status=None,practice_status="Full Participation"),
        ])
        self.assertEqual(practice_flags(rows,8),{})

    def test_game_out_remains_distinct(self):
        rows=pd.DataFrame([dict(season=2026,week=8,gsis_id="id2",report_status="Out",practice_status="Did Not Participate")])
        self.assertEqual(availability(rows,8),{"id2":"OUT"})
        self.assertEqual(practice_flags(rows,8),{"id2":"DNP_PRACTICE"})

    def test_other_week_not_leaked(self):
        rows=pd.DataFrame([dict(season=2026,week=7,gsis_id="id1",report_status="Out",practice_status="Limited Participation")])
        self.assertEqual(availability(rows,8),{})
        self.assertEqual(practice_flags(rows,8),{})

if __name__=="__main__":
    unittest.main()
