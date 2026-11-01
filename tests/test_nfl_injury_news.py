from copy import deepcopy
from datetime import datetime, timezone
import unittest
from nfl_injury_news import parse_news


class InjuryNewsTests(unittest.TestCase):
    def setUp(self):
        self.now=datetime(2026,11,1,0,tzinfo=timezone.utc)
        self.feed={'status':'success','season':{'year':2026},'timestamp':'2026-10-31T23:59:00Z',
                   'injuries':[{'id':'1','injuries':[{'id':'r1','date':'2026-10-31T20:00:00Z','status':'Out','shortComment':'Sourced update',
                    'athlete':{'id':'p1','displayName':'Example Player','team':{'id':'1','abbreviation':'WSH'},'position':{'abbreviation':'QB'}}}]}]}

    def test_source_identity_season_time_and_separate_provenance(self):
        result=parse_news(self.feed,2026,['WAS'],self.now)['WAS']
        self.assertTrue(result['current'])
        self.assertEqual(result['reports'][0]['position'],'QB')
        self.assertEqual(result['reports'][0]['summary'],'Sourced update')
        self.assertFalse(result['official_inactives_confirmed'])
        feed=deepcopy(self.feed);feed['injuries'][0]['injuries'][0]['athlete'].pop('id')
        self.assertEqual(parse_news(feed,2026,['WAS'],self.now)['WAS']['reports'][0]['source_report_id'],'r1')
        self.assertEqual(parse_news(self.feed,2025,['WAS'],self.now)['WAS']['reports'],[])

    def test_future_stale_and_conflicting_team_identities_are_rejected(self):
        for stamp in ('2026-11-02T00:00:00Z','2026-10-01T00:00:00Z'):
            feed=deepcopy(self.feed);feed['timestamp']=stamp
            self.assertFalse(parse_news(feed,2026,['WAS'],self.now)['WAS']['current'])
        feed=deepcopy(self.feed);feed['injuries'][0]['injuries'][0]['athlete']['team']['id']='other'
        self.assertEqual(parse_news(feed,2026,['WAS'],self.now)['WAS']['reports'],[])
        feed=deepcopy(self.feed);feed['injuries'][0]['injuries'][0]['date']='2026-11-02T00:00:00Z'
        self.assertEqual(parse_news(feed,2026,['WAS'],self.now)['WAS']['reports'],[])
