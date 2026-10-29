"""Sourced game research, independent of sportsbook prices and score predictions."""
from datetime import datetime, timezone
import pandas as pd
from injury_readiness import trusted_injury_rows, diagnose_injury_feed

SCHEDULE_SOURCE = 'https://github.com/nflverse/nfldata/blob/master/data/games.csv'
INJURY_SOURCE = 'https://github.com/nflverse/nflverse-data/releases/tag/injuries'
ROSTER_SOURCE = 'https://github.com/nflverse/nflverse-data/releases/tag/rosters'


def prior_games(schedules, season, week):
    """Exclude the target week, unplayed games, and all future seasons."""
    years = pd.to_numeric(schedules.season, errors='coerce')
    weeks = pd.to_numeric(schedules.week, errors='coerce')
    return schedules[((years < season) | ((years == season) & (weeks < week)))
                     & schedules.home_score.notna() & schedules.away_score.notna()].copy()


def record(rows, coach):
    if not coach or not {'home_coach', 'away_coach'}.issubset(rows.columns):
        return None
    home = rows[rows.home_coach == coach]
    away = rows[rows.away_coach == coach]
    scored = list(pd.to_numeric(home.home_score)) + list(pd.to_numeric(away.away_score))
    allowed = list(pd.to_numeric(home.away_score)) + list(pd.to_numeric(away.home_score))
    return {'games': len(scored), 'wins': sum(a > b for a,b in zip(scored,allowed)),
            'losses': sum(a < b for a,b in zip(scored,allowed)),
            'ties': sum(a == b for a,b in zip(scored,allowed))}


def scoring_facts(history, team):
    rows = []
    for _, g in history.sort_values(['season','week']).iterrows():
        home = g.home_team == team
        if not home and g.away_team != team:
            continue
        rows.append({'game_id':str(g.game_id), 'date':str(g.gameday),
                     'venue':'home' if home else 'road',
                     'opponent':str(g.away_team if home else g.home_team),
                     'points_for':float(g.home_score if home else g.away_score),
                     'points_against':float(g.away_score if home else g.home_score)})
    def summarize(items):
        n = len(items)
        return {'games':n, 'points_for':sum(x['points_for'] for x in items),
                'points_against':sum(x['points_against'] for x in items),
                'points_per_game':round(sum(x['points_for'] for x in items)/n,2) if n else None,
                'points_allowed_per_game':round(sum(x['points_against'] for x in items)/n,2) if n else None}
    return {'season':summarize(rows), 'home':summarize([x for x in rows if x['venue']=='home']),
            'road':summarize([x for x in rows if x['venue']=='road']),
            'last_three':summarize(rows[-3:]), 'game_log':rows,
            'definition':'Actual team points, including defense and special teams; no prior or projection mixed in.'}


def injury_research(injuries, rosters, season, week, teams):
    roster_team = {}
    names = {}
    if rosters is not None and {'gsis_id','team'}.issubset(rosters.columns):
        # Conflicting current team identities stay unknown rather than arbitrary.
        for pid, group in rosters.dropna(subset=['gsis_id','team']).groupby('gsis_id'):
            if group.team.nunique() == 1:
                roster_team[str(pid)] = str(group.team.iloc[0])
                for name_col in ('full_name','football_name','display_name'):
                    if name_col in group and pd.notna(group[name_col].iloc[0]):
                        names[str(pid)] = str(group[name_col].iloc[0]); break
    diagnostic = diagnose_injury_feed(injuries, season, week, teams, roster_team)
    rows = trusted_injury_rows(injuries, season, week, roster_team)
    if not rows.empty:
        if 'date_modified' in rows:
            rows = rows.assign(_updated=pd.to_datetime(rows.date_modified,errors='coerce',utc=True))
            rows = rows[rows._updated.isna() | (rows._updated <= datetime.now(timezone.utc))]
            rows = rows.sort_values('_updated',na_position='first')
        rows = rows.drop_duplicates(['team','gsis_id'],keep='last')
    def text(row, key):
        value = row.get(key)
        return str(value).strip() if pd.notna(value) and str(value).strip() else None
    output = {}
    for team in teams:
        reports = []
        for _, r in rows.iterrows():
            if str(r.team) != team: continue
            reports.append({'player_id':str(r.gsis_id),
                            'player':text(r,'full_name') or names.get(str(r.gsis_id)) or str(r.gsis_id),
                            'position':text(r,'position'), 'designation':text(r,'report_status'),
                            'practice':text(r,'practice_status'),
                            'injury':text(r,'report_primary_injury'),
                            'source_updated_at':text(r,'date_modified')})
        output[team] = {'reports':reports,'report_count':len(reports),
                        'coverage':'REPORTED' if reports else 'NO_MATCHED_CURRENT_WEEK_REPORT',
                        'official_inactives_confirmed':False,
                        'source':INJURY_SOURCE, 'diagnostics':diagnostic,
                        'model_use':'Context only; individual replacement effects are not estimated. Missing reports do not mean healthy.'}
    return output


def enrich_research(context, all_schedules, season, week, injury_reports, retrieved_at=None):
    earlier = prior_games(all_schedules, season, week)
    regular = earlier[earlier.game_type.astype(str).str.upper() == 'REG']
    postseason = earlier[earlier.game_type.astype(str).str.upper().isin(['WC','DIV','CON','SB'])]
    current = regular[pd.to_numeric(regular.season,errors='coerce') == season]
    years = pd.to_numeric(all_schedules.season,errors='coerce').dropna()
    for team, facts in context['teams'].items():
        facts['scoring'] = scoring_facts(current,team)
        coach = facts.get('coach')
        facts['coach_career'] = {'regular_season':record(regular,coach),
                                 'playoffs':record(postseason,coach),
                                 'coverage_start_season':int(years.min()) if len(years) else None,
                                 'source':SCHEDULE_SOURCE,
                                 'scope':'Head coach records in available schedule history; assistant and college records excluded.'}
        facts['injuries'] = injury_reports.get(team,{'coverage':'SOURCE_UNAVAILABLE','reports':[],
                                                    'official_inactives_confirmed':False})
    context['research'] = {'retrieved_at':retrieved_at or datetime.now(timezone.utc).isoformat(),
        'season':season,'through_week':week-1,
        'sources':[{'name':'nflverse NFL results and head coaches','url':SCHEDULE_SOURCE},
                   {'name':'nflverse injury reports','url':INJURY_SOURCE},
                   {'name':'nflverse roster identity checks','url':ROSTER_SOURCE}],
        'model_use':{'scoring':'Score mean uses scoring and home/road splits with explicit prior shrinkage.',
                     'team_tendencies':'Score adjustment uses recent/season EPA, success and pass/rush mix.',
                     'weather_rest_travel':'Conditions historical score-error sampling when sufficient comparable games exist.',
                     'coach_record':'Research context; no automatic points awarded for career wins.',
                     'injury_reports':'Research context; player replacement score effects are not implemented.'}}
    return context
