"""Regression checks for NBA tracker pre-tip lock and grading integrity."""
import datetime,json,pathlib,subprocess,sys,tempfile,unittest
TRACKER=pathlib.Path(__file__).with_name('nba_tracker.py')
class TrackerIntegrityTests(unittest.TestCase):
 def run_tracker(self,games,snapshots):
  with tempfile.TemporaryDirectory() as directory:
   root=pathlib.Path(directory);(root/'data').mkdir()
   (root/'nba_tracker.py').write_bytes(TRACKER.read_bytes())
   (root/'data/nba_games.json').write_text(json.dumps({'games':games}))
   (root/'data/nba_projection_tracker.json').write_text(json.dumps({'snapshots':snapshots}))
   completed=subprocess.run([sys.executable,str(root/'nba_tracker.py')],capture_output=True,text=True)
   self.assertEqual(completed.returncode,0,completed.stderr)
   return json.loads((root/'data/nba_projection_tracker.json').read_text())
 def test_post_tip_and_missing_lock_never_graded(self):
  past=(datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(days=2)).isoformat()
  before=(datetime.datetime.fromisoformat(past)-datetime.timedelta(hours=1)).isoformat()
  after=(datetime.datetime.fromisoformat(past)+datetime.timedelta(hours=1)).isoformat()
  game={'id':101,'date':past,'home':'BOS','away':'MIA','status':'STATUS_FINAL','players':[{'id':7,'name':'Test Player','team':'BOS','stats':{'MIN':'30','PTS':20}}]}
  def snap(id_,locked):
   return {'game_id':id_,'tipoff':past,'home_team':'BOS','away_team':'MIA','locked_at':locked,'model':'integrity-test','projections':[{'player_id':'7','team':'BOS','market':'points','projection':19,'actual':None,'result':'pending'}]}
  output=self.run_tracker([game],[snap(101,before),snap(101,after),snap(101,None)])
  self.assertEqual([s['projections'][0]['result'] for s in output['snapshots']],['within_20pct','pending','pending'])
  self.assertEqual(output['accuracy_by_model']['integrity-test']['points']['count'],1)
 def test_string_game_id_matches_final(self):
  past=(datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(days=2)).isoformat()
  before=(datetime.datetime.fromisoformat(past)-datetime.timedelta(hours=1)).isoformat()
  game={'id':101,'date':past,'home':'BOS','away':'MIA','status':'STATUS_FINAL','players':[{'id':7,'name':'Test Player','team':'BOS','stats':{'MIN':'30','PTS':20}}]}
  lock={'game_id':'101','tipoff':past,'home_team':'BOS','away_team':'MIA','locked_at':before,'model':'integrity-test','projections':[{'player_id':'7','team':'BOS','market':'points','projection':19,'actual':None,'result':'pending'}]}
  output=self.run_tracker([game],[lock])
  self.assertEqual(len(output['snapshots']),1)
  self.assertEqual(output['snapshots'][0]['projections'][0]['result'],'within_20pct')
 def test_mismatched_teams_or_missing_identity_never_grade(self):
  past=(datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(days=2)).isoformat()
  before=(datetime.datetime.fromisoformat(past)-datetime.timedelta(hours=1)).isoformat()
  game={'id':101,'date':past,'home':'BOS','away':'MIA','status':'STATUS_FINAL','players':[{'id':7,'name':'Test Player','team':'BOS','stats':{'MIN':'30','PTS':20}}]}
  base={'game_id':101,'tipoff':past,'locked_at':before,'model':'integrity-test','projections':[{'player_id':'7','team':'BOS','market':'points','projection':19,'actual':None,'result':'pending'}]}
  for identity in ({'home_team':'MIA','away_team':'BOS'},{'home_team':'BOS','away_team':'NYK'},{}):
   output=self.run_tracker([game],[{**base,**identity}])
   self.assertEqual(output['snapshots'][0]['projections'][0]['result'],'pending')
   self.assertEqual(output['accuracy_by_model'],{})
 def test_player_team_mismatch_and_missing_team_do_not_grade(self):
  past=(datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(days=2)).isoformat()
  before=(datetime.datetime.fromisoformat(past)-datetime.timedelta(hours=1)).isoformat()
  game={'id':101,'date':past,'home':'BOS','away':'MIA','status':'STATUS_FINAL','players':[{'id':7,'team':'MIA','stats':{'MIN':'30','PTS':20}}]}
  base={'game_id':101,'tipoff':past,'home_team':'BOS','away_team':'MIA','locked_at':before,'model':'integrity-test'}
  for team in ('BOS',None):
   projection={'player_id':'7','market':'points','projection':19,'actual':None,'result':'pending'}
   if team:projection['team']=team
   output=self.run_tracker([game],[{**base,'projections':[projection]}])
   self.assertEqual(output['snapshots'][0]['projections'][0]['result'],'pending')
   self.assertEqual(output['accuracy_by_model'],{})
if __name__=='__main__':unittest.main()
