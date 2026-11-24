"""NFL opponent rushing evidence uses earlier completed games and keeps low yardage."""
import unittest
from nfl_matchup_research import _eligible_rows, _opportunity


class RushingOpportunityTests(unittest.TestCase):
    def rows(self):
        out=[]
        for week in (1,2,3):
            for offense, defense, yards, epa in (
                ('A','B',2.0,-.2),
                ('C','D',5.0,.12),
                ('D','C',6.0,.15),
                ('E','C',4.0,-.03),
            ):
                for i in range(20):
                    out.append({'season':2026,'week':week,'season_type':'REG',
                        'game_id':f'2026_{week}_{offense}_{defense}',
                        'play_id':f'{week}_{offense}_{defense}_{i}',
                        'posteam':offense,'defteam':defense,'play_type':'run',
                        'epa':epa,'yards_gained':yards})
        return out

    def test_prior_only_rushing_allowance(self):
        rows=_eligible_rows(self.rows(),2026,4)
        self.assertEqual(len(rows),240)
        result=_opportunity(rows,'run','A','B',{}, {})
        self.assertTrue(result['available'])
        self.assertIsNotNone(result['rushing_yards'])
        self.assertAlmostEqual(result['rushing_yards']['offense_yards_per_carry'],2)
        self.assertAlmostEqual(result['rushing_yards']['opponent_yards_allowed_per_carry'],2)
        self.assertEqual(result['rushing_yards']['offense_carries_per_game'],20)

    def test_does_not_use_target_week(self):
        data=self.rows()
        data.append({'season':2026,'week':4,'season_type':'REG',
            'game_id':'2026_04_A_B','play_id':'later','posteam':'A',
            'defteam':'B','play_type':'run','epa':2.5,'yards_gained':99})
        rows=_eligible_rows(data,2026,4)
        result=_opportunity(rows,'run','A','B',{}, {})
        self.assertEqual(len(rows),240)
        self.assertEqual(result['rushing_yards']['offense_yards_per_carry'],2)

    def test_missing_yardage_does_not_fabricate_yards(self):
        data=self.rows()
        for row in data:
            row.pop('yards_gained',None)
        result=_opportunity(_eligible_rows(data,2026,4),'run','A','B',{}, {})
        self.assertTrue(result['available'])
        self.assertIsNone(result['rushing_yards'])


if __name__=='__main__':
    unittest.main()
