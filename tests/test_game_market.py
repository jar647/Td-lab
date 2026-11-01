import copy
from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile
import unittest
from game_market import schedule_market
from scripts.archive_game_odds import archive, validate


class MarketTests(unittest.TestCase):
    def test_documented_nflverse_sign(self):
        for margin, handicap in ((3.5,-3.5),(-7,7),(0,0)):
            result=schedule_market({'spread_line':margin,'total_line':44.5})
            self.assertEqual(result['market_home_spread'],handicap)
            self.assertFalse(result['executable_pregame_quote'])
        self.assertIsNone(schedule_market({})['market_home_spread'])
        self.assertIsNone(schedule_market({'spread_line':float('nan')})['market_home_spread'])
        with self.assertRaises(ValueError):
            schedule_market({'spread_line':3,'home_spread':3})

    def test_invalid_quotes_are_missing_not_fabricated(self):
        for price in (True, -99, 0, float('inf'), '-110x', 120.5):
            self.assertIsNone(schedule_market({'home_moneyline':price})['home_moneyline'])

    def fixture(self):
        now=datetime(2026,10,31,12,tzinfo=timezone.utc)
        return now,{'captured_at':now.isoformat(),'sportsbook':'Example','source':'manual observed quote',
          'games':[{'game_id':'2026_09_A_B','home':'B','away':'A','kickoff':(now+timedelta(days=1)).isoformat(),
                    'homeSpread':-3,'homeATS':-110,'awayATS':-110,'total':44.5,'over':-115,'under':-105}]}

    def test_immutable_archive_and_idempotency(self):
        now,feed=self.fixture()
        with tempfile.TemporaryDirectory() as folder:
            a=archive(feed,Path(folder),now)
            self.assertEqual(a,archive(feed,Path(folder),now))
            changed=copy.deepcopy(feed);changed['games'][0]['homeATS']=-115
            self.assertNotEqual(a,archive(changed,Path(folder),now))
            self.assertTrue(a.exists())

    def test_reject_backdating_future_inplay_and_incomplete_sides(self):
        now,feed=self.fixture()
        for stamp in (now-timedelta(minutes=16),now+timedelta(seconds=1)):
            bad=copy.deepcopy(feed);bad['captured_at']=stamp.isoformat()
            with self.assertRaises(ValueError):validate(bad,now)
        for field,value in (('kickoff',now.isoformat()),('homeATS',None),('homeSpread',True)):
            bad=copy.deepcopy(feed);bad['games'][0][field]=value
            with self.assertRaises(ValueError):validate(bad,now)
