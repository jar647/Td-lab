"""Historical outcome eligibility tests. Zero-use ≠ inactive/DNP."""
import unittest
import pandas as pd
from historical_participation import snap_verified_weekly

class SnapVerifiedHistoryTests(unittest.TestCase):
    def fixture(self):
        weekly=pd.DataFrame([
            dict(season=2025,week=1,game_id="g1",player_id="id1",recent_team="GB",
                 passing_yards=0,rushing_yards=0,receiving_yards=50,
                 receptions=4,attempts=0,carries=0,targets=6),
        ])
        roster=pd.DataFrame([
            dict(gsis_id="id1",pfr_id="pfr1",position="WR",team="GB"),
            dict(gsis_id="id2",pfr_id="pfr2",position="WR",team="GB"),
            dict(gsis_id="id3",pfr_id="pfr3",position="WR",team="GB"),
        ])
        snaps=pd.DataFrame([
            dict(season=2025,week=1,team="GB",pfr_player_id="pfr1",offense_pct=90),
            dict(season=2025,week=1,team="GB",pfr_player_id="pfr2",offense_pct=20),
            dict(season=2025,week=1,team="GB",pfr_player_id="pfr3",offense_pct=0),
        ])
        sched=pd.DataFrame([
            dict(season=2025,week=1,game_type="REG",home_team="GB",away_team="CHI",game_id="g1"),
        ])
        return weekly,roster,snaps,sched

    def test_true_zero_from_offensive_snaps_is_included(self):
        result=snap_verified_weekly(*self.fixture(),2025)
        self.assertEqual(set(result.player_id),{"id1","id2"})
        zero=result[result.player_id=="id2"].iloc[0]
        self.assertEqual(zero.receiving_yards,0)
        self.assertEqual(zero.receptions,0)
        self.assertFalse(zero.boxscore_row_present)

    def test_zero_snap_is_not_a_zero_stat_observation(self):
        result=snap_verified_weekly(*self.fixture(),2025)
        self.assertNotIn("id3",set(result.player_id))

    def test_ambiguous_pfr_mapping_not_used(self):
        w,r,s,g=self.fixture()
        r=pd.concat([r,pd.DataFrame([dict(gsis_id="id_different",pfr_id="pfr2",position="WR",team="GB")])],ignore_index=True)
        result=snap_verified_weekly(w,r,s,g,2025)
        self.assertNotIn("id2",set(result.player_id))

    def test_mismatched_game_or_team_not_backfilled(self):
        w,r,s,g=self.fixture()
        w.loc[0,"recent_team"]="CHI"
        result=snap_verified_weekly(w,r,s,g,2025)
        entry=result[result.player_id=="id1"].iloc[0]
        self.assertFalse(entry.boxscore_row_present)

if __name__ == "__main__":
    unittest.main()
