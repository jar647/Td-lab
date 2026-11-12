"""Sourced NFL score scenarios. Observed lineup associations are not causal effects."""
from datetime import datetime, timezone
import math
import pandas as pd
from nfl_score_model import predict

VERSION = 'nfl-qb-lineup-scenario-v1'
OUT = {'OUT', 'INACTIVE', 'IR', 'INJURED RESERVE', 'INJURED_RESERVE', 'SUSPENDED', 'PUP'}
MIN_GAMES = 3
SHRINK_GAMES = 8
MAX_SHIFT = 6


def _text(value):
    return '' if value is None or pd.isna(value) else str(value).strip()


def _current_announcement(player):
    context = player.get('starterContext') or {}
    try:
        reported = datetime.fromisoformat(str(context.get('reported_at', '')).replace('Z', '+00:00'))
        return str(context.get('source', '')).startswith('https://') and reported.tzinfo is not None and reported <= datetime.now(timezone.utc)
    except (ValueError, TypeError):
        return False

def quarterback_basis(model, team, opponent, players, reports):
    blocked = {str(r.get('player_id')) for r in reports if str(r.get('designation', '')).upper() in OUT}
    rows = [p for p in players if p.get('team') == team and p.get('opp') == opponent and p.get('pos') == 'QB'
            and p.get('qbRole') != 'BACKUP' and str(p.get('player_id')) not in blocked
            and not any(str(p.get(k, '')).upper() in OUT for k in ['availability', 'injuryReportStatus', 'gameDayAvailability'])]
    announced = [p for p in rows if p.get('qbRole') == 'EXPECTED_STARTER' and _current_announcement(p)]
    if len(announced) == 1:
        selected, source = announced[0], 'SOURCED_EXPECTED_STARTER'
    else:
        latest = [p for p in rows if str(p.get('player_id')) == model.get('latest_qb', {}).get(team)]
        if len(latest) != 1:
            return {'player_id': None, 'player': None, 'source': 'UNRESOLVED', 'assumption': 'No eligible last-observed or sourced expected quarterback. Choose the historical baseline.', 'effect_available': False}
        selected, source = latest[0], 'ASSUMED_LAST_OBSERVED_QB'
    pid = str(selected['player_id'])
    return {'player_id': pid, 'player': selected.get('player'), 'source': source,
            'source_url': (selected.get('starterContext') or {}).get('source'),
            'effect_available': pid in model.get('qb_effect', {}),
            'assumption': 'Expected starter from cited announcement; game-day status still requires confirmation.' if source == 'SOURCED_EXPECTED_STARTER' else 'Assumes the last observed quarterback starts; this is not a confirmed lineup.',
            'availability': selected.get('injuryReportStatus', 'UNVERIFIED')}


def joint_absence_shift(model, schedule, snaps, roster, team, reports, side, season, week):
    """One joint adjustment per unit, never sum overlapping player penalties.

    Only complete snap tables after each player's first observed team appearance
    can prove absence. Sparse, missing and traded-player history stays unknown.
    """
    requested = [r for r in reports if str(r.get('designation', '')).upper() in OUT and r.get('position') != 'QB'
                 and (r.get('position') in {'RB', 'WR', 'TE', 'OL', 'OT', 'OG', 'C', 'T', 'G', 'FB'} if side == 'offense'
                      else r.get('position') in {'CB', 'DB', 'S', 'FS', 'SS', 'LB', 'ILB', 'OLB', 'DE', 'DT', 'DL', 'NT', 'EDGE'})]
    result = {'side': side, 'players': [{'id': r.get('player_id'), 'name': r.get('player'), 'status': r.get('designation')} for r in requested],
              'shift': 0.0, 'applied': False, 'absent_games': 0, 'present_games': 0,
              'method': 'Same-team score residuals with all listed players absent versus all present, after opponent/QB scoring fit; shrunk toward zero. Descriptive association, not a causal injury penalty.'}
    if not requested:
        return {**result, 'status': 'NO_KNOWN_OUTS', 'reason': 'No matched OUT players for this unit. Missing reports do not establish health.'}
    required = {'season', 'week', 'team', 'pfr_player_id', side+'_pct'}
    if snaps is None or not required.issubset(snaps.columns) or roster is None or not {'gsis_id', 'pfr_id', 'team'}.issubset(roster.columns):
        return {**result, 'status': 'MISSING_PARTICIPATION_SOURCE', 'reason': 'Verified player identity and complete snap tables required; no point adjustment guessed.'}
    ids = []
    for r in requested:
        matches = roster[(roster.gsis_id.astype(str) == str(r.get('player_id'))) & (roster.team.astype(str) == team)]
        values = {_text(v) for v in matches.pfr_id if _text(v)}
        if len(values) != 1:
            return {**result, 'status': 'UNRESOLVED_PLAYER_ID', 'reason': 'A current-team player could not be uniquely joined to participation history.'}
        ids.append(next(iter(values)))
    field = side+'_pct'
    s = snaps[snaps.team.astype(str) == team].copy()
    s['pct'] = pd.to_numeric(s[field], errors='coerce')
    s = s[((s.season == season) & (s.week < week)) | (s.season == season-1)]
    groups, first = {}, {}
    for (yr, wk), group in s.groupby(['season', 'week']):
        if group.pfr_player_id.duplicated().any() or group.pct.isna().any() or not group.pct.between(0, 1).all() or not 10.5 <= group.pct.sum() <= 11.5:
            continue
        values = dict(zip(group.pfr_player_id.astype(str), group.pct))
        groups[(int(yr), int(wk))] = values
        for pid in ids:
            if values.get(pid, 0) > 0:
                first[(int(yr), pid)] = min(first.get((int(yr), pid), int(wk)), int(wk))
    absent, present = [], []
    for game in schedule.itertuples():
        yr, wk = int(game.season), int(game.week)
        if game.game_type != 'REG' or not ((yr == season and wk < week) or yr == season-1) or team not in {game.home_team, game.away_team} or pd.isna(game.home_score) or pd.isna(game.away_score):
            continue
        values = groups.get((yr, wk))
        if values is None or any((yr, pid) not in first or wk < first[(yr, pid)] for pid in ids):
            continue
        played = [values.get(pid, 0) > 0 for pid in ids]
        if not (all(played) or not any(played)):
            continue
        starters = {game.home_team: _text(getattr(game, 'home_qb_id', None)), game.away_team: _text(getattr(game, 'away_qb_id', None))}
        hp, ap = predict(model, game.home_team, game.away_team, str(getattr(game, 'location', '')).lower() == 'neutral', starters)
        home = game.home_team == team
        actual, expected = ((game.home_score, hp) if home else (game.away_score, ap)) if side == 'offense' else ((game.away_score, ap) if home else (game.home_score, hp))
        (present if all(played) else absent).append({'game_id': game.game_id, 'residual': float(actual)-expected})
    result.update(absent_games=len(absent), present_games=len(present), absent_game_ids=[g['game_id'] for g in absent], present_game_ids=[g['game_id'] for g in present])
    if min(len(absent), len(present)) < MIN_GAMES:
        return {**result, 'status': 'INSUFFICIENT_MATCHED_HISTORY', 'reason': 'Need at least three complete games in each joint lineup state. No replacement penalty invented.'}
    raw = sum(g['residual'] for g in absent)/len(absent)-sum(g['residual'] for g in present)/len(present)
    n = min(len(absent), len(present))
    shift = max(-MAX_SHIFT, min(MAX_SHIFT, raw*n/(n+SHRINK_GAMES)))
    return {**result, 'status': 'OBSERVED_JOINT_ABSENCE_SCENARIO', 'shift': round(shift, 2), 'raw_difference': round(raw, 2),
            'applied': True, 'shrink_games': SHRINK_GAMES, 'maximum_absolute_shift': MAX_SHIFT,
            'reason': 'A historical association is applied for this scenario. Opponents and other lineup changes can still confound it.'}


def build_scenario(model, schedule, snaps, roster, home, away, players, injury_reports, season, week, neutral=False):
    reports = {t: injury_reports.get(t, {}).get('reports', []) for t in [home, away]}
    qbs = {t: quarterback_basis(model, t, away if t == home else home, players, reports[t]) for t in [home, away]}
    unresolved = [t for t, q in qbs.items() if not q['player_id'] or not q['effect_available']]
    card = {'version': VERSION, 'base_version': model['version'], 'generated_at': datetime.now(timezone.utc).isoformat(),
            'available': not unresolved, 'quarterbacks': qbs, 'training_games': model['training_games'],
            'through_week': week-1, 'status': 'EXPERIMENTAL_SCENARIO', 'injuries': {},
            'limits': ['Sourced OUT players are considered; practice-only and questionable statuses are not assumed OUT.',
                       'Complete matching injury histories can be sparse; unsupported injury effects remain explicitly unmodeled.',
                       'Residual uncertainty comes from chronological opponent/QB model errors, without historical injury-announcement validation.',
                       'No verified betting edge or calibrated probability is claimed.']}
    if unresolved:
        return {**card, 'reason': 'No supported quarterback scenario for '+', '.join(unresolved)+'. Historical baseline remains available.'}
    hp, ap = predict(model, home, away, neutral, {t: q['player_id'] for t, q in qbs.items()})
    card['before_absence_adjustment'] = {'home': hp, 'away': ap}
    for team in [home, away]:
        card['injuries'][team] = {'coverage': injury_reports.get(team, {}).get('coverage', 'UNAVAILABLE'),
                                'official_inactives_confirmed': False,
                                'source': injury_reports.get(team, {}).get('source'),
                                'other_out_reports': [r for r in reports[team] if str(r.get('designation', '')).upper() in OUT and r.get('position') not in {'QB','RB','WR','TE','OL','OT','OG','C','T','G','FB','CB','DB','S','FS','SS','LB','ILB','OLB','DE','DT','DL','NT','EDGE'}],
                                'units': [joint_absence_shift(model, schedule, snaps, roster, team, reports[team], side, season, week) for side in ['offense', 'defense']]}
    shifts = {team: {u['side']: u['shift'] for u in card['injuries'][team]['units']} for team in [home, away]}
    card.update(home=round(max(0, hp+shifts[home]['offense']+shifts[away]['defense']), 1),
                away=round(max(0, ap+shifts[away]['offense']+shifts[home]['defense']), 1))
    card['reason'] = 'Opponent-adjusted scoring with explicit QB assumptions and supported observed lineup scenarios; unsupported injuries are listed, not silently declared modeled.'
    return card
