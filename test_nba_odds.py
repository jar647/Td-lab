import copy
import datetime as dt
import json
import pathlib
import tempfile
import unittest
from scripts.build_nba_odds import parse_props,match_fixture,classify_market,main,collect
from nba_model import UTC
from scripts.odds_provider import ProviderRateLimit
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
 def test_live_catalog_including_overtime_result_period(self):
  meta={'sportId':11,'period':'result','playerProp':True,'marketType':'playertotals-points','outcomes':[{'outcomeName':'Over'},{'outcomeName':'Under'}]}
  self.assertEqual(classify_market('Over Under Player Points (incl. overtime)',meta),'points')
  self.assertIsNone(classify_market('Over Under Player Points',meta))
 def test_real_catalog_order_and_period_metadata(self):
  self.assertEqual(classify_market('Player Points (Over/Under)'), 'points')
  self.assertEqual(classify_market('Over/Under - Player - Points'), 'points')
  self.assertEqual(classify_market('Total Player Rebounds',{'sportId':11,'period':'fulltime','playerProp':True,'outcomes':[{'outcomeName':'Over'},{'outcomeName':'Under'}]}),'rebounds')
  self.assertIsNone(classify_market('Player Points (Over/Under)',{'sportId':11,'period':'1sthalf'}))
 def test_made_threes_aliases_are_full_game_and_conservative(self):
  for name in ['Over Under Player Three Pointers Made','Over Under Player 3-Point Field Goals Made','Player 3PM (Over/Under)','Over Under Player Threes Made','Over Under Player 3PT']:
   with self.subTest(name=name):self.assertEqual(classify_market(name),'threes')
  meta={'sportId':11,'period':'result','playerProp':True,'outcomes':[{'outcomeName':'Over'},{'outcomeName':'Under'}]}
  self.assertEqual(classify_market('Over Under Player Three Pointers (incl. overtime)',meta),'threes')
  for name in ['Over Under Player Three Pointers Attempted','Over Under Player 3PM First Quarter','Player 3+ Three Pointers','Over Under Player 3PM Excluding Overtime']:
   with self.subTest(name=name):self.assertIsNone(classify_market(name))
  self.assertIsNone(classify_market('Over Under Player 3PM',{'sportId':11,'period':'1sthalf'}))
 def test_made_threes_quotes_keep_canonical_market_and_real_side(self):
  self.catalog[0].update(marketName='Over Under Player 3-Point Field Goals Made',handicap=2.5)
  rows=parse_props(self.game,self.catalog,self.response,self.game['players'],self.now)
  self.assertEqual([(r['market'],r['side'],r['line']) for r in rows],[('threes','over',2.5)])
 def test_ambiguous_player_does_not_guess(self):
  players=self.game['players']+[{'id':'espn2','name':'Jose Smith','team':'LA Clippers'}]
  self.assertEqual(parse_props(self.game,self.catalog,self.response,players,self.now),[])
 def test_collect_uses_catalog_and_preserves_no_sgp_price(self):
  feed={'generated_at':self.now.isoformat(),'games':[self.game]};rosters={'generated_at':self.now.isoformat(),'teams':{'Miami Heat':['espn1']}}
  def request(endpoint,**kwargs):return {'fixtures':[self.fixture],'markets':self.catalog,'odds':self.response,'tournaments':[]}[endpoint]
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
 def test_rate_limit_has_safe_cooldown_and_keeps_last_prices_byte_for_byte(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=pathlib.Path(tmp);(root/'data').mkdir()
   for name,value in [('nba_games',{'generated_at':self.now.isoformat(),'games':[self.game]}),('nba_rosters',{'generated_at':self.now.isoformat()})]:
    (root/'data'/f'{name}.json').write_text(json.dumps(value))
   prices=root/'data/nba_market_odds.json';prices.write_bytes(b'{"old": "retained"}\n')
   def limited(*a,**k):raise ProviderRateLimit((self.now+dt.timedelta(minutes=15)).isoformat(),'fixtures')
   status=main(root,limited,self.now)
   self.assertEqual(prices.read_bytes(),b'{"old": "retained"}\n')
   self.assertEqual(status['reason_code'],'provider_rate_limit');self.assertFalse(status['live_price_verified'])
   self.assertEqual(status['rate_limit_source'],'http_429');self.assertEqual(status['diagnostics']['provider_phase'],'fixtures')
if __name__=='__main__':unittest.main()
