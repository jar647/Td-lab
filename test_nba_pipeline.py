import datetime as dt
import json
import pathlib
import tempfile
import unittest
from nba_pipeline import analyze, fresh, publish, UTC

class PipelineTests(unittest.TestCase):
 def setUp(self):
  self.now=dt.datetime(2026,11,1,12,tzinfo=UTC)
  self.feed={'generated_at':self.now.isoformat(),'games':[]}
  for i in range(8):
   self.feed['games'].append({'id':str(i),'date':(self.now-dt.timedelta(days=i+1)).isoformat(),'status':'STATUS_FINAL','home':'A','away':'B','players':[{'id':team,'name':team,'team':team,'stats':{'MIN':'30:00','PTS':20+i,'REB':8,'AST':5}} for team in ['A','B']]})
  self.feed['games'].append({'id':'next','date':(self.now+dt.timedelta(hours=4)).isoformat(),'status':'STATUS_SCHEDULED','home':'A','away':'B','players':[]})
  self.inj={'generated_at':self.now.isoformat(),'injuries':[]}
  self.rosters={'generated_at':self.now.isoformat(),'teams':{'A':['A'],'B':['B']}}
 def test_missing_prices_pass_and_projections(self):
  a=analyze(self.feed,self.inj,self.rosters,{},self.now,runs=50)[0]
  self.assertEqual(a['status'],'PASS');self.assertEqual(len(a['projections']),6)
 def test_out_excluded(self):
  self.inj['injuries']=[{'player':'A','status':'Out'}]
  a=analyze(self.feed,self.inj,self.rosters,{},self.now,runs=50)[0]
  self.assertTrue(all(p['player']!='A' for p in a['projections']))
 def test_no_post_tip_analysis(self):
  self.assertEqual(analyze(self.feed,self.inj,self.rosters,{},self.now+dt.timedelta(days=1),50),[])
 def test_future_timestamp_rejected(self):
  self.assertFalse(fresh({'generated_at':(self.now+dt.timedelta(seconds=1)).isoformat()},self.now,6))
 def test_real_combined_quote_required(self):
  odds={'generated_at':self.now.isoformat(),'markets':[{'game_id':'next','player_id':p,'market':'points','side':'over','line':10.5,'american_odds':-110} for p in ['A','B']]}
  a=analyze(self.feed,self.inj,self.rosters,odds,self.now,100)[0]
  self.assertIsNone(a['sgp'])
  odds['sgp_quotes']=[{'game_id':'next','legs':['A:points:over:10.5','B:points:over:10.5'],'decimal_odds':4}]
  a=analyze(self.feed,self.inj,self.rosters,odds,self.now,100)[0]
  self.assertEqual(a['status'],'RESEARCH LEAN');self.assertEqual(len(a['sgp']['legs']),2)
  odds['generated_at']=(self.now-dt.timedelta(hours=2)).isoformat()
  self.assertEqual(analyze(self.feed,self.inj,self.rosters,odds,self.now,100)[0]['status'],'PASS')
 def test_unresolved_rotation_blocks(self):
  self.inj['injuries']=[{'player':'A','status':'Questionable'}]
  a=analyze(self.feed,self.inj,self.rosters,{},self.now,50)[0]
  self.assertTrue(any('availability' in r for r in a['reasons']))
 def test_postgame_history_excluded(self):
  first=analyze(self.feed,self.inj,self.rosters,{},self.now,50)[0]['projections']
  self.feed['games'].append({**self.feed['games'][0],'id':'future','date':(self.now+dt.timedelta(days=2)).isoformat()})
  self.assertEqual(first,analyze(self.feed,self.inj,self.rosters,{},self.now,50)[0]['projections'])
 def test_lock_immutable_and_grade(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=pathlib.Path(tmp);(root/'data').mkdir()
   for name,data in [('nba_games',self.feed),('nba_injuries',self.inj),('nba_rosters',self.rosters)]:
    (root/'data'/f'{name}.json').write_text(json.dumps(data))
   publish(root,self.now)
   path=root/'data/nba_pipeline_locks.json';first=json.loads(path.read_text())['snapshots'][0]
   self.feed['games'][-1].update(status='STATUS_FINAL',players=self.feed['games'][0]['players'])
   (root/'data/nba_games.json').write_text(json.dumps(self.feed))
   publish(root,self.now+dt.timedelta(hours=8))
   final=json.loads(path.read_text())['snapshots'][0]
   self.assertEqual(first['projections'],final['projections']);self.assertEqual(first['locked_at'],final['locked_at']);self.assertEqual(len(final['grades']),6)
if __name__=='__main__':unittest.main()
