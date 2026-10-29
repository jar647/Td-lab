import unittest
import pandas as pd
from nfl_research import enrich_research, injury_research


def game(season,week,h,a,hs,aws,hc='Coach A',ac='Coach B',kind='REG'):
    return dict(season=season,week=week,home_team=h,away_team=a,home_score=hs,
                away_score=aws,home_coach=hc,away_coach=ac,game_type=kind,
                game_id=f'{season}_{week}_{a}_{h}',gameday=f'{season}-09-01')


class ResearchTests(unittest.TestCase):
    def test_actual_scoring_and_career_exclude_target_future_and_playoffs(self):
        schedules=pd.DataFrame([
            game(2025,1,'A','B',30,10),game(2025,19,'A','B',7,20,kind='WC'),
            game(2026,1,'A','B',14,21),game(2026,2,'B','A',28,24,hc='Coach B',ac='Coach A'),
            game(2026,3,'A','B',99,0),game(2027,1,'A','B',100,0)])
        ctx={'teams':{'A':{'coach':'Coach A'}}}
        output=enrich_research(ctx,schedules,2026,3,{})
        facts=output['teams']['A']
        self.assertEqual(facts['scoring']['season']['points_per_game'],19)
        self.assertEqual(facts['scoring']['season']['points_allowed_per_game'],24.5)
        self.assertEqual(facts['scoring']['home']['games'],1)
        self.assertEqual(facts['scoring']['road']['points_per_game'],24)
        self.assertEqual(facts['coach_career']['regular_season']['games'],3)
        self.assertEqual(facts['coach_career']['regular_season']['wins'],1)
        self.assertEqual(facts['coach_career']['playoffs']['losses'],1)
        self.assertEqual(output['research']['through_week'],2)

    def test_out_players_survive_research_and_old_team_rows_are_rejected(self):
        injuries=pd.DataFrame([
            dict(season=2026,week=3,gsis_id='p1',team='A',report_status='Out',practice_status='DNP'),
            dict(season=2026,week=3,gsis_id='p2',team='A',report_status='Questionable'),
            dict(season=2026,week=2,gsis_id='p3',team='A',report_status='Out')])
        roster=pd.DataFrame([dict(gsis_id='p1',team='A',full_name='Player Out'),
                             dict(gsis_id='p2',team='B'),dict(gsis_id='p3',team='A')])
        reports=injury_research(injuries,roster,2026,3,['A','B'])
        self.assertEqual(reports['A']['report_count'],1)
        self.assertEqual(reports['A']['reports'][0]['player'],'Player Out')
        self.assertEqual(reports['A']['reports'][0]['designation'],'Out')
        self.assertEqual(reports['B']['coverage'],'NO_MATCHED_CURRENT_WEEK_REPORT')
        self.assertFalse(reports['A']['official_inactives_confirmed'])

    def test_source_failure_and_empty_samples_do_not_imply_healthy_or_zero_average(self):
        reports=injury_research(None,None,2026,1,['A'])
        self.assertEqual(reports['A']['report_count'],0)
        self.assertEqual(reports['A']['diagnostics']['report_stage'],'SOURCE_UNAVAILABLE')
        schedules=pd.DataFrame([game(2026,1,'A','B',None,None)])
        ctx=enrich_research({'teams':{'A':{'coach':'Coach A'}}},schedules,2026,1,reports)
        self.assertIsNone(ctx['teams']['A']['scoring']['season']['points_per_game'])


if __name__=='__main__': unittest.main()
