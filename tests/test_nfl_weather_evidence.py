"""Only dated pregame forecasts for the actual known venue enter NFL research."""
import copy
from datetime import datetime, timedelta, timezone
import unittest
from unittest.mock import patch

import nfl_weather as weather

NOW = datetime(2026, 11, 22, 15, tzinfo=timezone.utc)
GAME = {'gameday': '2026-11-22', 'gametime': '13:00', 'location': 'Home'}
HOURLY = 'https://api.weather.gov/gridpoints/GRB/1,2/forecast/hourly'


def payload(stamp='2026-11-22T14:30:00+00:00', field='updated'):
    return {'type': 'Feature', 'properties': {
        field: stamp, 'units': 'us',
        'periods': [{'number': 1, 'startTime': '2026-11-22T12:00:00-06:00',
                     'endTime': '2026-11-22T13:00:00-06:00',
                     'temperature': 45, 'temperatureUnit': 'F',
                     'windSpeed': '10 to 15 mph', 'windDirection': 'NW',
                     'probabilityOfPrecipitation': {'unitCode': 'wmoUnit:percent', 'value': 30},
                     'shortForecast': 'Chance Rain Showers'}]}}


class NFLWeatherEvidenceTests(unittest.TestCase):
    def run_forecast(self, source=None, game=None, now=NOW):
        source = payload() if source is None else source
        def fetch(url):
            if '/points/' in url:
                return {'properties': {'forecastHourly': HOURLY}}
            self.assertEqual(url, HOURLY)
            return copy.deepcopy(source)
        with patch.dict(weather._POINT_CACHE, {}, clear=True), patch.dict(weather._HOURLY_CACHE, {}, clear=True), \
                patch.object(weather, '_request_json', side_effect=fetch) as request:
            result = weather.forecast_for_game(game or GAME, 'GB', now=now)
        return result, request.call_count

    def test_real_shaped_nws_forecast_preserves_issued_time_and_conditions(self):
        result, calls = self.run_forecast()
        self.assertTrue(result['available'])
        self.assertEqual(calls, 2)
        self.assertEqual(result['updated_at'], '2026-11-22T14:30:00+00:00')
        self.assertEqual(result['source_timestamp_field'], 'updated')
        self.assertEqual(result['forecast_time'], '2026-11-22T12:00:00-06:00')
        self.assertEqual(result['temperature_f'], 45)
        self.assertEqual(result['wind_mph'], 12.5)
        self.assertEqual(result['precipitation_probability'], 30)

    def test_supported_nws_timestamp_fields_require_explicit_timezone(self):
        for field in ['updated', 'updateTime', 'generatedAt']:
            with self.subTest(field=field):
                result, _ = self.run_forecast(payload('2026-11-22T08:30:00-06:00', field))
                self.assertTrue(result['available'])
                self.assertEqual(result['source_timestamp_field'], field)
                self.assertEqual(result['updated_at'], '2026-11-22T08:30:00-06:00')
        for bad in [None, '', 'not a date', '2026-11-22T14:30:00', 123]:
            with self.subTest(bad=bad):
                result, _ = self.run_forecast(payload(bad))
                self.assertFalse(result['available'])
                self.assertIn('timezone-aware', result['reason'])
        source = payload()
        source['properties'].pop('updated')
        result, _ = self.run_forecast(source)
        self.assertFalse(result['available'])
        self.assertIsNone(result['updated_at'])
        self.assertIsNone(result['source_timestamp_field'])

    def test_present_but_invalid_primary_update_is_not_hidden_by_generated_time(self):
        source = payload('invalid update')
        source['properties']['generatedAt'] = NOW.isoformat()
        result, _ = self.run_forecast(source)
        self.assertFalse(result['available'])
        self.assertEqual(result['updated_at'], 'invalid update')
        self.assertEqual(result['source_timestamp_field'], 'updated')

    def test_exact_freshness_and_future_skew_boundaries(self):
        for delta, expected in [(timedelta(hours=-12), True),
                                (timedelta(hours=-12, seconds=-1), False),
                                (timedelta(minutes=5), True),
                                (timedelta(minutes=5, seconds=1), False)]:
            issued = (NOW+delta).isoformat()
            with self.subTest(issued=issued):
                result, _ = self.run_forecast(payload(issued))
                self.assertEqual(result['available'], expected)
                self.assertEqual(result['updated_at'], issued)
        old = (NOW-timedelta(hours=13)).isoformat()
        result, _ = self.run_forecast(payload(old))
        self.assertFalse(result['available'])
        self.assertIn('stale', result['reason'])
        self.assertEqual(result['updated_at'], old)

    def test_neutral_site_never_fetches_home_stadium_forecast(self):
        with patch.object(weather, '_request_json') as fetch:
            result = weather.forecast_for_game({**GAME, 'location': ' Neutral '}, 'GB', now=NOW)
        self.assertFalse(result['available'])
        self.assertIn('neutral-site', result['reason'])
        fetch.assert_not_called()

    def test_kickoff_and_naive_clock_close_research_without_fetch(self):
        kickoff = weather.kickoff_utc(GAME, 'GB')
        for now in [kickoff, kickoff+timedelta(seconds=1), NOW.replace(tzinfo=None)]:
            with self.subTest(now=now), patch.object(weather, '_request_json') as fetch:
                result = weather.forecast_for_game(GAME, 'GB', now=now)
                self.assertFalse(result['available'])
                fetch.assert_not_called()
        # The five-minute clock-skew tolerance cannot admit a post-kickoff issue.
        result, _ = self.run_forecast(payload(kickoff.isoformat()), now=kickoff-timedelta(minutes=3))
        self.assertFalse(result['available'])
        self.assertIn('not before kickoff', result['reason'])
        self.assertEqual(result['updated_at'], kickoff.isoformat())

    def test_hourly_selection_skips_naive_malformed_and_inverted_intervals(self):
        kickoff = weather.kickoff_utc(GAME, 'GB')
        valid = payload()['properties']['periods'][0]
        bad = [None, 'invalid', 23, {}, {'startTime': 'bad', 'endTime': 'bad'},
               {'startTime': '2026-11-22T18:00:00', 'endTime': '2026-11-22T19:00:00'},
               {'startTime': '2026-11-22T18:00:00Z', 'endTime': '2026-11-22T18:00:00Z'},
               {'startTime': '2026-11-22T19:00:00Z', 'endTime': '2026-11-22T18:00:00Z'}]
        self.assertIs(weather.select_hourly_period(bad+[valid], kickoff), valid)
        self.assertIsNone(weather.select_hourly_period(bad, kickoff))
        self.assertIsNone(weather.select_hourly_period([valid], kickoff.replace(tzinfo=None)))
        self.assertIsNone(weather.select_hourly_period({'periods': [valid]}, kickoff))
        nearby = {**valid, 'startTime': '2026-11-22T19:00:00Z', 'endTime': '2026-11-22T20:00:00Z'}
        self.assertIs(weather.select_hourly_period([nearby], kickoff), nearby)
        too_far = {**nearby, 'startTime': '2026-11-22T19:00:01Z'}
        self.assertIsNone(weather.select_hourly_period([too_far], kickoff))

    def test_missing_period_retains_real_source_update_and_cached_stale_forecast_stays_stale(self):
        source = payload()
        source['properties']['periods'] = []
        result, _ = self.run_forecast(source)
        self.assertFalse(result['available'])
        self.assertEqual(result['updated_at'], source['properties']['updated'])
        old = payload((NOW-timedelta(hours=13)).isoformat())
        coords = weather.TEAM_COORDS['GB']
        with patch.dict(weather._POINT_CACHE, {coords: HOURLY}, clear=True), \
                patch.dict(weather._HOURLY_CACHE, {HOURLY: old}, clear=True), \
                patch.object(weather, '_request_json') as fetch:
            result = weather.forecast_for_game(GAME, 'GB', now=NOW)
        self.assertFalse(result['available'])
        self.assertEqual(result['updated_at'], old['properties']['updated'])
        fetch.assert_not_called()


if __name__ == '__main__':
    unittest.main()
