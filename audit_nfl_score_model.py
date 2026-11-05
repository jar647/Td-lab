#!/usr/bin/env python3
"""Reproducible chronological model comparison; never tune on evaluation years."""
import argparse
import json
from pathlib import Path
import numpy as np
import pandas as pd
from nfl_score_model import fit, predict, VERSION
from score_baseline import team_rates, score_projection

ROOT = Path(__file__).resolve().parent
SPREAD_SOURCE = 'https://github.com/nflverse/nflreadr/blob/main/data-raw/dictionary_schedules.csv'


def walk(schedule, years, penalty=8, prior_weight=.25):
    output = []
    for season in years:
        regular = schedule[(schedule.season == season) & (schedule.game_type == 'REG')]
        for week in sorted(regular.week.unique()):
            if week < 5:
                continue
            target = regular[(regular.week == week) & regular.home_score.notna() & regular.away_score.notna()]
            if target.empty:
                continue
            model = fit(schedule, season, week, penalty, prior_weight)
            past = regular[(regular.week < week) & regular.home_score.notna() & regular.away_score.notna()]
            for g in target.itertuples():
                baseline = score_projection(team_rates(past, g.home_team), team_rates(past, g.away_team))
                candidate = predict(model, g.home_team, g.away_team, str(g.location).lower() == 'neutral')
                row = {'game_id': g.game_id, 'season': int(season), 'week': int(week),
                       'home': g.home_team, 'away': g.away_team,
                       'actual_home': float(g.home_score), 'actual_away': float(g.away_score),
                       'market_margin': float(g.spread_line) if pd.notna(g.spread_line) else None,
                       'market_total': float(g.total_line) if pd.notna(g.total_line) else None}
                for name, (h, a) in [('baseline', baseline), ('candidate', candidate)]:
                    row.update({name+'_home': h, name+'_away': a, name+'_margin': round(h-a, 1), name+'_total': round(h+a, 1)})
                row['actual_margin'] = row['actual_home']-row['actual_away']
                row['actual_total'] = row['actual_home']+row['actual_away']
                output.append(row)
    return output


def metrics(rows, name):
    def avg(values):
        return round(float(np.mean(values)), 5) if len(values) else None
    out = {'games': len(rows)}
    for kind in ['margin', 'total']:
        errors = [r[name+'_'+kind]-r['actual_'+kind] for r in rows]
        out[kind+'_mae'] = avg([abs(e) for e in errors])
        out[kind+'_bias'] = avg(errors)
    out['winner_accuracy'] = avg([(r[name+'_margin'] > 0) == (r['actual_margin'] > 0) for r in rows if r['actual_margin'] != 0])
    out['favorite_buckets'] = {}
    for low, high in [(0, 3), (3, 7), (7, 10), (10, 100)]:
        subset = [r for r in rows if r['market_margin'] is not None and low <= abs(r['market_margin']) < high and r['market_margin'] != 0]
        favorite = lambda r, key: r[key]*np.sign(r['market_margin'])
        picks = [r for r in subset if r[name+'_margin'] != r['market_margin']]
        graded = [r for r in picks if r['actual_margin'] != r['market_margin']]
        out['favorite_buckets'][str(low)+'-'+str(high)] = {
            'games': len(subset), 'market_favorite_margin': avg([abs(r['market_margin']) for r in subset]),
            'model_favorite_margin': avg([favorite(r, name+'_margin') for r in subset]),
            'actual_favorite_margin': avg([favorite(r, 'actual_margin') for r in subset]),
            'underdog_selection_rate': avg([favorite(r, name+'_margin') < abs(r['market_margin']) for r in picks]),
            'ats_direction_accuracy': avg([(r[name+'_margin'] > r['market_margin']) == (r['actual_margin'] > r['market_margin']) for r in graded])}
    return out


def paired_interval(rows, kind):
    clusters = {}
    for r in rows:
        difference = abs(r['baseline_'+kind]-r['actual_'+kind])-abs(r['candidate_'+kind]-r['actual_'+kind])
        clusters.setdefault((r['season'], r['week']), []).append(difference)
    keys = list(clusters)
    rng = np.random.default_rng(647)
    values = []
    for _ in range(2000):
        groups = [clusters[keys[i]] for i in rng.integers(0, len(keys), len(keys))]
        values.append(sum(map(sum, groups))/sum(map(len, groups)))
    return [round(float(x), 5) for x in np.quantile(values, [.025, .975])]


def empirical_probabilities(records):
    """Exact broad-pool paired bootstrap, with earlier-week errors only.

    Mirrors centered residuals, integer rounding and zero clipping. Contextual
    pool selection is deliberately excluded and disclosed, not mislabeled as
    the current weather/rest-conditioned production simulator.
    """
    output = []
    for r in records:
        earlier = [p for p in records if (p['season'], p['week']) < (r['season'], r['week'])]
        if len(earlier) < 100 or r['season'] < 2023:
            continue
        entry = {'game_id': r['game_id'], 'season': r['season']}
        for name in ['baseline', 'candidate']:
            errors = np.array([[p['actual_home']-p[name+'_home'], p['actual_away']-p[name+'_away']] for p in earlier])
            errors -= errors.mean(axis=0)
            scores = np.maximum(0, np.floor(errors+np.array([r[name+'_home'], r[name+'_away']])+.5))
            margin, total = scores[:, 0]-scores[:, 1], scores.sum(axis=1)
            entry[name] = {}
            for key, simulated, actual, line in [('home_win', margin, r['actual_margin'], 0),
                    ('home_cover', margin, r['actual_margin'], r['market_margin']),
                    ('over', total, r['actual_total'], r['market_total'])]:
                if line is None or actual == line:
                    continue
                nonpush = simulated != line
                # Binary proper scoring conditional on no push; pushes reported separately.
                p = float(np.mean(simulated[nonpush] > line)) if nonpush.any() else .5
                entry[name][key] = {'p': p, 'y': int(actual > line), 'push_rate': float(np.mean(~nonpush))}
        output.append(entry)
    report = {}
    for name in ['baseline', 'candidate']:
        report[name] = {}
        for key in ['home_win', 'home_cover', 'over']:
            pairs = [r[name][key] for r in output if key in r[name]]
            bins = []
            for low in range(0, 100, 10):
                b = [x for x in pairs if low/100 <= x['p'] < (low+10)/100 or low == 90 and x['p'] == 1]
                if b:
                    bins.append({'range': f'{low}-{low+10}', 'games': len(b), 'predicted': round(float(np.mean([x['p'] for x in b])), 4), 'observed': round(float(np.mean([x['y'] for x in b])), 4)})
            report[name][key] = {'games': len(pairs), 'brier': round(float(np.mean([(x['p']-x['y'])**2 for x in pairs])), 5) if pairs else None, 'bins': bins}
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--schedule-csv')
    args = parser.parse_args()
    if args.schedule_csv:
        schedule = pd.read_csv(args.schedule_csv)
    else:
        import nflreadpy
        s = nflreadpy.load_schedules()
        schedule = s.to_pandas() if hasattr(s, 'to_pandas') else pd.DataFrame(s)
    # Selection is restricted to 2022, never evaluation seasons.
    trials = []
    for penalty in [4, 8, 16]:
        for prior in [.25, .5]:
            rows = walk(schedule, [2022], penalty, prior)
            m = metrics(rows, 'candidate')
            trials.append({'penalty': penalty, 'prior_weight': prior, 'objective': m['margin_mae']+m['total_mae']})
    selected = min(trials, key=lambda t: t['objective'])
    records = walk(schedule, list(range(2021, int(schedule.season.max())+1)), selected['penalty'], selected['prior_weight'])
    evaluation = [r for r in records if r['season'] >= 2023]
    out = {'model_version': VERSION, 'status': 'RETROSPECTIVE_COMPARISON_NOT_CALIBRATED',
           'selection': {'development_season': 2022, 'trials': trials, 'selected': selected},
           'evaluation': {n: metrics(evaluation, n) for n in ['baseline', 'candidate']},
           'by_season': {str(y): {n: metrics([r for r in evaluation if r['season'] == y], n) for n in ['baseline', 'candidate']} for y in sorted({r['season'] for r in evaluation})},
           'paired_improvement_95pct_week_cluster_interval': {k: paired_interval(evaluation, k) for k in ['margin', 'total']},
           'probability_audit': empirical_probabilities(records),
           'spread_definition_source': SPREAD_SOURCE,
           'limits': ['Retrospective evaluation; these seasons are not a sealed external holdout.',
                      'Historical schedule spreads are closing-line proxies, not verified executable prices.',
                      'Home-perspective handicap equals negative nflverse spread_line.',
                      'QB effects use earlier-game starter history. Historical forecasts assume the last observed QB; target-game realized QB IDs never enter features. Other injuries are not modeled.',
                      'Probability audit enumerates the broad historical residual pool; production context conditioning is excluded.',
                      'No profitability or calibrated probability claim.'],
           'records': records}
    for kind in ['margin', 'total']:
        out[kind+'_improved'] = out['paired_improvement_95pct_week_cluster_interval'][kind][0] > 0
    # Candidate remains separate unless both score dimensions improve reliably.
    out['production_promotion_eligible'] = out['margin_improved'] and out['total_improved']
    destination = ROOT/'data/nfl_score_model_audit.json'
    destination.parent.mkdir(exist_ok=True)
    destination.write_text(json.dumps(out, indent=2, allow_nan=False)+'\n')
    (ROOT/'data/nfl_score_model_summary.json').write_text(json.dumps({k: v for k, v in out.items() if k != 'records'}, indent=2, allow_nan=False)+'\n')
    print(json.dumps({k: v for k, v in out.items() if k not in ['records', 'by_season', 'probability_audit']}, indent=2))


if __name__ == '__main__':
    main()
