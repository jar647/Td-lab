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

    def test_situational_rates_are_from_pregame_plays_only(self):
        data = self.rows()
        for row in data:
            row.update(success=1 if row['posteam'] == 'A' else 0,
                       sack=0, interception=0, fumble_lost=0,
                       down=3, first_down=1 if row['posteam'] == 'A' else 0,
                       rush_touchdown=1 if row['posteam'] == 'A' else 0,
                       yardline_100=15, yards_gained=12 if row['posteam'] == 'A' else 2)
        # A target-week explosion must NEVER influence season-to-date features.
        future = {**data[0], 'week': 4, 'game_id': 'future', 'play_id': 'future',
                  'yards_gained': 99, 'success': 0}
        data.append(future)
        filtered = _eligible_rows(data, 2026, 4)
        self.assertEqual(len(filtered), 240)
        profile = _opportunity(filtered, 'run', 'A', 'B', {}, {})
        factors = profile['situational']
        self.assertIn('success', factors)
        self.assertIn('explosive', factors)
        self.assertIn('turnover', factors)
        self.assertIn('third_conversion', factors)
        self.assertIn('red_zone_td', factors)
        self.assertNotIn('sack', factors)
        self.assertAlmostEqual(factors['success']['offense_rate'], 1)
        self.assertAlmostEqual(factors['explosive']['offense_rate'], 1)
        self.assertAlmostEqual(profile['rushing_yards']['offense_yards_per_carry'], 12)

    def test_missing_flags_are_not_zero_imputed(self):
        profile = _opportunity(_eligible_rows(self.rows(), 2026, 4), 'run', 'A', 'B', {}, {})
        self.assertEqual(set(profile['situational']), {'explosive'}, 'Only actual yardage can support an explosive-play rate; missing success, turnover and third-down flags must stay absent')
        self.assertIsNone(profile['passing_yards'])

    def test_pass_yardage_and_sack_proxy(self):
        rows = []
        for week in (1, 2, 3):
            for off, defense in (('A','B'), ('C','D'), ('D','C'), ('E','C')):
                for idx in range(20):
                    rows.append(dict(season=2026, week=week, season_type='REG',
                                     game_id=f'{week}-{off}-{defense}', play_id=str(idx),
                                     posteam=off, defteam=defense, play_type='pass',
                                     epa=.1, yards_gained=7, success=1,
                                     interception=0, fumble_lost=0, sack=int(idx % 10 == 0)))
        profile = _opportunity(_eligible_rows(rows, 2026, 4), 'pass', 'A', 'B', {}, {})
        self.assertIsNotNone(profile['passing_yards'])
        self.assertAlmostEqual(profile['passing_yards']['offense_net_yards_per_play'], 7)
        self.assertIn('sack', profile['situational'])
        self.assertAlmostEqual(profile['situational']['sack']['offense_rate'], .1)
        self.assertIsNone(profile['rushing_yards'])

    def test_missing_yardage_does_not_fabricate_yards(self):
        data=self.rows()
        for row in data:
            row.pop('yards_gained',None)
        result=_opportunity(_eligible_rows(data,2026,4),'run','A','B',{}, {})
        self.assertTrue(result['available'])
        self.assertIsNone(result['rushing_yards'])


if __name__=='__main__':
    unittest.main()
