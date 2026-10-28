"""Evidence-stage, official practice, and current-team injury regression checks."""
import unittest
import pandas as pd
from injury_readiness import diagnose_injury_feed, trusted_injury_rows
from build_feed import availability, practice_flags


class InjuryReadinessTests(unittest.TestCase):
    def setUp(self):
        self.teams={"GB","CHI"}
        self.roster={"id1":"GB","id2":"GB","id3":"CHI"}
        self.rows=pd.DataFrame([
            dict(season=2026, week=8, team="GB",gsis_id="id1",
                 report_status=None,practice_status="Limited Participation"),
            dict(season=2026, week=8, team="GB",gsis_id="id2",
                 report_status=None,practice_status="Did Not Participate"),
        ])

    def test_practice_only_is_not_cleared(self):
        d=diagnose_injury_feed(self.rows,2026,8,self.teams,self.roster)
        self.assertEqual(d["report_stage"],"PRACTICE_ONLY_NO_GAME_DESIGNATIONS")
        self.assertEqual(d["matched_ids"],0)
        self.assertEqual(d["practice_flags"],2)
        self.assertEqual(d["teams_without_injury_rows"],["CHI"])
        self.assertFalse(d["official_game_day_active_confirmed"])

    def test_exact_identity_and_team_join_rejects_stale_team(self):
        rows=pd.concat([self.rows,pd.DataFrame([
            dict(season=2026,week=8,team="CHI",gsis_id="id1",
                 report_status="Out",practice_status="DNP"),
            dict(season=2026,week=8,team="CHI",gsis_id="unknown",
                 report_status="Questionable",practice_status="DNP"),
        ])],ignore_index=True)
        trusted=trusted_injury_rows(rows,2026,8,self.roster)
        self.assertEqual(len(trusted),2)
        self.assertEqual(availability(trusted,8),{})
        d=diagnose_injury_feed(rows,2026,8,self.teams,self.roster)
        self.assertEqual(d["stale_team_or_unmatched_id_rows"],2)
        self.assertEqual(d["matched_ids"],0)

    def test_real_designation_suppresses_out_only(self):
        rows=pd.concat([self.rows,pd.DataFrame([
            dict(season=2026,week=8,team="CHI",gsis_id="id3",
                 report_status="Out",practice_status="DNP"),
        ])],ignore_index=True)
        trusted=trusted_injury_rows(rows,2026,8,self.roster)
        self.assertEqual(availability(trusted,8),{"id3":"OUT"})
        d=diagnose_injury_feed(rows,2026,8,self.teams,self.roster)
        self.assertEqual(d["report_stage"],"GAME_DESIGNATIONS_PARTIAL")
        self.assertEqual(d["game_designations_reported"],1)
        self.assertFalse(d["official_game_day_active_confirmed"])

    def test_another_week_cannot_leak(self):
        previous=self.rows.copy()
        previous["week"]=7
        d=diagnose_injury_feed(previous,2026,8,self.teams,self.roster)
        self.assertEqual(d["report_stage"],"NO_CURRENT_WEEK_REPORT")
        self.assertEqual(len(trusted_injury_rows(previous,2026,8,self.roster)),0)

    def test_missing_data_is_unknown(self):
        d=diagnose_injury_feed(None,2026,8,self.teams,self.roster)
        self.assertEqual(d["report_stage"],"SOURCE_UNAVAILABLE")
        self.assertFalse(d["official_game_day_active_confirmed"])

    def test_full_practice_is_not_game_day_clearance(self):
        rows=pd.DataFrame([dict(season=2026,week=8,team="GB",gsis_id="id1",
                                report_status=None,practice_status="Full Participation")])
        d=diagnose_injury_feed(rows,2026,8,self.teams,self.roster)
        self.assertEqual(d["practice_flags"],0)
        self.assertFalse(d["official_game_day_active_confirmed"])


if __name__=="__main__":
    unittest.main()
