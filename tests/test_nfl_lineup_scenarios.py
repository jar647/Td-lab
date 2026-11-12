import copy
import unittest
import pandas as pd
from nfl_lineup_scenarios import build_scenario, joint_absence_shift, quarterback_basis

MODEL={'version':'opponent-score-ridge-v1','league_points':20,'home_advantage':0,'offense':{'A':0,'B':0},'defense_allowed':{'A':0,'B':0},'qb_effect':{'a':0,'b':0,'replacement':-4},'latest_qb':{'A':'a','B':'b'},'training_games':20}
PLAYERS=[{'team':'A','opp':'B','pos':'QB','player_id':'a','player':'A QB','availability':'ROSTER_ACTIVE'}, {'team':'B','opp':'A','pos':'QB','player_id':'b','player':'B QB','availability':'ROSTER_ACTIVE'}]
REPORT={'player_id':'p','player':'Missing receiver','position':'WR','designation':'OUT'}

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
        players=PLAYERS+[{'team':'A','opp':'B','pos':'QB','player_id':'replacement','player':'Replacement','qbRole':'EXPECTED_STARTER','starterContext':{'source':'https://team.example/news','reported_at':'2020-01-01T12:00:00Z'}}]
        q=quarterback_basis(MODEL,'A','B',players,[]);self.assertEqual(q['player_id'],'replacement');self.assertTrue(q['effect_available'])
        players[-1]['starterContext']['reported_at']='2099-01-01T12:00:00Z'
        self.assertEqual(quarterback_basis(MODEL,'A','B',players,[])['player_id'],'a')
    def test_unresolved_identity_and_no_supported_qb_are_explicit_gaps(self):
        games,snaps,roster=fixture();roster['team']='B'
        result=joint_absence_shift(MODEL,games,snaps,roster,'A',[REPORT],'offense',2026,9)
        self.assertEqual(result['status'],'UNRESOLVED_PLAYER_ID');self.assertFalse(result['applied'])
        result=build_scenario(MODEL,games,snaps,roster,'A','B',[],{},2026,9)
        self.assertFalse(result['available'])
