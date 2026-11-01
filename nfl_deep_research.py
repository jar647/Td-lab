"""Pregame NFL evidence beyond the score model; never a guessed point adjustment."""
import math
from collections import defaultdict

PBP_SOURCE = 'https://github.com/nflverse/nflverse-data/releases/tag/pbp'


def number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def mean(values):
    valid = [v for v in values if v is not None]
    return sum(valid) / len(valid) if valid else None


def earlier_plays(rows, season, week):
    return [r for r in rows if number(r.get('season')) == season and
            number(r.get('week')) is not None and number(r['week']) < week and
            str(r.get('season_type','REG')).upper() in ('REG','2') and
            not number(r.get('no_play'))]


def summarize(rows, team, side):
    key = 'posteam' if side == 'offense' else 'defteam'
    snaps = [r for r in rows if r.get(key) == team]
    plays = [r for r in snaps if r.get('play_type') in ('run','pass')]
    passes = [r for r in plays if r.get('play_type') == 'pass']
    runs = [r for r in plays if r.get('play_type') == 'run']
    def average(field, subset):
        return mean([number(r.get(field)) for r in subset])
    def success(subset):
        return mean([number(r.get('success')) if number(r.get('success')) is not None
                     else float(number(r['epa']) > 0) if number(r.get('epa')) is not None else None for r in subset])
    thirds = [r for r in plays if number(r.get('down')) == 3]
    fourths = [r for r in snaps if number(r.get('down')) == 4 and r.get('play_type') in ('run','pass','punt','field_goal')]
    neutral = [r for r in plays if number(r.get('down')) in (1,2) and
               number(r.get('qtr')) in (1,2,3) and number(r.get('wp')) is not None and .2 <= number(r['wp']) <= .8]
    xpass = [r for r in plays if number(r.get('xpass')) is not None]
    drives = defaultdict(list)
    for r in plays:
        if r.get('game_id') and r.get('drive') is not None:
            drives[(r['game_id'],r['drive'])].append(r)
    redzone = [items for items in drives.values() if any(number(r.get('yardline_100')) is not None and number(r['yardline_100']) <= 20 for r in items)]
    # A missing touchdown field must not turn into a 0% conversion estimate.
    rz_known = [items for items in redzone if all(number(r.get('touchdown')) is not None for r in items)]
    result = {
        'games':len({r['game_id'] for r in plays if r.get('game_id')}),'plays':len(plays),
        'pass_epa':average('epa',passes),'rush_epa':average('epa',runs),
        'pass_success_rate':success(passes),'rush_success_rate':success(runs),
        'sack_rate':average('sack',passes),'qb_hit_rate':average('qb_hit',passes),
        'explosive_pass_rate':mean([float(number(r['yards_gained']) >= 20) for r in passes if number(r.get('yards_gained')) is not None]),
        'explosive_rush_rate':mean([float(number(r['yards_gained']) >= 10) for r in runs if number(r.get('yards_gained')) is not None]),
        'third_down_conversion':average('third_down_converted',thirds),
        'fourth_down_go_rate':sum(r.get('play_type') in ('run','pass') for r in fourths)/len(fourths) if fourths else None,
        'neutral_early_down_pass_rate':sum(r.get('play_type') == 'pass' for r in neutral)/len(neutral) if neutral else None,
        'pass_rate_above_expected':mean([float(r['play_type'] == 'pass')-number(r['xpass']) for r in xpass]),
        'redzone_td_drive_rate':sum(any(number(r.get('touchdown')) == 1 and not number(r.get('return_touchdown')) for r in items) for items in rz_known)/len(rz_known) if rz_known else None,
        'samples':{'pass_plays':len(passes),'rush_plays':len(runs),'third_down_plays':len(thirds),
                   'fourth_down_decisions':len(fourths),'neutral_early_down_plays':len(neutral),'redzone_drives':len(rz_known)}
    }
    count = lambda subset,field:sum(number(r.get(field)) is not None for r in subset)
    result['observed_samples'] = {
        'pass_epa':count(passes,'epa'),'rush_epa':count(runs,'epa'),
        'pass_success_rate':sum(number(r.get('success')) is not None or number(r.get('epa')) is not None for r in passes),
        'rush_success_rate':sum(number(r.get('success')) is not None or number(r.get('epa')) is not None for r in runs),
        'sack_rate':count(passes,'sack'),'qb_hit_rate':count(passes,'qb_hit'),
        'explosive_pass_rate':count(passes,'yards_gained'),'explosive_rush_rate':count(runs,'yards_gained'),
        'third_down_conversion':count(thirds,'third_down_converted'),'fourth_down_go_rate':len(fourths),
        'neutral_early_down_pass_rate':len(neutral),'pass_rate_above_expected':len(xpass),
        'redzone_td_drive_rate':len(rz_known)}
    return result


def opponent_adjustment(rows, team, side):
    """Schedule-strength descriptive adjustment, excluding team-v-opponent feedback.

    Offense: raw EPA minus opponents' other-game defensive allowance relative
    to league. Defense: EPA allowed minus opponents' other-game offensive EPA
    relative to league. This is a research statistic, not fitted model output.
    """
    plays = [r for r in rows if r.get('play_type') in ('run','pass') and number(r.get('epa')) is not None]
    league = mean([number(r['epa']) for r in plays])
    own, opponent = ('posteam','defteam') if side == 'offense' else ('defteam','posteam')
    team_plays = [r for r in plays if r.get(own) == team and r.get(opponent)]
    opponents = {r[opponent] for r in team_plays}
    baselines = {opp:mean([number(r['epa']) for r in plays if r.get(opponent) == opp and r.get(own) != team]) for opp in opponents}
    covered = [r for r in team_plays if baselines.get(r[opponent]) is not None]
    if len(covered) < 50 or len({r.get('game_id') for r in covered}) < 3:
        return {'available':False,'covered_plays':len(covered),'raw_epa':mean([number(r['epa']) for r in team_plays]),'adjusted_epa':None}
    raw = mean([number(r['epa']) for r in covered])
    opposition = mean([baselines[r[opponent]] for r in covered])
    return {'available':True,'covered_plays':len(covered),'raw_epa':raw,
            'opponent_other_game_epa':opposition,'league_epa':league,'adjusted_epa':raw-opposition+league,
            'definition':'Descriptive schedule adjustment; opponents evaluated on their other earlier games. Lower defensive EPA allowed is better.'}


def team_research(prior_rows, team):
    ids = sorted({(number(r['week']),r['game_id']) for r in prior_rows
                  if (r.get('posteam') == team or r.get('defteam') == team) and r.get('game_id')})
    recent_ids = {game_id for _,game_id in ids[-4:]}
    recent = [r for r in prior_rows if r.get('game_id') in recent_ids]
    return {'source':PBP_SOURCE,'model_use':'Descriptive evidence. Only the explicitly listed scoring/EPA/pass-mix factors affect the current forecast.',
            'offense':{'season':summarize(prior_rows,team,'offense'),'recent':summarize(recent,team,'offense')},
            'defense':{'season':summarize(prior_rows,team,'defense'),'recent':summarize(recent,team,'defense')},
            'opponent_adjusted':{side:opponent_adjustment(prior_rows,team,side) for side in ('offense','defense')}}
