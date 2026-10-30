import unittest
from nba_first_basket import extract_first_baskets

class FirstBasketTests(unittest.TestCase):
 def test_free_throws_excluded_chronology_sorted_and_assist_not_scorer(self):
  start={'sequenceNumber':'1','period':{'number':1},'clock':{'displayValue':'12:00'},'homeScore':0,'awayScore':0}
  def shot(seq,pid,value):return {'sequenceNumber':str(seq),'scoringPlay':True,'shootingPlay':True,'scoreValue':value,'participants':[{'athlete':{'id':pid}},{'athlete':{'id':'assist'}}]}
  detail={'plays':[shot(4,'a',2),shot(2,'b',1),shot(3,'b',3),start], 'boxscore':{'players':[{'team':{'displayName':team},'statistics':[{'athletes':[{'athlete':{'id':pid}}]}]} for team,pid in [('A','a'),('B','b')]]}}
  result=extract_first_baskets(detail)
  self.assertTrue(result['available']);self.assertEqual(result['first_game']['player_id'],'b');self.assertEqual(result['first_by_team']['A']['player_id'],'a')
  detail['plays'].remove(start);self.assertFalse(extract_first_baskets(detail)['available'])
 def test_missing_scorer_identity_is_unavailable(self):
  self.assertFalse(extract_first_baskets({'plays':[]})['available'])
if __name__=='__main__':unittest.main()
