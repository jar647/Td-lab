"""Opponent-adjusted score candidate. Only completed, strictly earlier weeks enter fit.

Sportsbook lines, target scores, realized target weather and target QB IDs are
never features. Historical QB/injury adjustments need timestamped pregame data.
"""
import numpy as np
import pandas as pd

VERSION = 'opponent-score-ridge-v1'


def history_before(schedule, season, week):
    s = schedule.copy()
    return s[(s.game_type == 'REG') & s.home_score.notna() & s.away_score.notna()
             & (((s.season == season) & (s.week < week)) | (s.season == season - 1))].copy()


def fit(schedule, season, week, penalty=8.0, prior_weight=.25, use_qb=True):
    """Joint offensive/defensive point ratings, with learned league/home terms.

    Each score = league scoring + offense + opponent allowance + venue effect.
    Ridge shrinks team effects; previous-season games receive lower weight.
    Hyperparameters must be selected on development seasons, before evaluation.
    """
    past = history_before(schedule, season, week)
    if past.empty:
        raise ValueError('No earlier completed regular-season games')
    if past.game_id.duplicated().any():
        raise ValueError('Duplicate historical games')
    teams = sorted(set(past.home_team) | set(past.away_team))
    index = {t: i for i, t in enumerate(teams)}
    n = len(teams)
    qb_values = set()
    if use_qb:
        for key in ['home_qb_id', 'away_qb_id']:
            if key in past:
                qb_values.update(str(v) for v in past[key].dropna() if str(v).strip())
    qbs = {q: i for i, q in enumerate(sorted(qb_values))}
    latest_qb = {}
    for g in past.sort_values(['season', 'week', 'game_id']).itertuples():
        for side in ['home', 'away']:
            q = getattr(g, side+'_qb_id', None)
            if pd.notna(q) and q is not None:
                latest_qb[getattr(g, side+'_team')] = str(q)
    x, y, weights = [], [], []
    for g in past.itertuples():
        neutral = str(getattr(g, 'location', '')).lower() == 'neutral'
        weight = prior_weight if int(g.season) < season else .97 ** (week - 1 - int(g.week))
        for offense, defense, points, venue, qb in [
            (g.home_team, g.away_team, g.home_score, 0 if neutral else .5, getattr(g, 'home_qb_id', None)),
            (g.away_team, g.home_team, g.away_score, 0 if neutral else -.5, getattr(g, 'away_qb_id', None))]:
            row = np.zeros(2*n+2+len(qbs))
            row[0], row[1] = 1, venue
            row[2+index[offense]] = 1
            row[2+n+index[defense]] = 1
            if str(qb) in qbs:
                row[2+2*n+qbs[str(qb)]] = 1
            x.append(row); y.append(float(points)); weights.append(weight)
    x, y, weights = np.array(x), np.array(y), np.array(weights)
    regularization = np.full(2*n+2+len(qbs), penalty)
    regularization[0], regularization[1] = 1e-6, 8.0
    # Prior on home advantage is 1.5 points, updated by earlier games.
    prior = np.zeros(2*n+2+len(qbs)); prior[1] = 1.5
    beta = np.linalg.solve(x.T @ (weights[:, None]*x) + np.diag(regularization),
                           x.T @ (weights*y) + regularization*prior)
    current = past[past.season == season]
    return {'version': VERSION, 'season': int(season), 'week': int(week),
            'league_points': float(beta[0]), 'home_advantage': float(beta[1]),
            'offense': {t: float(beta[2+i]) for t, i in index.items()},
            'defense_allowed': {t: float(beta[2+n+i]) for t, i in index.items()},
            'games': {t: int(((current.home_team == t) | (current.away_team == t)).sum()) for t in teams},
            'training_games': len(past), 'penalty': penalty, 'prior_weight': prior_weight,
            'qb_effect': {q: float(beta[2+2*n+i]) for q, i in qbs.items()},
            'latest_qb': latest_qb,
            'latest_current_week': int(current.week.max()) if len(current) else None}


def predict(model, home, away, neutral=False, starters=None):
    if home not in model['offense'] or away not in model['offense']:
        raise ValueError('Team missing from historical rating fit')
    advantage = 0 if neutral else model['home_advantage']/2
    h = model['league_points'] + model['offense'][home] + model['defense_allowed'][away] + advantage
    a = model['league_points'] + model['offense'][away] + model['defense_allowed'][home] - advantage
    # Live callers may pass sourced expected starters. Backtests default to last
    # observed earlier-week QB, never the target schedule's realized QB field.
    selected = {**model.get('latest_qb', {}), **(starters or {})}
    h += model.get('qb_effect', {}).get(selected.get(home), 0)
    a += model.get('qb_effect', {}).get(selected.get(away), 0)
    return round(max(0, h), 1), round(max(0, a), 1)


def candidate_card(model, home, away, qb_context, neutral=False):
    teams = [home, away]
    starters = {t: qb_context[t]['player_id'] for t in teams if qb_context.get(t, {}).get('player_id')}
    h, a = predict(model, home, away, neutral, starters)
    return {'version': VERSION, 'status': 'SHADOW_ONLY_NOT_VALIDATED',
            'home': h, 'away': a, 'margin': round(h-a, 1), 'total': round(h+a, 1),
            'training_games': model['training_games'],
            'qb_basis': {t: {'player_id': starters.get(t, model['latest_qb'].get(t)),
                'source': 'EXPECTED_STARTER_FEED' if t in starters else 'LAST_OBSERVED_QB_PROXY',
                'historical_effect_available': starters.get(t, model['latest_qb'].get(t)) in model['qb_effect']} for t in teams},
            'method': 'Opponent-adjusted offensive/defensive scoring ratings and historical QB effects. Prior season downweighted; current weeks weighted by recency. Other injuries and drive-level efficiency are not modeled. Candidate does not replace the displayed baseline or authorize a bet.'}
