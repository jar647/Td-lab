import unittest
from nfl_deep_research import earlier_plays, team_research, summarize, opponent_adjustment
from nfl_weather import kickoff_utc, forecast_for_game


def play(week,off='A',defense='B',epa=.2,**kw):
    return dict(season=2026,week=week,season_type='REG',game_id=f'{week}-{off}-{defense}',posteam=off,defteam=defense,
                play_type='pass',epa=epa,success=1,down=1,qtr=1,wp=.5,yards_gained=25,drive=1,yardline_100=15,
                touchdown=0,sack=0,qb_hit=0,xpass=.6,**kw)


class DeepResearchTests(unittest.TestCase):
    def test_entire_target_week_future_and_no_play_are_excluded(self):
        rows=[play(1),play(2),play(3,epa=99),play(4,epa=99),play(1,no_play=1)]
        prior=earlier_plays(rows,2026,3)
        self.assertEqual(len(prior),2)
        output=team_research(prior,'A')
        self.assertEqual(output['offense']['season']['pass_epa'],.2)
        self.assertEqual(output['offense']['recent']['games'],2)

    def test_missing_rates_are_unknown_not_zero(self):
        output=summarize([], 'A','offense')
        for key in ('pass_epa','sack_rate','third_down_conversion','redzone_td_drive_rate'):
            self.assertIsNone(output[key])
        row=play(1);row.pop('sack');row.pop('qb_hit');row.pop('xpass')
        output=summarize([row],'A','offense')
        self.assertIsNone(output['sack_rate'])
        self.assertIsNone(output['pass_rate_above_expected'])
        self.assertEqual(output['redzone_td_drive_rate'],0)

    def test_schedule_adjustment_uses_opponents_other_earlier_games(self):
        rows=[]
        for week in (1,2,3):
            rows += [play(week) for _ in range(20)]
            rows += [play(week,off='C',defense='B',epa=.4) for _ in range(20)]
        result=opponent_adjustment(rows,'A','offense')
        self.assertTrue(result['available'])
        self.assertAlmostEqual(result['opponent_other_game_epa'],.4)
        self.assertLess(result['adjusted_epa'],result['raw_epa'])

    def test_kickoff_is_eastern_for_every_stadium_and_dst(self):
        for team in ('GB','SEA','ARI','NYG'):
            self.assertEqual(kickoff_utc({'gameday':'2026-11-01','gametime':'13:00'},team).hour,18)
            self.assertEqual(kickoff_utc({'gameday':'2026-10-25','gametime':'13:00'},team).hour,17)
        self.assertFalse(forecast_for_game({'location':'Neutral'},'JAX')['available'])
