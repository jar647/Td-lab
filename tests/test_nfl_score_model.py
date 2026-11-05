import copy
from datetime import datetime, timezone, timedelta
import unittest
import pandas as pd
from nfl_score_model import fit, predict, history_before
from track_nfl_score_candidate import track


def fixture():
    rows = []
    for season in [2024, 2025, 2026]:
        for week in range(1, 10):
            for home, away, hs, aws in [('A', 'B', 30, 14), ('C', 'D', 24, 20), ('A', 'C', 31, 21), ('B', 'D', 15, 22)]:
                rows.append({'game_id': f'{season}_{week}_{home}_{away}', 'season': season,
                    'week': week, 'game_type': 'REG', 'home_team': home, 'away_team': away,
                    'home_score': hs, 'away_score': aws, 'location': 'Home',
                    'home_qb_id': home+'qb', 'away_qb_id': away+'qb'})
    return pd.DataFrame(rows)


class ScoreModelTests(unittest.TestCase):
    def test_target_and_future_scores_odds_qbs_cannot_change_prediction(self):
        schedule = fixture()
        first = predict(fit(schedule, 2026, 5), 'A', 'B')
        mask = (schedule.season == 2026) & (schedule.week >= 5)
        schedule.loc[mask, ['home_score', 'away_score']] = [0, 99]
        schedule.loc[mask, ['home_qb_id', 'away_qb_id']] = 'future-qb'
        schedule['spread_line'] = 50
        self.assertEqual(first, predict(fit(schedule, 2026, 5), 'A', 'B'))
        past = history_before(schedule, 2026, 5)
        self.assertTrue(((past.season == 2025) | ((past.season == 2026) & (past.week < 5))).all())

    def test_ratings_recognize_stronger_team_and_neutral_venue(self):
        model = fit(fixture(), 2026, 8)
        home, away = predict(model, 'A', 'B')
        nh, na = predict(model, 'A', 'B', neutral=True)
        self.assertGreater(home-away, 8)
        self.assertAlmostEqual((home-away)-(nh-na), model['home_advantage'], delta=.21)

    def test_expected_qb_override_uses_learned_effect_without_new_qb_bonus(self):
        model = fit(fixture(), 2026, 8)
        model['qb_effect']['returning'] = 5
        before = predict(model, 'A', 'B', starters={'A': 'unknown'})
        after = predict(model, 'A', 'B', starters={'A': 'returning'})
        self.assertAlmostEqual(after[0]-before[0], 5, delta=.11)
        self.assertEqual(after[1], before[1])

    def test_duplicates_fail_instead_of_double_counting(self):
        schedule = fixture()
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            fit(pd.concat([schedule, schedule[schedule.season == 2025].iloc[:1]]), 2026, 8)

    def test_no_completed_history_fails(self):
        with self.assertRaisesRegex(ValueError, 'No earlier'):
            fit(fixture().iloc[:0], 2026, 8)


class ForecastTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 11, 5, 15, tzinfo=timezone.utc)
        self.game = {'game_id': 'g1', 'kickoff_at': (self.now+timedelta(hours=4)).isoformat(),
            'projected_home_points': 21, 'projected_away_points': 24,
            'model_inputs': {'score_candidate': {'version': 'v1', 'home': 20, 'away': 28}}}
        self.feed = {'generated_at': self.now.isoformat(), 'games': [self.game]}

    def test_forecast_is_immutable_and_graded_only_after_kickoff(self):
        first = track(self.feed, {}, {'games': {'g1': {'home': 10, 'away': 30}}}, self.now)
        self.assertEqual(first['summary']['graded'], 0)
        self.feed['games'][0]['model_inputs']['score_candidate']['home'] = 50
        later = track(self.feed, first, {}, self.now+timedelta(hours=1))
        self.assertEqual(first['records'], later['records'])
        final = track(self.feed, later, {'games': {'g1': {'home': 10, 'away': 30}}}, self.now+timedelta(days=1))
        self.assertEqual(final['summary']['graded'], 1)
        self.assertEqual(final['summary']['models']['candidate']['margin_mae'], 12)
        self.assertNotIn('actual', first['records']['g1|v1'])

    def test_late_or_stale_or_future_feed_never_creates_pregame_forecast(self):
        self.assertEqual(track(self.feed, {}, {}, self.now+timedelta(days=1))['summary']['frozen'], 0)
        self.feed['generated_at'] = (self.now-timedelta(days=2)).isoformat()
        self.assertEqual(track(self.feed, {}, {}, self.now)['summary']['frozen'], 0)
        self.feed['generated_at'] = (self.now+timedelta(hours=1)).isoformat()
        self.assertEqual(track(self.feed, {}, {}, self.now)['summary']['frozen'], 0)

    def test_versions_are_separate_and_no_baseline_replacement(self):
        first = track(self.feed, {}, {}, self.now)
        self.game['model_inputs']['score_candidate']['version'] = 'v2'
        result = track(self.feed, first, {}, self.now)
        self.assertEqual(result['summary']['frozen'], 2)
        self.assertEqual(result['records']['g1|v1']['baseline']['home'], 21)


if __name__ == '__main__':
    unittest.main()
