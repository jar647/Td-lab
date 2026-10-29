import unittest

from game_context import adjusted_projection, matchup_context, team_context, travel_estimate


def plays(week, game_id, offense_epa, defense_epa, offense, defense):
    return [
        {"season":2026,"week":week,"season_type":"REG","game_id":game_id,
         "posteam":offense,"defteam":defense,"play_type":"pass","epa":offense_epa,
         "success":int(offense_epa>0),"yards_gained":24,"pass_attempt":1,
         "sack":0,"interception":0,"fumble_lost":0},
        {"season":2026,"week":week,"season_type":"REG","game_id":game_id,
         "posteam":defense,"defteam":offense,"play_type":"run","epa":defense_epa,
         "success":int(defense_epa>0),"yards_gained":3,"no_play":0,
         "sack":0,"interception":0,"fumble_lost":0},
    ]


class GameContextTests(unittest.TestCase):
    def test_pregame_team_rates_exclude_target_and_future_weeks(self):
        rows=[]
        for week in range(1,8):
            rows+=plays(week,f"g{week}",.5,-.3,"A","B")
        ctx=team_context(rows,2026,5,"A")
        self.assertEqual(ctx["offense"]["games"],4)
        self.assertEqual(ctx["defense"]["games"],4)
        self.assertAlmostEqual(ctx["offense"]["epa_per_play"],.5)
        self.assertEqual(ctx["recent_offense"]["games"],4)

    def test_recent_form_uses_only_the_latest_four_prior_games(self):
        rows=[]
        for week in range(1,8):
            rows+=plays(week,f"form{week}",week/10,-.3,"A","B")
        ctx=team_context(rows,2026,7,"A")
        self.assertEqual(ctx["offense"]["games"],6)
        self.assertEqual(ctx["recent_offense"]["games"],4)
        self.assertAlmostEqual(ctx["recent_offense"]["epa_per_play"],.45)

    def test_matchup_adjustment_uses_both_sides_of_the_ball(self):
        rows=[]
        for week in range(1,5):
            rows+=plays(week,f"a{week}",.6,-.2,"A","X")
            rows+=plays(week,f"b{week}",-.5,-.4,"X","B")
            rows+=plays(week,f"c{week}",-.5,.2,"B","X")
            rows+=plays(week,f"d{week}",.5,.4,"X","A")
        a=team_context(rows,2026,5,"A")
        b=team_context(rows,2026,5,"B")
        result=matchup_context(a,b)
        self.assertTrue(result["home_offense_vs_away_defense"]["available"])
        self.assertGreater(result["home_offense_vs_away_defense"]["score_adjustment"],0)
        self.assertLess(result["away_offense_vs_home_defense"]["score_adjustment"],0)
        home,away=adjusted_projection(24,21,result)
        self.assertGreater(home,24)
        self.assertLess(away,21)

    def test_insufficient_sample_does_not_create_adjustment(self):
        rows=plays(1,"g1",.9,-.9,"A","B")
        matchup=matchup_context(team_context(rows,2026,2,"A"),team_context(rows,2026,2,"B"))
        self.assertFalse(matchup["home_offense_vs_away_defense"]["available"])
        self.assertEqual(matchup["home_offense_vs_away_defense"]["score_adjustment"],0)

    def test_travel_is_an_estimate_and_neutral_venues_are_missing(self):
        known=travel_estimate("ARI","BUF")
        self.assertTrue(known["available"])
        self.assertGreater(known["air_distance_miles"],1500)
        self.assertIn("actual charter route",known["warning"])
        self.assertFalse(travel_estimate("ARI","BUF",True)["available"])


if __name__=="__main__":
    unittest.main()
