"""Odds-independent explanations for the existing NFL opponent/QB engine.

The caller supplies the same completed-game-ID-filtered PBP used by game_picks.
We additionally exclude target/future weeks and invalid scrimmage observations.
The feed is descriptive and does not change production scoring by itself.
The optional client-side matchup scenario can use these prior-only inputs for bounded research simulations.
"""
import math

VERSION = 'nfl-matchup-research-v1'
MIN_GAMES = 3


def _finite(value):
    if isinstance(value, bool) or value is None or value == '':
        return None
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (ValueError, TypeError):
        return None


def _integer(value):
    number = _finite(value)
    return int(number) if number is not None and number.is_integer() else None


def _object(value):
    return value if isinstance(value, dict) else {}


def _round(value):
    return round(value, 6) if value is not None else None


def _confidence(offense_games, defense_games, offense_plays, defense_plays, league_teams):
    supported = min(offense_games, defense_games) >= MIN_GAMES and league_teams >= 4
    level = ('SUPPORTED' if min(offense_games, defense_games) >= 6
             and min(offense_plays, defense_plays) >= 100 and league_teams >= 16
             else 'LIMITED') if supported else 'INSUFFICIENT'
    return {'level': level, 'basis': f'{offense_games} offensive games / {defense_games} opponent defensive games; '
            f'{offense_plays} / {defense_plays} eligible plays; {league_teams} teams in the league reference. '
            'This describes sample support, not prediction accuracy or hit probability.'}


def _strength(model, home, away, season, week):
    model = _object(model)
    result = {'available': False, 'model_version': model.get('version') if isinstance(model.get('version'), str) else None,
              'league_points': _finite(model.get('league_points')),
              'home_advantage_points': _finite(model.get('home_advantage')),
              'training_games': _integer(model.get('training_games')), 'teams': {}}
    if (_integer(model.get('season')) != season or _integer(model.get('week')) != week
            or result['league_points'] is None or result['home_advantage_points'] is None
            or not result['training_games'] or result['training_games'] < 0):
        return {**result, 'reason': 'Matching earlier-week opponent-adjusted scoring fit is unavailable.'}
    offense, defense = _object(model.get('offense')), _object(model.get('defense_allowed'))
    ratings = {}
    for team in sorted(set(offense) & set(defense)):
        off, allowed = _finite(offense[team]), _finite(defense[team])
        if off is not None and allowed is not None:
            ratings[team] = {'offense_points': _round(off), 'defense_allowed_points': _round(allowed),
                             'net_strength_points': _round(off-allowed)}
    if any(team not in ratings for team in (home, away)) or len(ratings) < 2:
        return {**result, 'reason': 'Both teams require finite offensive and defensive scoring effects.'}
    for team in (home, away):
        rating = ratings[team]
        games = _integer(_object(model.get('games')).get(team))
        result['teams'][team] = {**rating,
            'offense_rank': 1 + sum(other['offense_points'] > rating['offense_points'] for other in ratings.values()),
            'defense_rank': 1 + sum(other['defense_allowed_points'] < rating['defense_allowed_points'] for other in ratings.values()),
            'net_rank': 1 + sum(other['net_strength_points'] > rating['net_strength_points'] for other in ratings.values()),
            'current_season_games': games if games is not None and games >= 0 else None,
            'ranked_teams': len(ratings)}
    return {**result, 'available': True,
            'method': 'Existing joint offensive/defensive scoring ridge fit; opponent-adjusted team effects. '
                      'Rankings exclude quarterback and venue terms and do not constitute a new score forecast.'}


def _eligible_rows(play_rows, season, week):
    rows, seen = [], set()
    for row in play_rows or []:
        if not isinstance(row, dict):
            continue
        yr, wk = _integer(row.get('season')), _integer(row.get('week'))
        if yr != season or wk is None or not 1 <= wk < week:
            continue
        if str(row.get('season_type', 'REG')).upper() not in {'REG', '2'}:
            continue
        mode = row.get('play_type')
        if mode not in {'pass', 'run'}:
            continue
        if 'no_play' in row and _finite(row['no_play']) != 0:
            continue
        epa = _finite(row.get('epa'))
        game = str(row.get('game_id') or '').strip()
        offense = str(row.get('posteam') or '').strip()
        defense = str(row.get('defteam') or '').strip()
        if epa is None or not game or not offense or not defense or offense == defense:
            continue
        play = row.get('play_id')
        if play is not None and str(play).strip().lower() not in {'', 'nan', 'none'}:
            key = (game, str(play))
            if key in seen:
                continue
            seen.add(key)
        # Preserve real play-level evidence instead of turning missing values
        # into zero. A sack is a pressure *proxy*, not an actual pressure rate.
        yards = _finite(row.get('yards_gained'))
        success = _finite(row.get('success'))
        down = _integer(row.get('down'))
        yardline = _finite(row.get('yardline_100'))
        first_down = _finite(row.get('first_down'))
        touchdown = _finite(row.get('pass_touchdown' if mode == 'pass' else 'rush_touchdown'))
        interception, fumble = _finite(row.get('interception')), _finite(row.get('fumble_lost'))
        turnover = float(interception > 0 or fumble > 0) if interception is not None and fumble is not None else None
        third = float(first_down > 0 or touchdown > 0) if down in (3, 4) and first_down is not None and touchdown is not None else None
        redzone = float(touchdown > 0) if yardline is not None and 0 <= yardline <= 20 and touchdown is not None else None
        rows.append({'season': yr, 'week': wk, 'game_id': game, 'mode': mode,
                     'offense': offense, 'defense': defense, 'epa': epa, 'yards': yards,
                     'success': success if success in (0, 1) else None,
                     'explosive': float(yards >= (20 if mode == 'pass' else 10)) if yards is not None else None,
                     'sack': _finite(row.get('sack')) if mode == 'pass' else None,
                     'turnover': turnover, 'third_conversion': third, 'red_zone_td': redzone})
    return rows


def _opportunity(rows, mode, team, opponent, context, opponent_context):
    pool = [row for row in rows if row['mode'] == mode]
    offense = [row for row in pool if row['offense'] == team]
    defense = [row for row in pool if row['defense'] == opponent]
    offense_games = len({row['game_id'] for row in offense})
    defense_games = len({row['game_id'] for row in defense})
    league_teams = len({row['offense'] for row in pool})
    result = {'available': False, 'offense_games': offense_games, 'opponent_games': defense_games,
              'offense_plays': len(offense), 'opponent_plays': len(defense),
              'league_plays': len(pool), 'league_teams': league_teams,
              'confidence': _confidence(offense_games, defense_games, len(offense), len(defense), league_teams)}
    if min(offense_games, defense_games) < MIN_GAMES or league_teams < 4:
        return {**result, 'reason': 'At least three earlier games for each side and four teams in the league reference '
                                  'are required for this play type. Missing evidence is unknown.'}
    avg = lambda records: sum(row['epa'] for row in records)/len(records)
    off, allowed, league = avg(offense), avg(defense), avg(pool)
    offense_relative, allowance_relative = off-league, allowed-league
    effect = offense_relative + allowance_relative
    # Completed-game rushing totals and defensive allowances; do not use
    # target-game outcomes or assume a value when PBP yardage is missing.
    rushing = None
    if mode == 'run':
        off_yards = [r['yards'] for r in offense if r['yards'] is not None]
        def_yards = [r['yards'] for r in defense if r['yards'] is not None]
        league_yards = [r['yards'] for r in pool if r['yards'] is not None]
        if (len(off_yards) >= 45 and len(def_yards) >= 45
                and len(league_yards) >= 200):
            rushing = {'offense_yards_per_carry': _round(sum(off_yards)/len(off_yards)),
                       'opponent_yards_allowed_per_carry': _round(sum(def_yards)/len(def_yards)),
                       'league_yards_per_carry': _round(sum(league_yards)/len(league_yards)),
                       'offense_carries_per_game': _round(len(offense)/offense_games),
                       'opponent_carries_allowed_per_game': _round(len(defense)/defense_games),
                       'offense_yardage_plays': len(off_yards),
                       'defense_yardage_plays': len(def_yards)}
    # Situational rates enter the score model as *corroborating estimates*
    # of the same EPA contribution, not fresh independent points. All sources
    # require coverage on both offense and opposing defense.
    situational = {}
    metrics = ['success', 'explosive', 'turnover', 'third_conversion', 'red_zone_td']
    if mode == 'pass':
        metrics.append('sack')
    for metric in metrics:
        offense_values = [r[metric] for r in offense if r.get(metric) in (0, 1)]
        defense_values = [r[metric] for r in defense if r.get(metric) in (0, 1)]
        league_values = [r[metric] for r in pool if r.get(metric) in (0, 1)]
        minimum, league_min = (8, 60) if metric == 'red_zone_td' else (12, 100) if metric == 'third_conversion' else (45, 200)
        if min(len(offense_values), len(defense_values)) < minimum or len(league_values) < league_min:
            continue
        situational[metric] = {
            'offense_rate': _round(sum(offense_values)/len(offense_values)),
            'opponent_allowed_rate': _round(sum(defense_values)/len(defense_values)),
            'league_rate': _round(sum(league_values)/len(league_values)),
            'offense_plays': len(offense_values), 'opponent_plays': len(defense_values),
            'league_plays': len(league_values),
            'definition': {
                'success': 'nflverse success flag / documented play',
                'explosive': '20+ net passing or 10+ rushing yards / documented play',
                'sack': 'sacks / passing plays, not total pressure rate',
                'turnover': 'interception or lost fumble / documented play',
                'third_conversion': 'first down or touchdown / documented 3rd-4th down play',
                'red_zone_td': 'touchdown / documented play snapped inside the 20'
            }[metric]}
    passing_yards = None
    if mode == 'pass':
        off_yards = [r['yards'] for r in offense if r['yards'] is not None]
        def_yards = [r['yards'] for r in defense if r['yards'] is not None]
        league_yards = [r['yards'] for r in pool if r['yards'] is not None]
        if len(off_yards) >= 45 and len(def_yards) >= 45 and len(league_yards) >= 200:
            passing_yards = {
                'offense_net_yards_per_play': _round(sum(off_yards)/len(off_yards)),
                'opponent_net_yards_allowed_per_play': _round(sum(def_yards)/len(def_yards)),
                'league_net_yards_per_play': _round(sum(league_yards)/len(league_yards)),
                'offense_pass_plays_per_game': _round(len(offense)/offense_games),
                'opponent_pass_plays_allowed_per_game': _round(len(defense)/defense_games),
                'offense_yardage_plays': len(off_yards),
                'defense_yardage_plays': len(def_yards)}
    recent_key = 'pass_epa' if mode == 'pass' else 'rush_epa'
    return {**result, 'available': True, 'method': 'RAW_EPA_LEAGUE_RELATIVE',
            'offense_epa': _round(off), 'opponent_allowed_epa': _round(allowed), 'league_epa': _round(league),
            'offense_relative_to_league': _round(offense_relative),
            'opponent_allowance_relative_to_league': _round(allowance_relative),
            'matchup_epa_estimate': _round(league+effect), 'matchup_relative_to_league': _round(effect),
            'signal': 'FAVORABLE' if effect > 1e-12 else 'ADVERSE' if effect < -1e-12 else 'NEUTRAL',
            'recent_offense_epa': _finite(_object(_object(context).get('recent_offense')).get(recent_key)),
            'recent_opponent_allowed_epa': _finite(_object(_object(opponent_context).get('recent_defense')).get(recent_key)),
            'rushing_yards': rushing, 'passing_yards': passing_yards,
            'situational': situational}


def build_matchup_research(model, play_rows, home_context, away_context, home, away, season, week):
    season, week = _integer(season), _integer(week)
    if (season is None or week is None or week < 1 or not isinstance(home, str) or not isinstance(away, str)
            or not home.strip() or not away.strip() or home == away):
        raise ValueError('A valid season, week and distinct matchup teams are required')
    rows = _eligible_rows(play_rows, season, week)
    directions = [(home, away, home_context, away_context), (away, home, away_context, home_context)]
    return {'version': VERSION, 'status': 'RESEARCH_ONLY', 'season': season, 'through_week': week-1,
            'score_adjustments_applied': False,
            'strength': _strength(model, home, away, season, week),
            'opportunities': [{'team': team, 'opponent': opponent,
                'pass': _opportunity(rows, 'pass', team, opponent, context, other),
                'rush': _opportunity(rows, 'run', team, opponent, context, other)}
                for team, opponent, context, other in directions],
            'source_coverage': {'eligible_plays': len(rows), 'completed_games_supplied': len({r['game_id'] for r in rows}),
                                'latest_source_week': max((r['week'] for r in rows), default=None),
                                'league_scrimmage_plays_per_team_game': _round(
                                    len(rows) / len({(r['offense'], r['game_id']) for r in rows}))
                                    if rows else None},
            'definitions': {
                'strength': 'Offense and defense point effects come from the existing opponent-adjusted score fit. '
                            'Positive defense allowance means weaker defense; defense ranks sort lower allowances first. '
                            'Net strength equals offense minus defense allowance. QB and venue effects are excluded.',
                'epa_matchup': 'Raw historical league-relative EPA: league + (offense EPA - league) + '
                               '(opponent EPA allowed - league). Higher opponent allowance improves the offensive signal. '
                               'These pass/rush signals are not schedule-adjusted and do not modify the production scoring baseline. An explicitly selected research scenario may use a bounded interaction.',
                'confidence': 'Confidence labels describe sample coverage only, never a calibrated win or prop probability.',
                'situational': 'Success, explosive plays, sacks, turnovers, red-zone TDs and third/fourth conversions use documented nflverse play flags. Missing columns are not assumed to be zeros. Net pass yards include sack effects when PBP records them. These are overlapping diagnostics of EPA, not six additive scoring advantages.',
                'source_scope': 'The feed builder supplies completed-game-ID-filtered regular-season PBP. '
                                'This analysis additionally excludes target/future weeks, no-plays and invalid EPA.'},
            'limits': ['Raw EPA style signals and opponent-adjusted scoring ratings are distinct analyses.',
                       'Historical opponents, quarterback changes and game scripts can confound raw EPA.',
                       'The feed supplies source evidence for an optional explicitly labeled research simulation; it does not validate a sportsbook edge.']}
