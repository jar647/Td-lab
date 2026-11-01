"""Reconcile descriptive NFL rates and keep model validation separate from data QA."""
import hashlib
import json
import math
import random
from collections import defaultdict
from datetime import datetime, timezone
import pandas as pd

MODEL_VERSION = 'score-baseline-trust-v3'
DEFINITIONS = {
    'sample': 'Completed regular-season games before the target week; run/pass plays, no_play excluded; finite EPA required.',
    'epa': 'Mean source EPA per eligible play. Positive defense EPA allowed favors the opposing offense.',
    'success': 'Source success flag; EPA > 0 only where that flag is missing.',
    'recent': '60% season rate + 40% last four prior games when all four are available; recent games are also in the season sample.',
    'explosive': 'Season-only rate: pass gain >= 20 yards; run gain >= 10 yards.',
    'volume': 'Season-only eligible run/pass plays per completed game, excluding no-plays and plays without finite EPA.',
    'turnovers_sacks': 'Season-only interceptions/lost fumbles and sacks on eligible plays, divided by games.',
    'qb_split': 'Team offense in games where the named QB owns at least 80% of identified pass plays and at least 10 passes. This is a game-level split, not a causal QB effect.',
    'audit': 'Independent pandas aggregation of the same nflverse source. Reconciliation does not mean independent external verification or predictive calibration.'
}

def _number(v):
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None

def _eligible_frame(rows):
    p = pd.DataFrame(rows)
    if p.empty:
        raise ValueError('No completed pregame play-by-play to audit')
    required = {'game_id', 'posteam', 'defteam', 'play_type', 'epa', 'week'}
    if not required.issubset(p.columns):
        raise ValueError('Missing raw play-by-play audit fields')
    p = p[p.play_type.isin(['run', 'pass'])].copy()
    if 'no_play' in p:
        p = p[pd.to_numeric(p.no_play, errors='coerce').fillna(0) == 0].copy()
    if 'play_id' in p and p.duplicated(['game_id', 'play_id']).any():
        raise ValueError('Duplicate game/play identities; refusing to publish inflated rates')
    p['epa'] = pd.to_numeric(p.epa, errors='coerce')
    p.loc[~p.epa.map(lambda x: math.isfinite(x) if pd.notna(x) else False), 'epa'] = float('nan')
    return p

def _independent_summary(p, team, side):
    key = 'posteam' if side == 'offense' else 'defteam'
    p = p[(p[key] == team) & p.epa.notna()].copy()
    if p.empty:
        return {'games': 0, 'plays': 0}
    def series(key):
        return pd.to_numeric(p[key], errors='coerce') if key in p else pd.Series(float('nan'), index=p.index)
    success = series('success').fillna((p.epa > 0).astype(float)) != 0
    passing = p.play_type == 'pass'
    explosive = series('yards_gained').fillna(0) >= passing.map({True: 20, False: 10})
    games = int(p.game_id.nunique())
    def value(col, mask=None):
        x = p.loc[mask, col] if mask is not None else p[col]
        return float(x.mean()) if len(x) else None
    out = {'games': games, 'plays': len(p), 'epa_per_play': value('epa'),
           'success_rate': float(success.mean()), 'explosive_rate': float(explosive.mean()),
           'pass_rate': float(passing.mean()), 'pass_epa': value('epa', passing),
           'rush_epa': value('epa', ~passing)}
    if side == 'offense':
        out['turnovers_per_game'] = float(((series('interception').fillna(0) != 0) |
                                         (series('fumble_lost').fillna(0) != 0)).sum()) / games
    else:
        out['sacks_per_game'] = float(((series('sack').fillna(0) != 0) & passing).sum()) / games
    return out

def reconcile_contexts(rows, contexts, expected_games, season, week):
    """Fail closed on missing completed games or a disagreement between reducers."""
    if any(int(r.get('season', -1)) != season or int(r.get('week', week)) >= week for r in rows):
        raise ValueError('Target/future-week or other-season play leaked into audit')
    p = _eligible_frame(rows)
    checks = {}
    for team, context in contexts.items():
        expected = set(expected_games[team])
        for side, key in [('offense', 'posteam'), ('defense', 'defteam')]:
            valid = p[(p[key] == team) & p.epa.notna()]
            found = set(valid.game_id)
            if expected != found:
                raise ValueError(f'{team} {side}: completed-game coverage mismatch: missing {sorted(expected-found)}, extra {sorted(found-expected)}')
        ordered = sorted({(int(r['week']), str(r['game_id'])) for r in rows
                          if r.get('posteam') == team or r.get('defteam') == team})
        recent_ids = {g for _, g in ordered[-4:]}
        summaries = {}
        for label, frame, side in [('offense', p, 'offense'), ('defense', p, 'defense'),
                                  ('recent_offense', p[p.game_id.isin(recent_ids)], 'offense'),
                                  ('recent_defense', p[p.game_id.isin(recent_ids)], 'defense')]:
            actual = _independent_summary(frame, team, side)
            for field, expected_value in actual.items():
                published = context[label].get(field)
                if expected_value is None:
                    if published is not None:
                        raise ValueError(f'{team} {label}.{field}: expected missing value')
                elif published is None or abs(float(published) - expected_value) > 1e-9:
                    raise ValueError(f'{team} {label}.{field}: independent aggregation mismatch')
            summaries[label] = actual
        checks[team] = {'status': 'RECONCILED', 'completed_game_ids': sorted(expected),
                        'recent_game_ids': sorted(recent_ids), 'counts': summaries}
    columns = [c for c in ['game_id', 'play_id', 'week', 'posteam', 'defteam', 'play_type', 'epa',
               'success', 'yards_gained', 'sack', 'interception', 'fumble_lost', 'passer_player_id'] if c in p]
    # pandas normalizes NaN to JSON null; retain the exact selected-source digest.
    digest = hashlib.sha256(p[columns].to_json(orient='records', double_precision=15).encode()).hexdigest()
    return {'status': 'RECONCILED', 'checked_at': datetime.now(timezone.utc).isoformat(),
            'season': season, 'through_week': week - 1, 'source_sha256': digest,
            'source': 'https://github.com/nflverse/nflverse-data/releases/tag/pbp',
            'source_last_updated_at': None, 'external_verification': False,
            'epa_missing_plays': int(p.epa.isna().sum()), 'eligible_plays': int(p.epa.notna().sum()),
            'definitions': DEFINITIONS, 'teams': checks}

def quarterback_context(rows, team, records):
    """Expose returning-QB sample mismatch without inventing a point adjustment."""
    qbs = [r for r in records if r.get('team') == team and r.get('pos') == 'QB'
           and r.get('qbRole') == 'EXPECTED_STARTER']
    if len(qbs) != 1:
        return {'status': 'STARTER_UNCONFIRMED', 'model_use': 'Historical team mixture; current starter not independently confirmed.'}
    starter = qbs[0]
    pid = starter['player_id']
    p = _eligible_frame(rows)
    p = p[p.posteam == team]
    if 'passer_player_id' not in p:
        return {'status': 'QB_SOURCE_MISSING', 'player': starter['player']}
    passing = p[(p.play_type == 'pass') & p.passer_player_id.notna()]
    counts = passing.groupby(['game_id', 'passer_player_id']).size()
    total = passing.groupby('game_id').size()
    starter_counts = {gid: int(counts.get((gid, pid), 0)) for gid in total.index}
    led = {gid for gid, n in starter_counts.items() if n >= 10 and n / int(total[gid]) >= .8}
    ordered = sorted({(int(r['week']), str(r['game_id'])) for r in rows if r.get('posteam') == team})
    recent = [gid for _, gid in ordered[-4:]]
    different = [gid for gid in recent if starter_counts.get(gid, 0) / max(1, int(total.get(gid, 0))) < .5]
    return {'status': 'RETURNING_STARTER_SAMPLE_MISMATCH' if different else 'STARTER_HISTORY_AVAILABLE',
            'player': starter['player'], 'player_id': pid, 'source': starter.get('starterContext'),
            'starter_led_game_ids': sorted(led), 'recent_games': len(recent),
            'recent_games_other_primary_qb': len(different),
            'starter_led_offense': _independent_summary(p[p.game_id.isin(led)], team, 'offense'),
            'other_or_mixed_offense': _independent_summary(p[~p.game_id.isin(led)], team, 'offense'),
            'point_adjustment_applied': False,
            'model_use': 'Separate historical QB-led game samples. Opponents, injuries and game scripts differ; these splits do not establish a causal scoring adjustment.'}

def validation_report(backtest):
    """Paired week-cluster bootstrap; retrospective evidence, never a calibrated edge."""
    rows = backtest.get('records', [])
    if len({r.get('game_id') for r in rows}) != len(rows):
        raise ValueError('Duplicate historical validation games')
    groups = defaultdict(list)
    for r in rows:
        fields = ['projected_margin', 'projected_total', 'baseline_margin', 'baseline_total', 'actual_margin', 'actual_total']
        if not all(_number(r.get(k)) is not None for k in fields):
            raise ValueError('Nonfinite historical validation outcome')
        groups[(int(r['season']), int(r['week']))].append(r)
    def metric(sample, prefix, kind):
        return sum(abs(r[prefix+'_'+kind] - r['actual_'+kind]) for r in sample) / len(sample)
    result = {}
    for kind in ['margin', 'total']:
        differences = {key: [abs(r['baseline_'+kind]-r['actual_'+kind]) -
                              abs(r['projected_'+kind]-r['actual_'+kind]) for r in sample]
                       for key, sample in groups.items()}
        clusters = list(differences.values())
        rng = random.Random(647)
        draws = []
        if clusters:
            for _ in range(2000):
                chosen = rng.choices(clusters, k=len(clusters))
                draws.append(sum(map(sum, chosen)) / sum(map(len, chosen)))
            draws.sort()
        result[kind] = {'baseline_mae': metric(rows, 'baseline', kind) if rows else None,
                        'adjusted_mae': metric(rows, 'projected', kind) if rows else None,
                        'mean_improvement': sum(map(sum, clusters))/len(rows) if rows else None,
                        'improvement_95pct_week_cluster_interval': [draws[49], draws[1949]] if draws else None}
    return {'status': 'NOT_CALIBRATED', 'experimental_adjustment_enabled': False,
            'games': len(rows), 'model_version_evaluated': backtest.get('model_version'),
            'metrics': result, 'reported_scores': backtest.get('overall'),
            'reason': 'No established improvement across seasons or probability calibration. Experimental EPA correction is descriptive only; scoring baseline is the production research estimate.',
            'method': 'Retrospective prior-week walk-forward records, paired bootstrap by season/week (2000 draws). Not an untouched prospective holdout; not evidence of betting profitability.'}
