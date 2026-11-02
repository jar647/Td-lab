import datetime,unittest,tempfile,pathlib,json
from nba_game_context import parse_lineup,collect
from nba_rotation_profile import extract_rotation_profile

class GameContext(unittest.TestCase):
 def test_confirmed_roster_is_not_confirmed_starters(self):
  rows=[{'personId':i,'playerName':f'Player {i}','position':p,'lineupStatus':'Expected','rosterStatus':'Active','timestamp':'2026-11-02T18:00'} for i,p in enumerate(['PG','SG','SF','PF','C'])]
  rows +=[dict(p,position='',lineupStatus='Confirmed') for p in rows]
  self.assertEqual(parse_lineup({'players':rows})['status'],'EXPECTED')
  for p in rows[:5]:p['lineupStatus']='Confirmed'
  self.assertEqual(parse_lineup({'players':rows})['status'],'CONFIRMED')
  rows[0]['rosterStatus']='Inactive'
  self.assertNotEqual(parse_lineup({'players':rows})['status'],'CONFIRMED')
 def test_source_failure_does_not_refresh_old_confirmation(self):
  with tempfile.TemporaryDirectory() as root:
   data=pathlib.Path(root)/'data';data.mkdir();(data/'nba_games.json').write_text('{"games":[]}')
   (data/'nba_game_context.json').write_text(json.dumps({'games':{'old':{'confirmed':True}}}))
   def failed(url):raise TimeoutError()
   r=collect(root,datetime.datetime(2026,11,2,20,tzinfo=datetime.timezone.utc),failed)
   self.assertEqual(r['games'],{});self.assertEqual(r['sources']['lineups']['status'],'unavailable');self.assertEqual(r['defenders'],{})
 def test_rotation_missing_history_rejected(self):
  self.assertFalse(extract_rotation_profile({})['available'])
 def test_rotations_reconcile_and_detect_bad_substitution(self):
  teams=[];plays=[];seq=0
  for team in ['A','B']:
   athletes=[{'athlete':{'id':team+str(i)},'starter':i<5,'stats':['48' if i<4 else '24']}for i in range(6)]
   teams.append({'team':{'id':team,'displayName':team},'statistics':[{'labels':['MIN'],'athletes':athletes}]})
  def event(q,clock,players=None,text=''):
   nonlocal seq
   seq+=1;plays.append({'id':str(seq),'period':{'number':q},'clock':{'displayValue':clock},'participants':[{'athlete':{'id':p}}for p in players or []],'text':text})
  for q in range(1,5):
   event(q,'12:00',[t+str(i)for t in ['A','B']for i in range(5)])
   for team in ['A','B']:event(q,'6:00',[team+'5',team+'4'],'Bench enters the game for Starter')
   for team in ['A','B']:event(q,'0.0',[team+'4',team+'5'],'Starter enters the game for Bench')
   event(q,'0.0')
  d={'boxscore':{'players':teams},'plays':plays};r=extract_rotation_profile(d);self.assertTrue(r['available'],r);self.assertAlmostEqual(sum(r['players']['A4']['quarters']),24)
  plays[2]['participants'][1]['athlete']['id']='A4';self.assertFalse(extract_rotation_profile(d)['available'])
if __name__=='__main__':unittest.main()
