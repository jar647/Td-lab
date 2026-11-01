from copy import deepcopy
import unittest
from game_context import matchup_context
from game_picks import score_projection


def team(epa=0,success=.45):
    rates={'games':6,'plays':360,'epa_per_play':epa,'success_rate':success,'pass_epa':epa,'rush_epa':epa,'pass_rate':.6}
    return {'offense':deepcopy(rates),'defense':deepcopy(rates),
            'league':{'epa_per_play':0,'pass_epa':0,'rush_epa':0,'success_rate':.45}}


def effect(offense,defense):
    return matchup_context(offense,defense)['home_offense_vs_away_defense']['score_adjustment']


class DirectionTests(unittest.TestCase):
    def test_worse_defense_increases_score_and_better_defense_reduces_it(self):
        average=team();weak=team(.2,.55);strong=team(-.2,.35)
        self.assertGreater(effect(average,weak),effect(average,average))
        self.assertLess(effect(average,strong),effect(average,average))
        self.assertEqual(effect(average,average),0)

    def test_better_offense_increases_score(self):
        self.assertGreater(effect(team(.2,.55),team()),effect(team(),team()))

    def test_league_center_is_not_assumed_zero_success(self):
        a=team(.1,.5);a['league']={'epa_per_play':.1,'pass_epa':.1,'rush_epa':.1,'success_rate':.5}
        self.assertAlmostEqual(effect(a,a),0)

    def test_neutral_site_ignores_designated_home_splits_and_advantage(self):
        rates={'offense':22,'defense_allowed':22,'home_games':6,'away_games':6,
               'home_offense':40,'home_defense_allowed':10,'away_offense':10,'away_defense_allowed':40}
        self.assertEqual(score_projection(rates,rates,neutral=True),(22,22))
        self.assertNotEqual(score_projection(rates,rates), (22,22))
