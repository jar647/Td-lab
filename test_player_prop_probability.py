"""Unit checks for historical-prop evaluation. Run: python -m unittest test_player_prop_probability.py"""
import unittest
import pandas as pd
from player_prop_probability_backtest import observations, calibrate, evaluate
from opportunity_prop_model import opportunity_probability

class PropProbabilityTests(unittest.TestCase):
    def synthetic(self):
        rows=[]
        for season in (2024, 2025):
            for week in range(1, 9):
                rows.append(dict(player_id="receiver1",position="WR",season=season,
                    season_type="REG",week=week,game_id=f"{season}_{week}",
                    passing_yards=0,rushing_yards=0,
                    attempts=0,carries=0,targets=0 if week in (3,6,8) else 8,
                    receiving_yards=0 if week in (3,6,8) else 55,
                    receptions=0 if week in (3,6,8) else 4))
        return pd.DataFrame(rows)

    def test_zero_receiving_game_recorded(self):
        results=observations(self.synthetic())
        rows=[r for r in results if r["season"]==2024 and
              r["market"]=="receiving_yards" and r["threshold"]==49.5]
        self.assertEqual(len(rows),3)
        # Week 6 has zero receiving yards and must be a miss.
        self.assertEqual(rows[0]["week"],6)
        self.assertEqual(rows[0]["hit"],0)

    def test_only_prior_weeks_determine_probability(self):
        before=self.synthetic()
        first=[r for r in observations(before) if r["season"]==2024 and
               r["week"]==6 and r["market"]=="receptions" and r["threshold"]==3.5][0]
        after=before.copy()
        after.loc[(after.season==2024)&(after.week==7),"receptions"]=99
        second=[r for r in observations(after) if r["season"]==2024 and
                r["week"]==6 and r["market"]=="receptions" and r["threshold"]==3.5][0]
        self.assertEqual((first["baseline"],first["recent"]),
                         (second["baseline"],second["recent"]))

    def test_zero_volume_preserved(self):
        probability=opportunity_probability([0, 10, 10, 10, 10], [0, 5, 5, 5, 5], 0.5)
        self.assertLess(probability, 1)
        self.assertGreater(probability, 0)

    def test_future_volume_does_not_change_prior_prediction(self):
        before=self.synthetic()
        a=[r for r in observations(before) if r["season"]==2024 and r["week"]==6
           and r["market"]=="receiving_yards" and r["threshold"]==49.5][0]
        after=before.copy()
        after.loc[(after.season==2024)&(after.week==7),"targets"]=100
        b=[r for r in observations(after) if r["season"]==2024 and r["week"]==6
           and r["market"]=="receiving_yards" and r["threshold"]==49.5][0]
        self.assertEqual(a["opportunity_candidate"], b["opportunity_candidate"])

    def test_train_only_weight_and_metrics(self):
        train=[dict(hit=y,baseline=.4,recent=.8) for y in (0,0,0,0,1)]
        weight=calibrate(train)
        self.assertEqual(weight,0)
        scored=evaluate(train,weight)
        self.assertEqual(scored["model_brier"],scored["baseline_brier"])
        self.assertFalse(scored["beats_baseline"])

if __name__=="__main__":
    unittest.main()
