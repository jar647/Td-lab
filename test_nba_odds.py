import copy
import datetime as dt
import json
import pathlib
import tempfile
import unittest
from scripts.build_nba_odds import parse_props,match_fixture,classify_market,main,collect
from nba_model import UTC
class NBAOddsTests(unittest.TestCase):
 def setUp(self):
  self.now=dt.datetime(2026,11,1,12,tzinfo=UTC)
  self.game={'id':'nba1','date':'2026-11-01T16:00:00Z','status':'STATUS_SCHEDULED','home':'LA Clippers','away':'Miami Heat','players':[{'id':'espn1','name':'Jose Smith Jr.','team':'Miami Heat'}]}
  self.catalog=[{'marketId':99,'marketName':'Over Under Player Points','handicap':24.5,'outcomes':[{'outcomeId':1,'outcomeName':'Over'},{'outcomeId':2,'outcomeName':'Under'}]}]
  self.response={'bookmakerOdds':{'hardrockbet':{'markets':{'99':{'outcomes':{'1':{'players':{'provider1':{'active':True,'playerName':'Smith, Jose','price':1.91}}},'2':{'players':{'provider1':{'active':False,'playerName':'Smith, Jose','price':1.91}}}}}}}}}
  self.fixture={'fixtureId':'providerGame','hasOdds':True,'tournamentSlug':'usa-nba','participant1Name':'Los Angeles Clippers','participant2Name':'Miami Heat','startTime':self.game['date']}
 def test_catalog_player_join_and_active_prices(self):
  rows=parse_props(self.game,self.catalog,self.response,self.game['players'],self.now)
  self.assertEqual(len(rows),1);self.assertEqual(rows[0]['player_id'],'espn1');self.assertEqual(rows[0]['bookmaker'],'hardrockbet');self.assertEqual(rows[0]['american_odds'],-110)
 def test_no_cross_date_or_ambiguous_fixture(self):
  self.assertEqual(match_fixture(self.fixture,[self.game]),self.game)
  self.assertIsNone(match_fixture(self.fixture,[self.game,self.game]))
  self.fixture['startTime']='2026-11-02T16:00:00Z';self.assertIsNone(match_fixture(self.fixture,[self.game]))
 def test_unknown_partial_or_invalid_market_rejected(self):
  self.assertIsNone(classify_market('Over Under Player Points 1st Half'))
  self.assertIsNone(classify_market('Player 20+ Points'))
  self.catalog[0]['handicap']=float('nan');self.assertEqual(parse_props(self.game,self.catalog,self.response,self.game['players'],self.now),[])
 def test_ambiguous_player_does_not_guess(self):
  players=self.game['players']+[{'id':'espn2','name':'Jose Smith','team':'LA Clippers'}]
  self.assertEqual(parse_props(self.game,self.catalog,self.response,players,self.now),[])
 def test_collect_uses_catalog_and_preserves_no_sgp_price(self):
  feed={'generated_at':self.now.isoformat(),'games':[self.game]};rosters={'generated_at':self.now.isoformat(),'teams':{'Miami Heat':['espn1']}}
  def request(endpoint,**kwargs):return {'fixtures':[self.fixture],'markets':self.catalog,'odds':self.response}[endpoint]
  result=collect(feed,rosters,self.now,request)
  self.assertEqual(len(result['markets']),1);self.assertEqual(result['sgp_quotes'],[])
 def test_failure_preserves_prices_and_does_not_leak_exception(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=pathlib.Path(tmp);(root/'data').mkdir()
   for name,value in [('nba_games',{'generated_at':self.now.isoformat(),'games':[self.game]}),('nba_rosters',{'generated_at':self.now.isoformat()}),('nba_market_odds',{'old':'retained'})]:
    (root/'data'/f'{name}.json').write_text(json.dumps(value))
   def fail(*a,**k):raise RuntimeError('https://provider/?apiKey=NEVER_OUTPUT')
   result=main(root,fail,self.now)
   self.assertEqual(json.loads((root/'data/nba_market_odds.json').read_text()),{'old':'retained'})
   self.assertNotIn('NEVER_OUTPUT',json.dumps(result));self.assertEqual(result['status'],'unavailable')
if __name__=='__main__':unittest.main()
