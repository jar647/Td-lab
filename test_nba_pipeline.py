import copy
import datetime as dt
import json
import pathlib
import tempfile
import unittest
from nba_pipeline import analyze, fresh, publish, UTC, quote_key
from nba_model import allocate_minutes,build_projection,completed_history,simulate,number,availability,MODEL

class PipelineTests(unittest.TestCase):
 def setUp(self):
  self.now=dt.datetime(2026,11,1,12,tzinfo=UTC)
  self.feed={'generated_at':self.now.isoformat(),'games':[]}
  for i in range(8):
   self.feed['games'].append({'id':str(i),'date':(self.now-dt.timedelta(days=i+1)).isoformat(),'status':'STATUS_FINAL','season_type':2,'home':'A','away':'B','players':[{'id':team+str(j),'name':team+str(j),'team':team,'starter':j<5,'stats':{'MIN':'30:00','PTS':10+(i+j)%15,'REB':3+(i+j)%5,'AST':2+(i+j)%4}} for team in ['A','B'] for j in range(8)]})
  self.feed['games'].append({'id':'next','date':(self.now+dt.timedelta(hours=4)).isoformat(),'status':'STATUS_SCHEDULED','home':'A','away':'B','players':[]})
  self.inj={'generated_at':self.now.isoformat(),'injuries':[]}
  self.rosters={'generated_at':self.now.isoformat(),'teams':{t:[t+str(j) for j in range(8)] for t in ['A','B']}}
 def analyze(self,odds=None,now=None):return analyze(self.feed,self.inj,self.rosters,odds or {},now or self.now,runs=100)
 def prices(self):
  return {'generated_at':self.now.isoformat(),'markets':[{'game_id':'next','player_id':p,'market':'points','side':'over','line':1.5,'american_odds':-110,'bookmaker':'hardrockbet'} for p in ['A0','B0']]}
 def combined(self,odds,book='hardrockbet'):
  odds['sgp_quotes']=[{'game_id':'next','legs':['A0:points:over:1.5','B0:points:over:1.5'],'decimal_odds':4,'bookmaker':book}]
 def test_missing_prices_is_explicit_and_has_projections(self):
  a=self.analyze()[0]
  self.assertIsNone(a['sgp']);self.assertIn('Missing/stale sportsbook prices',a['reasons']);self.assertEqual(len(a['projections']),112)
 def test_out_excluded_and_minutes_redistributed(self):
  base=self.analyze()[0]
  self.inj['injuries']=[{'player':'A0','status':'Out'}];a=self.analyze()[0]
  self.assertTrue(all(p['player']!='A0' for p in a['projections']))
  rotation=[p for p in a['rotation'] if p['team']=='A']
  self.assertAlmostEqual(sum(p['minutes'] for p in rotation),240,places=1)
  self.assertGreater(rotation[0]['minutes'],base['rotation'][1]['minutes'])
 def test_minutes_cap_and_impossible_roster(self):
  self.assertIsNone(allocate_minutes({'one':30}))
  mins=allocate_minutes({str(i):100 if i==0 else 20 for i in range(8)})
  self.assertAlmostEqual(sum(mins.values()),240);self.assertLessEqual(max(mins.values()),40)
 def test_no_post_tip_analysis(self):self.assertEqual(self.analyze(now=self.now+dt.timedelta(days=1)),[])
 def test_future_and_naive_timestamp_rejected(self):
  self.assertFalse(fresh({'generated_at':(self.now+dt.timedelta(seconds=1)).isoformat()},self.now,6))
  self.assertFalse(fresh({'generated_at':'2026-11-01T12:00:00'},self.now,6))
 def test_actual_same_book_combined_quote_required(self):
  odds=self.prices();self.assertIsNone(self.analyze(odds)[0]['sgp'])
  self.combined(odds,'otherbook');self.assertIsNone(self.analyze(odds)[0]['sgp'])
  self.combined(odds);a=self.analyze(odds)[0]
  self.assertEqual(a['status'],'RESEARCH LEAN');self.assertEqual(len(a['sgp']['legs']),2)
  odds['generated_at']=(self.now-dt.timedelta(hours=2)).isoformat()
  self.assertIsNone(self.analyze(odds)[0]['sgp'])
 def test_stale_combined_quote_not_redated(self):
  odds=self.prices();self.combined(odds)
  odds['sgp_quotes'][0]['observed_at']=(self.now-dt.timedelta(hours=2)).isoformat()
  self.assertIsNone(self.analyze(odds)[0]['sgp'])
 def test_invalid_and_duplicate_legs_rejected(self):
  odds=self.prices();self.combined(odds)
  odds['sgp_quotes'][0]['legs']*=2
  self.assertIsNone(self.analyze(odds)[0]['sgp'])
  odds['markets'][0]['american_odds']=float('nan');self.combined(odds)
  self.assertIsNone(self.analyze(odds)[0]['sgp'])
 def test_unresolved_rotation_blocks(self):
  self.inj['injuries']=[{'player':'A0','status':'Questionable'}]
  a=self.analyze()[0];self.assertTrue(any('availability' in r for r in a['blockers']));self.assertIsNone(a['best_single'])
 def test_unknown_injury_and_incomplete_roster(self):
  self.inj['injuries']=[{'player':'A0','status':'Something new'}]
  self.assertTrue(any('availability' in r for r in self.analyze()[0]['blockers']))
  self.rosters['teams']['A']=None
  self.assertTrue(any('rotation evidence' in r for r in self.analyze()[0]['blockers']))
 def test_postgame_history_excluded(self):
  first=self.analyze()[0]['projections']
  self.feed['games'].append({**self.feed['games'][0],'id':'future','date':(self.now+dt.timedelta(days=2)).isoformat()})
  self.assertEqual(first,self.analyze()[0]['projections'])
 def test_missing_or_preseason_type_cannot_enter_history(self):
  original=self.feed['games'][0].copy()
  self.feed['games'][0]['season_type']=1
  history=completed_history(self.feed,self.now)
  self.assertNotIn(original['id'],[g['id'] for g in history])
  del self.feed['games'][0]['season_type']
  self.assertNotIn(original['id'],[g['id'] for g in completed_history(self.feed,self.now)])
 def test_combo_draws_equal_components_and_reproducible(self):
  args=build_projection(self.feed['games'][-1],completed_history(self.feed,self.now),self.inj,self.rosters)
  ps,_,_,teams,_,sd=args
  draws,cov=simulate(self.feed['games'][-1],ps,teams,sd,100)
  lookup={(p['player_id'],p['market']):i for i,p in enumerate(ps)}
  for n in range(100):
   self.assertEqual(draws[lookup['A0','pra']][n],sum(draws[lookup['A0',m]][n] for m in ('points','rebounds','assists')))
  self.assertEqual(draws,simulate(self.feed['games'][-1],ps,teams,sd,100)[0])
 def test_singles_independent_of_sgp_availability(self):
  odds=self.prices()
  for q in odds['markets']:q['line']=11.5;q['american_odds']=200
  a=self.analyze(odds)[0]
  self.assertIsNone(a['sgp']);self.assertIsNotNone(a['best_single'])
 def test_push_aware_single_ev(self):
  from nba_pipeline import grade_stats
  self.assertAlmostEqual(grade_stats([1,0,-1,1],2)['estimated_ev'],.25)
 def test_lock_immutable_revisions_and_grade_repair(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=pathlib.Path(tmp);(root/'data').mkdir()
   def save():
    for name,data in [('nba_games',self.feed),('nba_injuries',self.inj),('nba_rosters',self.rosters)]:
     (root/'data'/f'{name}.json').write_text(json.dumps(data))
   save();publish(root,self.now)
   path=root/'data/nba_pipeline_locks.json';first=json.loads(path.read_text())['snapshots'][0]
   self.inj['injuries']=[{'player':'A0','status':'Out'}];save();publish(root,self.now+dt.timedelta(minutes=10))
   revisions=json.loads(path.read_text())['snapshots'];self.assertEqual(len(revisions),2);self.assertEqual(first,revisions[0])
   self.feed['games'][-1].update(status='STATUS_FINAL',players=self.feed['games'][0]['players'][:-1]);save()
   publish(root,self.now+dt.timedelta(hours=8));self.assertIsNone(json.loads(path.read_text())['snapshots'][0]['grades'])
   self.feed['games'][-1]['players']=self.feed['games'][0]['players'];save();publish(root,self.now+dt.timedelta(hours=9))
   final=json.loads(path.read_text())['snapshots'][0]
   self.assertEqual(first['projections'],final['projections']);self.assertEqual(first['locked_at'],final['locked_at']);self.assertEqual(len(final['grades']),112)
   report=json.loads((root/'data/nba_analysis.json').read_text())['audit'];self.assertEqual(report['graded_games'],1)
if __name__=='__main__':unittest.main()
