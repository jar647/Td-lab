import unittest
from nba_shot_profile import extract_shot_profile
class ShotProfiles(unittest.TestCase):
 def detail(self):
  teams=[{'team':{'id':str(i),'displayName':str(i)},'statistics':[{'labels':['FG'],'athletes':[{'athlete':{'id':str(i)},'stats':['1-2']}]}]} for i in (1,2)]
  plays=[{'id':'0','period':{'number':1},'clock':{'displayValue':'12:00'}}]
  for team in (1,2):
   for attempt in (1,2):plays.append({'id':str(team*10+attempt),'shootingPlay':True,'team':{'id':str(team)},'participants':[{'athlete':{'id':str(team)}}],'text':('Player makes 2-foot layup' if attempt==1 else 'Player misses 18-foot jumper')})
  return {'boxscore':{'players':teams},'plays':plays}
 def test_verified_buckets(self):
  d=self.detail();r=extract_shot_profile(d);self.assertTrue(r['available']);self.assertEqual(r['teams']['1']['rim']['made'],1);self.assertEqual(r['coverage']['1'],1)
 def test_missing_or_duplicate_shots(self):
  d=self.detail();d['plays'].pop();self.assertFalse(extract_shot_profile(d)['available']);d=self.detail();d['plays'].append(d['plays'][-1]);self.assertEqual(extract_shot_profile(d)['coverage']['2'],1)
 def test_no_inferred_coordinates(self):
  d=self.detail();d['plays'][1]['text']='Player makes jump shot';self.assertFalse(extract_shot_profile(d)['available'])
