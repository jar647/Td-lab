"""Rate limits, public catalog caches and live-price evidence are independent."""
import datetime as dt
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error
from scripts.odds_provider import request_json, ProviderRateLimit, retry_time, UTC
from scripts.verify_nba_odds_mode import verify, fingerprint
from scripts import build_hardrock_feed as nfl
from nba_pipeline import price_quote


class Response(io.BytesIO):
    def __init__(self, data):
        super().__init__(json.dumps(data).encode())


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.now = dt.datetime(2026, 11, 13, 12, tzinfo=UTC)
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.key = patch.dict(os.environ, {'ODDSPAPI_API_KEY': 'PRIVATE_TEST_KEY'})
        self.key.start()

    def tearDown(self):
        self.key.stop()
        self.temp.cleanup()

    def test_429_stops_immediately_and_shared_cooldown_blocks_other_sport(self):
        calls, sleeps = [], []
        def limited(request, **kwargs):
            calls.append(request.full_url)
            raise urllib.error.HTTPError(request.full_url, 429, 'limited', {'Retry-After': '600'}, None)
        with self.assertRaises(ProviderRateLimit) as error:
            request_json('fixtures', {'sportId': 11}, root=self.root, now=self.now, opener=limited, sleep=sleeps.append)
        self.assertEqual(len(calls), 1)
        self.assertEqual(sleeps, [])
        self.assertEqual(error.exception.retry_at, (self.now+dt.timedelta(seconds=600)).isoformat())
        with self.assertRaises(ProviderRateLimit) as second:
            request_json('fixtures', {'sportId': 14}, root=self.root, now=self.now+dt.timedelta(seconds=60), opener=limited)
        self.assertEqual(second.exception.source, 'persisted_cooldown')
        self.assertEqual(len(calls), 1)
        state = (self.root/'data/odds_provider_state.json').read_text()
        self.assertNotIn('PRIVATE_TEST_KEY', state)
        self.assertNotIn('apiKey', state)
        self.assertNotIn('PRIVATE_TEST_KEY', str(error.exception))

    def test_retry_after_http_date_and_invalid_header(self):
        self.assertEqual(retry_time({'Retry-After': 'Fri, 13 Nov 2026 13:00:00 GMT'}, self.now), self.now+dt.timedelta(hours=1))
        self.assertEqual(retry_time({'Retry-After': 'PRIVATE_TEST_KEY'}, self.now), self.now+dt.timedelta(minutes=15))
        self.assertEqual(retry_time({'Retry-After': '0'}, self.now), self.now+dt.timedelta(seconds=60))

    def test_expired_cooldown_allows_a_new_request(self):
        state = self.root/'data/odds_provider_state.json';state.parent.mkdir()
        state.write_text(json.dumps({'reason_code':'provider_rate_limit','retry_at':self.now.isoformat()}))
        self.assertEqual(request_json('odds', {'fixtureId':'game'}, root=self.root, now=self.now, opener=lambda *a,**k:Response({'bookmakerOdds':{}})), {'bookmakerOdds':{}})
        self.assertEqual(json.loads(state.read_text())['status'], 'ok')

    def test_catalog_and_fixture_cache_respects_sport_params_and_expiry(self):
        calls=[]
        def fetch(*args,**kwargs):calls.append(1);return Response({'items':[len(calls)]})
        first=request_json('fixtures', {'sportId':11}, root=self.root, now=self.now, opener=fetch)
        self.assertEqual(request_json('fixtures', {'sportId':11}, root=self.root, now=self.now+dt.timedelta(minutes=5), opener=fetch), first)
        request_json('fixtures', {'sportId':14}, root=self.root, now=self.now, opener=fetch)
        request_json('fixtures', {'sportId':11}, root=self.root, now=self.now+dt.timedelta(minutes=11), opener=fetch)
        request_json('markets', {'sportId':11}, root=self.root, now=self.now, opener=fetch)
        request_json('markets', {'sportId':11}, root=self.root, now=self.now+dt.timedelta(hours=12), opener=fetch)
        self.assertEqual(len(calls),4)
        self.assertNotIn('PRIVATE_TEST_KEY',(self.root/'data/odds_provider_cache.json').read_text())

    def test_odds_are_never_cached_or_served_as_a_new_observation(self):
        calls=[]
        def fetch(*args,**kwargs):calls.append(1);return Response({'price':len(calls)})
        self.assertEqual(request_json('odds',{},root=self.root,now=self.now,opener=fetch)['price'],1)
        self.assertEqual(request_json('odds',{},root=self.root,now=self.now,opener=fetch)['price'],2)
        self.assertFalse((self.root/'data/odds_provider_cache.json').exists())

    def test_auth_failure_is_safe_and_not_retried(self):
        calls=[]
        def denied(request,**kwargs):calls.append(1);raise urllib.error.HTTPError(request.full_url,401,'denied',{},None)
        with self.assertRaisesRegex(RuntimeError,'Odds provider HTTP 401') as error:
            request_json('fixtures',{},root=self.root,now=self.now,opener=denied)
        self.assertEqual(len(calls),1);self.assertNotIn('PRIVATE_TEST_KEY',str(error.exception))

    def test_persisted_catalog_strips_any_echoed_credentials(self):
        response={'markets':[],'apiKey':'PRIVATE_TEST_KEY','PRIVATE_TEST_KEY':'echoed-key','nested':{'token':'sensitive','url':'echo/PRIVATE_TEST_KEY','prefix-PRIVATE_TEST_KEY':'nested-key'}}
        request_json('markets',{},root=self.root,now=self.now,opener=lambda *a,**k:Response(response))
        persisted=(self.root/'data/odds_provider_cache.json').read_text()
        self.assertNotIn('PRIVATE_TEST_KEY',persisted);self.assertNotIn('sensitive',persisted)
        with self.assertRaisesRegex(ValueError,'Credentials cannot'):
            request_json('markets',{'apiKey':'OVERRIDE'},root=self.root,now=self.now)

    def test_nfl_cli_retains_feed_on_known_429_and_auth_still_fails(self):
        with patch.object(nfl,'main',side_effect=ProviderRateLimit((self.now+dt.timedelta(minutes=15)).isoformat(),'fixtures')):
            with patch('builtins.print') as printed:nfl.cli()
            self.assertIn('provider_rate_limit',printed.call_args[0][0])
        with patch.object(nfl,'main',side_effect=RuntimeError('Odds provider HTTP 401')):
            with self.assertRaisesRegex(RuntimeError,'401'):nfl.cli()


class LiveModeTests(unittest.TestCase):
    def setUp(self):
        self.now=dt.datetime(2026,11,13,12,tzinfo=UTC)
        self.temp=tempfile.TemporaryDirectory();self.path=Path(self.temp.name)/'odds.json'
        self.path.write_text(json.dumps({'generated_at':'2026-11-02T12:00:00+00:00','markets':[{'old':'retained'}]}))
        self.before={'sha256':fingerprint(self.path)}
        self.rate={'generated_at':self.now.isoformat(),'status':'unavailable','reason_code':'provider_rate_limit','live_price_verified':False,'rate_limit_source':'http_429','retry_at':(self.now+dt.timedelta(minutes=15)).isoformat()}
    def tearDown(self):self.temp.cleanup()
    def test_known_429_proves_research_mode_but_not_live_prices(self):
        evidence=verify(self.rate,self.path,self.before,self.now)
        self.assertEqual(evidence['mode'],'RESEARCH_ONLY_PROVIDER_RATE_LIMITED')
        self.assertFalse(evidence['live_price_verified']);self.assertTrue(evidence['retained_prices_unchanged'])
    def test_changed_or_redated_prices_fail_rate_limit_gate(self):
        self.path.write_text('{}')
        with self.assertRaisesRegex(ValueError,'changed or re-dated'):verify(self.rate,self.path,self.before,self.now)
    def test_unknown_or_auth_error_cannot_pass_as_degraded_research(self):
        for code in ['provider_authentication','provider_unavailable','missing_repository_secret']:
            with self.assertRaises(ValueError):verify({**self.rate,'reason_code':code},self.path,self.before,self.now)
    def test_fresh_success_requires_actual_current_quotes(self):
        status={'generated_at':self.now.isoformat(),'status':'ok','live_price_verified':True}
        with self.assertRaises(ValueError):verify(status,self.path,self.before,self.now)
        self.path.write_text(json.dumps({'generated_at':self.now.isoformat(),'status':'ok','markets':[{'observed_at':self.now.isoformat()}]}))
        self.assertTrue(verify(status,self.path,self.before,self.now)['live_price_verified'])
        stale=self.now-dt.timedelta(hours=2)
        self.path.write_text(json.dumps({'generated_at':self.now.isoformat(),'status':'ok','markets':[{'observed_at':stale.isoformat()}]}))
        with self.assertRaisesRegex(ValueError,'stale'):verify(status,self.path,self.before,self.now)
    def test_unidentified_or_expired_rate_response_fails(self):
        for update in [{'rate_limit_source':None},{'retry_at':self.now.isoformat()},{'live_price_verified':True}]:
            with self.assertRaises(ValueError):verify({**self.rate,**update},self.path,self.before,self.now)
    def test_retained_stale_and_future_quotes_never_become_actionable(self):
        quote={'line':24.5,'american_odds':-110,'side':'over','bookmaker':'hardrockbet'}
        for observed in ['2026-11-02T12:00:00+00:00',(self.now+dt.timedelta(seconds=1)).isoformat()]:
            self.assertIsNone(price_quote({**quote,'observed_at':observed},self.now,self.now.isoformat()))
        self.assertIsNotNone(price_quote({**quote,'observed_at':self.now.isoformat()},self.now,self.now.isoformat()))

if __name__=='__main__':unittest.main()
