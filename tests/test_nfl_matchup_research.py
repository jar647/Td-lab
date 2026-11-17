"""The existing NFL score fit gains explanations, never a new betting model."""
import copy
import json
import math
import unittest

from nfl_matchup_research import build_matchup_research


def fixture():
    model = {'version': 'opponent-score-ridge-v1', 'season': 2026, 'week': 5,
             'league_points': 23., 'home_advantage': 1.5, 'training_games': 32,
             'offense': {'A': 4., 'B': 1., 'C': -2., 'D': -3.},
             'defense_allowed': {'A': -1., 'B': 2., 'C': 0., 'D': -4.},
             'games': {t: 4 for t in 'ABCD'}}
    offense = {'A': .3, 'B': 0., 'C': .1, 'D': -.2}
    allowance = {'A': -.1, 'B': .2, 'C': .1, 'D': -.2}
    rows = []
    for week in range(1, 5):
        for a, b in [('A', 'C'), ('D', 'B'), ('C', 'A'), ('B', 'D')]:
            for mode in ('pass', 'run'):
                for number in range(10):
                    rows.append({'season': 2026, 'week': week, 'season_type': 'REG',
                        'game_id': f'2026_{week:02d}_{a}_{b}', 'play_id': f'{mode}-{number}',
                        'posteam': a, 'defteam': b, 'play_type': mode, 'no_play': 0,
                        'epa': offense[a] + allowance[b]})
    return model, rows


def card(model, rows, home_context=None, away_context=None):
    return build_matchup_research(model, rows, home_context or {}, away_context or {}, 'A', 'B', 2026, 5)


class NFLMatchupResearchTests(unittest.TestCase):
    def test_strength_decomposes_existing_model_and_ranks_defense_in_correct_direction(self):
        model, rows = fixture()
        result = card(model, rows)
        self.assertTrue(result['strength']['available'])
        a, b = result['strength']['teams']['A'], result['strength']['teams']['B']
        self.assertEqual((a['offense_points'], a['defense_allowed_points'], a['net_strength_points']), (4., -1., 5.))
        self.assertEqual((a['offense_rank'], a['defense_rank'], a['net_rank']), (1, 2, 1))
        self.assertEqual((b['offense_rank'], b['defense_rank'], b['net_rank']), (2, 4, 3))
        self.assertEqual(a['ranked_teams'], 4)
        self.assertEqual(a['current_season_games'], 4)
        self.assertEqual(result['strength']['training_games'], 32)
        self.assertFalse(result['score_adjustments_applied'])
        self.assertEqual(result['status'], 'RESEARCH_ONLY')
        self.assertIn('QB and venue effects are excluded', result['definitions']['strength'])

    def test_weaker_defensive_allowance_improves_signal_and_decomposition_is_exact(self):
        model, rows = fixture()
        before = card(model, rows)['opportunities'][0]['pass']
        changed = copy.deepcopy(rows)
        # Keep the league reference fixed while changing the opponent's allowance.
        for row in changed:
            if row['play_type'] != 'pass':
                continue
            if row['defteam'] == 'B':
                row['epa'] += .2
            if row['defteam'] == 'A':
                row['epa'] -= .2
        after = card(model, changed)['opportunities'][0]['pass']
        self.assertEqual(before['league_epa'], after['league_epa'])
        self.assertEqual(before['offense_epa'], after['offense_epa'])
        self.assertAlmostEqual(after['matchup_epa_estimate'] - before['matchup_epa_estimate'], .2)
        for x in [before, after]:
            self.assertTrue(x['available'])
            self.assertAlmostEqual(x['matchup_epa_estimate'], x['league_epa'] + x['offense_relative_to_league'] + x['opponent_allowance_relative_to_league'])
            self.assertEqual(x['method'], 'RAW_EPA_LEAGUE_RELATIVE')
            self.assertEqual(x['signal'], 'FAVORABLE')
        self.assertNotIn('probability', after)
        self.assertIn('not prediction accuracy', after['confidence']['basis'])

    def test_target_future_other_season_and_sportsbook_fields_do_not_change_analysis(self):
        model, rows = fixture()
        before = card(model, rows)
        noise = []
        for season, week in [(2026, 5), (2026, 18), (2027, 1), (2025, 4)]:
            noise.extend({**r, 'season': season, 'week': week, 'epa': 999} for r in rows)
        changed = [{**r, 'spread_line': -50, 'total_line': 100, 'american_odds': 5000} for r in rows + noise]
        changed_model = {**model, 'spread_line': 50, 'total_line': 1, 'american_odds': -5000}
        self.assertEqual(before, card(changed_model, changed))
        self.assertEqual(before['source_coverage']['latest_source_week'], 4)

    def test_missing_nonfinite_postseason_and_no_play_evidence_remains_unknown(self):
        model, rows = fixture()
        bad = [{**r, 'epa': value} for value in [None, '', math.nan, math.inf, -math.inf, True] for r in rows]
        bad += [{**r, 'no_play': 1} for r in rows]
        bad += [{**r, 'season_type': 'POST'} for r in rows]
        self.assertEqual(card(model, rows), card(model, rows + bad))
        missing = card(model, [])
        for side in missing['opportunities']:
            for mode in ['pass', 'rush']:
                self.assertFalse(side[mode]['available'])
                self.assertEqual(side[mode]['confidence']['level'], 'INSUFFICIENT')
                self.assertNotIn('matchup_epa_estimate', side[mode])
        serialized = json.dumps(card({**model, 'league_points': math.nan}, bad), allow_nan=False)
        self.assertNotIn('NaN', serialized)
        self.assertFalse(card({**model, 'league_points': math.nan}, rows)['strength']['available'])
        self.assertFalse(card({**model, 'season': 2027}, rows)['strength']['available'])

    def test_three_game_floor_zero_epa_and_known_duplicate_play_ids(self):
        model, rows = fixture()
        thin = card(model, [r for r in rows if r['week'] < 3])
        self.assertFalse(thin['opportunities'][0]['pass']['available'])
        enough = [r for r in rows if r['week'] < 4]
        self.assertTrue(card(model, enough)['opportunities'][0]['pass']['available'])
        self.assertEqual(card(model, enough), card(model, enough + copy.deepcopy(enough)))
        zero = card(model, [{**r, 'epa': 0} for r in rows])['opportunities'][0]['pass']
        self.assertTrue(zero['available'])
        self.assertEqual(zero['matchup_epa_estimate'], 0)
        self.assertEqual(zero['signal'], 'NEUTRAL')

    def test_sparse_league_reference_cannot_receive_supported_confidence(self):
        model, rows = fixture()
        sparse = [r for r in rows if r['posteam'] != 'C']
        result = card(model, sparse)['opportunities'][0]['pass']
        self.assertFalse(result['available'])
        self.assertEqual(result['confidence']['level'], 'INSUFFICIENT')
        self.assertNotIn('matchup_epa_estimate', result)

    def test_partial_play_type_coverage_and_nonfinite_recent_context_do_not_invent_stats(self):
        model, rows = fixture()
        result = card(model, [r for r in rows if r['play_type'] == 'pass'],
                      {'recent_offense': {'pass_epa': math.nan}}, {'recent_defense': {'pass_epa': math.inf}})
        self.assertTrue(result['opportunities'][0]['pass']['available'])
        self.assertIsNone(result['opportunities'][0]['pass']['recent_offense_epa'])
        self.assertFalse(result['opportunities'][0]['rush']['available'])
        json.dumps(result, allow_nan=False)

    def test_input_model_and_rows_are_not_mutated_and_invalid_matchups_fail(self):
        model, rows = fixture()
        expected_model, expected_rows = copy.deepcopy(model), copy.deepcopy(rows)
        card(model, rows)
        self.assertEqual(model, expected_model)
        self.assertEqual(rows, expected_rows)
        for season, week, home, away in [(2026, 0, 'A', 'B'), (math.nan, 5, 'A', 'B'), (2026, 5, 'A', 'A')]:
            with self.assertRaises(ValueError):
                build_matchup_research(model, rows, {}, {}, home, away, season, week)


if __name__ == '__main__':
    unittest.main()
