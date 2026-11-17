import copy
import unittest
from datetime import datetime, timedelta, timezone
import pandas as pd
from nfl_lineup_scenarios import build_scenario, joint_absence_shift, quarterback_basis

MODEL={'version':'opponent-score-ridge-v1','league_points':20,'home_advantage':0,'offense':{'A':0,'B':0},'defense_allowed':{'A':0,'B':0},'qb_effect':{'a':0,'b':0,'replacement':-4},'latest_qb':{'A':'a','B':'b'},'training_games':20}
PLAYERS=[{'team':'A','opp':'B','pos':'QB','player_id':'a','player':'A QB','availability':'ROSTER_ACTIVE'}, {'team':'B','opp':'A','pos':'QB','player_id':'b','player':'B QB','availability':'ROSTER_ACTIVE'}]
REPORT={'player_id':'p','player':'Missing receiver','position':'WR','designation':'OUT'}
NOW=datetime(2026,11,14,18,tzinfo=timezone.utc)

def depth(player_id='replacement', **changes):
    return {'team':'A','opp':'B','pos':'QB','player_id':player_id,'player':'Replacement',
            'depthChart':dict({'order':1,'unit':'first','position':'QB','sourceStatus':'ok','season':2026,
                'source':'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/1/depthcharts',
                'observedAt':NOW.isoformat(),'sourceUpdatedAt':(NOW-timedelta(minutes=4)).isoformat()},**changes)}

def announcement(player_id='replacement', **changes):
    return {'team':'A','opp':'B','pos':'QB','player_id':player_id,'player':'Replacement','qbRole':'EXPECTED_STARTER',
            'starterContext':dict({'source':'https://team.example/news','reported_at':NOW.isoformat(),
                'team':'A','opponent':'B','player_id':player_id,'season':2026,'week':10},**changes)}

def fixture():
    games=[];snaps=[]
    for week in range(1,10):
        games.append({'season':2026,'week':week,'game_id':f'g{week}','game_type':'REG','home_team':'A','away_team':'B','home_score':30 if week<=4 else 15,'away_score':20,'home_qb_id':'a','away_qb_id':'b','location':'Home'})
        for i in range(11):
            pid='pfr-p' if i==0 and week<=4 else f'other-{i}'
            snaps.append({'season':2026,'week':week,'team':'A','pfr_player_id':pid,'offense_pct':1,'defense_pct':1})
    return pd.DataFrame(games),pd.DataFrame(snaps),pd.DataFrame([{'gsis_id':'p','pfr_id':'pfr-p','team':'A'}])

class LineupScenariosTests(unittest.TestCase):
    def test_observed_joint_absence_changes_score_without_fabricated_penalty(self):
        games,snaps,roster=fixture()
        reports={'A':{'coverage':'REPORTED','reports':[REPORT]}}
        result=build_scenario(MODEL,games,snaps,roster,'A','B',PLAYERS,reports,2026,9)
        unit=result['injuries']['A']['units'][0]
        self.assertTrue(result['available']);self.assertTrue(unit['applied'])
        self.assertEqual(unit['present_games'],4);self.assertEqual(unit['absent_games'],4)
        self.assertEqual(unit['shift'],-5);self.assertEqual(result['home'],15);self.assertEqual(result['away'],20)
        self.assertEqual(result['quarterbacks']['A']['source'],'ASSUMED_LAST_OBSERVED_QB')
    def test_future_scores_and_snap_rows_cannot_change_current_scenario(self):
        games,snaps,roster=fixture();before=joint_absence_shift(MODEL,games,snaps,roster,'A',[REPORT],'offense',2026,9)
        games.loc[games.week==9,'home_score']=1000;snaps.loc[snaps.week==9,'offense_pct']=0
        self.assertEqual(before,joint_absence_shift(MODEL,games,snaps,roster,'A',[REPORT],'offense',2026,9))
    def test_missing_or_incomplete_snaps_do_not_prove_absence(self):
        games,snaps,roster=fixture();snaps=snaps[snaps.pfr_player_id!='other-4']
        result=joint_absence_shift(MODEL,games,snaps,roster,'A',[REPORT],'offense',2026,9)
        self.assertFalse(result['applied']);self.assertEqual(result['shift'],0)
        self.assertEqual(result['status'],'INSUFFICIENT_MATCHED_HISTORY')
    def test_before_first_team_appearance_is_not_an_injury_absence(self):
        games,snaps,roster=fixture();snaps.loc[(snaps.week<3)&(snaps.pfr_player_id=='pfr-p'),'pfr_player_id']='replacement'
        result=joint_absence_shift(MODEL,games,snaps,roster,'A',[REPORT],'offense',2026,9)
        self.assertEqual(result['present_games'],2);self.assertFalse(result['applied'])
    def test_current_out_qb_is_never_used_as_last_observed_proxy(self):
        result=quarterback_basis(MODEL,'A','B',PLAYERS,[{'player_id':'a','designation':'OUT'}])
        self.assertIsNone(result['player_id'])
    def test_expected_starter_effect_uses_sourced_identity_and_future_announcements_rejected(self):
        players=PLAYERS+[announcement()]
        q=quarterback_basis(MODEL,'A','B',players,[],season=2026,week=10,now=NOW);self.assertEqual(q['player_id'],'replacement');self.assertTrue(q['effect_available'])
        players[-1]['starterContext']['reported_at']='2099-01-01T12:00:00Z'
        self.assertEqual(quarterback_basis(MODEL,'A','B',players,[],season=2026,week=10,now=NOW)['player_id'],'a')

    def test_fresh_first_unit_depth_chart_supersedes_last_observed_qb_with_explicit_assumption(self):
        q=quarterback_basis(MODEL,'A','B',PLAYERS+[depth()],[],season=2026,week=10,now=NOW)
        self.assertEqual(q['player_id'],'replacement');self.assertEqual(q['source'],'SOURCED_DEPTH_CHART')
        self.assertTrue(q['effect_available']);self.assertIn('not confirmed',q['assumption'])
        self.assertEqual(q['source_url'],depth()['depthChart']['source'])
        self.assertEqual(q['source_observed_at'],NOW.isoformat())

    def test_stale_future_wrong_season_week_game_or_foreign_chart_does_not_authorize_replacement(self):
        for changes in [{'observedAt':(NOW-timedelta(hours=73)).isoformat()},
                        {'sourceUpdatedAt':(NOW-timedelta(hours=73)).isoformat()},
                        {'observedAt':(NOW+timedelta(seconds=1)).isoformat()},
                        {'season':2025},{'week':9},{'gameId':'other-game'},
                        {'team':'B'},{'opponent':'C'},{'source':'https://example.test/depthcharts'},
                        {'source':'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/1/depthcharts'},
                        {'sourceStatus':'unavailable'},{'sourceUpdatedAt':None}]:
            with self.subTest(changes=changes):
                q=quarterback_basis(MODEL,'A','B',PLAYERS+[depth(**changes)],[],season=2026,week=10,now=NOW,game_id='g10')
                self.assertEqual(q['player_id'],'a');self.assertEqual(q['source'],'ASSUMED_LAST_OBSERVED_QB')

    def test_conflicting_starting_sources_and_ambiguous_first_unit_stay_unresolved(self):
        for extra in [[announcement('a'),depth()], [depth(),depth('other')],
                      [announcement(),announcement('other')], [depth(),dict(depth(),player='Different record')]]:
            with self.subTest(extra=extra):
                original=[p for p in PLAYERS if p['player_id'] not in {r['player_id'] for r in extra}]
                q=quarterback_basis(MODEL,'A','B',original+extra,[],season=2026,week=10,now=NOW)
                self.assertIsNone(q['player_id']);self.assertEqual(q['source'],'UNRESOLVED')

    def test_known_unavailable_source_named_qb_never_falls_back_to_old_player(self):
        for status in ['OUT','DOUBTFUL','IR','INACTIVE']:
            q=quarterback_basis(MODEL,'A','B',PLAYERS+[depth()],[{'player_id':'replacement','designation':status}],season=2026,week=10,now=NOW)
            self.assertIsNone(q['player_id']);self.assertIn('blocked',q['assumption'])

    def test_questionable_stays_explicit_and_unknown_qb_effect_does_not_become_available(self):
        q=quarterback_basis(MODEL,'A','B',PLAYERS+[depth()],[{'player_id':'replacement','designation':'QUESTIONABLE'}],season=2026,week=10,now=NOW)
        self.assertEqual(q['player_id'],'replacement');self.assertEqual(q['availability'],'QUESTIONABLE')
        q=quarterback_basis(MODEL,'A','B',PLAYERS+[depth('untrained')],[],season=2026,week=10,now=NOW)
        self.assertEqual(q['player_id'],'untrained');self.assertFalse(q['effect_available'])

    def test_reserve_chart_is_not_silently_reused_as_last_observed_starter(self):
        players=[p for p in PLAYERS if p['player_id']!='a']+[depth('a',order=2,unit='reserve')]
        q=quarterback_basis(MODEL,'A','B',players,[],season=2026,week=10,now=NOW)
        self.assertIsNone(q['player_id'])

    def test_new_scenario_policy_keeps_questionable_report_visible_without_absence_shift(self):
        games,snaps,roster=fixture()
        reports={'A':{'coverage':'REPORTED_WITH_LIVE_SOURCE','reports':[{**REPORT,'designation':'QUESTIONABLE'}], 'live_report_count':1,'live_source':{'status':'ok'}}}
        result=build_scenario(MODEL,games,snaps,roster,'A','B',PLAYERS,reports,2026,9,now=NOW)
        self.assertEqual(result['version'],'nfl-qb-lineup-scenario-v2')
        self.assertEqual(result['injuries']['A']['reports'],reports['A']['reports'])
        self.assertEqual(result['injuries']['A']['live_report_count'],1)
        self.assertFalse(any(u['applied'] for u in result['injuries']['A']['units']))
    def test_unresolved_identity_and_no_supported_qb_are_explicit_gaps(self):
        games,snaps,roster=fixture();roster['team']='B'
        result=joint_absence_shift(MODEL,games,snaps,roster,'A',[REPORT],'offense',2026,9)
        self.assertEqual(result['status'],'UNRESOLVED_PLAYER_ID');self.assertFalse(result['applied'])
        result=build_scenario(MODEL,games,snaps,roster,'A','B',[],{},2026,9)
        self.assertFalse(result['available'])
