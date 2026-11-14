"""Current injury-source identity, game scope and conservative outage coverage."""
import copy
from datetime import datetime, timedelta, timezone
import unittest

import pandas as pd

from nfl_live_injuries import INJURIES_URL, fetch_live_injuries

NOW = datetime(2026, 11, 14, 18, tzinfo=timezone.utc)
GSIS = '00-0038134'
ATHLETE = '4567048'
GAME = '2026_10_KC_ATL'


def slate():
    return [{'season': 2026, 'week': 10, 'game_id': GAME,
             'home_team': 'ATL', 'away_team': 'KC', 'gameday': '2026-11-15', 'gametime': '13:00'}]


def roster():
    return [{'season': 2026, 'gsis_id': GSIS, 'espn_id': ATHLETE, 'team': 'KC'}]


def report(status='Out', stamp='2026-11-14T16:33Z'):
    return {'status': status, 'date': stamp, 'athlete': {
        'displayName': 'Kenneth Walker III',
        # ESPN's current injuries endpoint omits athlete.id. Its Active value
        # describes roster membership, not participation in the upcoming game.
        'status': {'name': 'Active'},
        'team': {'id': '12', 'abbreviation': 'KC'},
        'links': [{'rel': ['playercard'],
                   'href': 'https://www.espn.com/nfl/player/_/id/4567048/kenneth-walker-iii'}]}}


def document(row=None):
    return {'status': 'success', 'timestamp': NOW.isoformat(), 'season': {'year': 2026},
            'injuries': [{'id': '12', 'injuries': [row or report()]}]}


class LiveInjuryTests(unittest.TestCase):
    def fetch(self, doc=None, **kwargs):
        doc = document() if doc is None else doc
        return fetch_live_injuries(2026, 10, kwargs.pop('slate', slate()), kwargs.pop('rosters', roster()),
                                   now=kwargs.pop('now', NOW), fetch_json=lambda url, timeout: copy.deepcopy(doc), **kwargs)

    def test_walker_link_id_matches_out_despite_active_roster_field(self):
        result = self.fetch()
        self.assertEqual(result['diagnostics']['status'], 'ok')
        injury = result['reports'][GSIS]
        self.assertEqual(injury['status'], 'OUT')
        self.assertEqual(injury['athleteId'], ATHLETE)
        self.assertEqual(injury['team'], 'KC')
        self.assertEqual(injury['opponent'], 'ATL')
        self.assertEqual(injury['gameId'], GAME)
        self.assertEqual(injury['season'], 2026)
        self.assertEqual(injury['week'], 10)
        self.assertEqual(injury['source'], INJURIES_URL)
        self.assertEqual(injury['reportedAt'], '2026-11-14T16:33:00+00:00')
        self.assertEqual(injury['observedAt'], NOW.isoformat())
        self.assertFalse(result['diagnostics'].get('game_day_active_confirmed', False))

    def test_explicit_numeric_id_works_and_pandas_inputs_work(self):
        row = report()
        row['athlete']['id'] = int(ATHLETE)
        row['athlete']['links'] = []
        result = self.fetch(document(row), slate=pd.DataFrame(slate()), rosters=pd.DataFrame(roster()))
        self.assertEqual(result['reports'][GSIS]['status'], 'OUT')

    def test_aliases_match_exact_current_roster_team(self):
        game = slate()[0]
        game['away_team'] = 'WAS'
        row = report()
        row['athlete']['team']['abbreviation'] = 'WSH'
        people = roster()
        people[0]['team'] = 'WAS'
        result = self.fetch(document(row), slate=[game], rosters=people)
        self.assertEqual(result['reports'][GSIS]['team'], 'WAS')

    def test_names_never_replace_wrong_or_missing_ids(self):
        for modify in ['missing', 'wrong', 'conflicting', 'foreign-host', 'foreign-sport']:
            with self.subTest(modify=modify):
                row = report()
                if modify == 'missing':
                    row['athlete']['links'] = []
                elif modify == 'wrong':
                    row['athlete']['id'] = '999'
                    row['athlete']['links'] = []
                elif modify == 'conflicting':
                    row['athlete']['id'] = '999'
                else:
                    row['athlete']['links'][0]['href'] = (
                        'https://www.espn.com.evil.test/nfl/player/_/id/4567048/name'
                        if modify == 'foreign-host' else 'https://www.espn.com/nba/player/_/id/4567048/name')
                self.assertEqual(self.fetch(document(row))['reports'], {})

    def test_outer_and_athlete_team_must_both_match(self):
        for modify in ['outer-id', 'athlete-id', 'athlete-team', 'roster-team']:
            with self.subTest(modify=modify):
                doc, people = document(), roster()
                if modify == 'outer-id':
                    doc['injuries'][0]['id'] = '26'
                elif modify == 'athlete-id':
                    doc['injuries'][0]['injuries'][0]['athlete']['team']['id'] = '26'
                elif modify == 'athlete-team':
                    doc['injuries'][0]['injuries'][0]['athlete']['team']['abbreviation'] = 'SEA'
                else:
                    people[0]['team'] = 'SEA'
                self.assertEqual(self.fetch(doc, rosters=people)['reports'], {})

    def test_ambiguous_roster_identity_is_rejected_but_exact_duplicates_are_safe(self):
        exact = roster() + roster()
        self.assertIn(GSIS, self.fetch(rosters=exact)['reports'])
        for ambiguous in [dict(roster()[0], gsis_id='other'),
                          dict(roster()[0], team='SEA'),
                          dict(roster()[0], espn_id='999')]:
            with self.subTest(ambiguous=ambiguous):
                self.assertEqual(self.fetch(rosters=roster() + [ambiguous])['reports'], {})

    def test_document_status_season_week_and_timestamp_are_validated(self):
        changes = [{'status': 'error'}, {'season': {'year': 2025}}, {'week': 9},
                   {'timestamp': '2026-11-14T16:59Z'}, {'timestamp': '2026-11-14T18:06Z'},
                   {'timestamp': '2026-11-14T18:00:00'}, {'timestamp': None}, {'injuries': None}]
        for change in changes:
            with self.subTest(change=change):
                result = self.fetch(dict(document(), **change))
                self.assertEqual(result['reports'], {})
                self.assertEqual(result['diagnostics']['status'], 'unavailable')
                self.assertIn('error', result['diagnostics'])

    def test_report_must_be_current_game_week_and_not_future_or_naive(self):
        for stamp in ['2026-11-08T16:33Z', '2026-11-14T18:06Z', '2026-11-14T16:33:00', None]:
            with self.subTest(stamp=stamp):
                result = self.fetch(document(report(stamp=stamp)))
                self.assertEqual(result['reports'], {})
        for scope in [{'week': 9}, {'season': 2025}]:
            self.assertEqual(self.fetch(document(dict(report(), **scope)))['reports'], {})

    def test_scope_requires_unique_current_week_future_fixture_within_seven_days(self):
        variants = [[dict(slate()[0], season=2025)], [dict(slate()[0], week=9)],
                    [dict(slate()[0], gameday='2026-11-14', gametime='12:00')],
                    [dict(slate()[0], gameday='2026-11-22')],
                    slate() + [dict(slate()[0], game_id='different')], slate() + slate(),
                    [dict(slate()[0], gametime='unknown')]]
        for games in variants:
            with self.subTest(games=games):
                self.assertEqual(self.fetch(slate=games)['reports'], {})

    def test_current_monday_game_accepts_preceding_friday_report(self):
        games = [dict(slate()[0], gameday='2026-11-16', gametime='20:15')]
        self.assertIn(GSIS, self.fetch(slate=games)['reports'])

    def test_active_or_practice_labels_never_invent_game_designations(self):
        for status in ['Active', 'Full Participation', 'DNP', 'Limited', '', 'IR']:
            result = self.fetch(document(report(status)))
            self.assertEqual(result['reports'], {})
        for status in ['Questionable', 'Doubtful', 'Out']:
            self.assertEqual(self.fetch(document(report(status)))['reports'][GSIS]['status'], status.upper())

    def test_duplicate_weaker_status_cannot_override_current_out(self):
        for rows in [[report('Out'), report('Questionable', '2026-11-14T17:50Z')],
                     [report('Questionable', '2026-11-14T17:50Z'), report('Out')]]:
            doc = document()
            doc['injuries'][0]['injuries'] = rows
            self.assertEqual(self.fetch(doc)['reports'][GSIS]['status'], 'OUT')

    def test_one_malformed_link_collection_does_not_drop_other_current_reports(self):
        bad = report()
        bad['athlete']['links'] = None
        doc = document()
        doc['injuries'][0]['injuries'].insert(0, bad)
        result = self.fetch(doc)
        self.assertEqual(result['diagnostics']['status'], 'ok')
        self.assertEqual(result['reports'][GSIS]['status'], 'OUT')
        self.assertEqual(result['diagnostics']['rejected_rows'], 1)

    def test_outage_and_stale_source_retain_prior_same_game_out(self):
        prior = self.fetch()
        def unavailable(url, timeout):
            self.assertEqual(url, INJURIES_URL)
            self.assertEqual(timeout, 10)
            raise TimeoutError('offline')
        result = fetch_live_injuries(2026, 10, slate(), roster(), now=NOW + timedelta(minutes=10),
                                     fetch_json=unavailable, previous=prior)
        self.assertEqual(result['diagnostics']['status'], 'cached')
        self.assertEqual(result['reports'][GSIS]['status'], 'OUT')
        self.assertTrue(result['reports'][GSIS]['cached'])
        self.assertEqual(result['reports'][GSIS]['observedAt'], NOW.isoformat(), 'cache never fabricates a newer observation')
        stale = dict(document(), timestamp='2026-11-14T16:00Z')
        self.assertEqual(self.fetch(stale, previous=prior)['diagnostics']['status'], 'cached')
        no_prior = fetch_live_injuries(2026, 10, slate(), roster(), now=NOW, fetch_json=unavailable)
        self.assertEqual(no_prior['diagnostics']['status'], 'unavailable')
        self.assertEqual(no_prior['reports'], {})

    def test_missing_active_and_questionable_cannot_resurrect_cached_out(self):
        prior = self.fetch()
        variants = [dict(document(), injuries=[]), document(report('Active')), document(report('Questionable'))]
        for doc in variants:
            result = self.fetch(doc, previous=prior)
            self.assertEqual(result['reports'][GSIS]['status'], 'OUT')
            self.assertEqual(result['diagnostics']['retained_out_reports'], 1)
        updated_out = self.fetch(document(report('Out', '2026-11-14T17:50Z')), previous=prior)
        self.assertNotIn('cached', updated_out['reports'][GSIS])
        self.assertEqual(updated_out['diagnostics']['retained_out_reports'], 0)

    def test_cache_cannot_leak_across_game_week_team_roster_or_kickoff(self):
        prior = self.fetch()
        empty = dict(document(), injuries=[])
        for key, value in [('gameId', 'wrong'), ('week', 9), ('season', 2025),
                           ('team', 'SEA'), ('opponent', 'SEA'), ('athleteId', '999'),
                           ('source', 'https://example.test'), ('reportedAt', '2026-11-07T12:00Z'),
                           ('observedAt', '2026-11-14T18:06Z')]:
            with self.subTest(key=key):
                changed = copy.deepcopy(prior)
                changed['reports'][GSIS][key] = value
                self.assertEqual(self.fetch(empty, previous=changed)['reports'], {})
        self.assertEqual(self.fetch(empty, previous=prior, rosters=[])['reports'], {})
        kickoff = NOW + timedelta(days=1)
        result = self.fetch(dict(empty, timestamp=kickoff.isoformat()), previous=prior, now=kickoff)
        self.assertEqual(result['reports'], {})

    def test_only_out_is_retained_when_source_fails(self):
        for status in ['Questionable', 'Doubtful']:
            prior = self.fetch(document(report(status)))
            result = self.fetch(dict(document(), status='error'), previous=prior)
            self.assertEqual(result['reports'], {})
            self.assertEqual(result['diagnostics']['status'], 'unavailable')

    def test_observation_time_requires_timezone(self):
        with self.assertRaises(ValueError):
            self.fetch(now=datetime(2026, 11, 14, 18))


if __name__ == '__main__':
    unittest.main()
