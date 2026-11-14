"""Current ESPN game designations, joined by roster ID and current fixture.

Active roster membership and practice participation never clear an injury.
Previously observed OUT reports remain conservative exclusions for their exact
upcoming game if the source fails, omits the player, or returns a weaker status.
"""
from datetime import date, datetime, time, timedelta, timezone
import json
import re
from urllib.parse import urlsplit
from urllib.request import urlopen
from zoneinfo import ZoneInfo

from nfl_depth_charts import canonical_team, identifier

INJURIES_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries?limit=1000'
STATUSES = {'OUT', 'DOUBTFUL', 'QUESTIONABLE'}
SEVERITY = {'QUESTIONABLE': 1, 'DOUBTFUL': 2, 'OUT': 3}
EASTERN = ZoneInfo('America/New_York')


def _records(value):
    if hasattr(value, 'to_dict'):
        return value.to_dict('records')
    return value if isinstance(value, list) else []


def _stamp(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed.astimezone(timezone.utc) if parsed.tzinfo else None
    except ValueError:
        return None


def _integer(value):
    if isinstance(value, bool) or value is None:
        return None
    text = str(value).strip()
    return int(text.split('.')[0]) if re.fullmatch(r'\d+(?:\.0+)?', text) else None


def _athlete_id(athlete):
    """Use explicit numeric IDs or consistent HTTPS ESPN NFL player links."""
    ids = set()
    direct = identifier(athlete.get('id'))
    if direct:
        ids.add(direct)
    links = athlete.get('links', [])
    for link in links if isinstance(links, list) else []:
        if not isinstance(link, dict):
            continue
        try:
            url = urlsplit(str(link.get('href', '')))
        except ValueError:
            continue
        if url.scheme != 'https' or url.netloc.lower() not in {'www.espn.com', 'espn.com'}:
            continue
        match = re.fullmatch(r'/nfl/player/(?:[^/]+/)*id/(\d+)(?:/[^/]*)?/?', url.path)
        if match:
            ids.add(match.group(1))
    return next(iter(ids)) if len(ids) == 1 else None


def _fixtures(slate, season, week, now):
    by_team = {}
    for game in _records(slate):
        if not isinstance(game, dict) or _integer(game.get('season')) != season or _integer(game.get('week')) != week:
            continue
        home = canonical_team(game.get('home_team', game.get('home')))
        away = canonical_team(game.get('away_team', game.get('away')))
        game_id = game.get('game_id', game.get('id'))
        if not home or not away or home == away or not isinstance(game_id, str) or not game_id.strip():
            continue
        kickoff = _stamp(game.get('kickoff_at'))
        if kickoff is None:
            try:
                day = date.fromisoformat(str(game.get('gameday'))[:10])
                hour, minute = str(game.get('gametime')).split(':')[:2]
                kickoff = datetime.combine(day, time(int(hour), int(minute)), EASTERN).astimezone(timezone.utc)
            except (ValueError, TypeError):
                continue
        if not 0 < (kickoff - now).total_seconds() <= 7 * 86400:
            continue
        day = kickoff.astimezone(EASTERN).date()
        # Monday injury news can concern the previous NFL week's Monday game.
        # Unscoped rows must be dated Tuesday or later; only a source that
        # explicitly supplies this NFL week may use an earlier Monday report.
        monday = day - timedelta(days=day.weekday() + (7 if day.weekday() < 2 else 0))
        scoped_starts = datetime.combine(monday, time(), EASTERN).astimezone(timezone.utc)
        starts = datetime.combine(monday + timedelta(days=1), time(), EASTERN).astimezone(timezone.utc)
        for team, opponent in [(home, away), (away, home)]:
            by_team.setdefault(team, []).append({'gameId': game_id.strip(), 'opponent': opponent,
                                                 'kickoff': kickoff, 'reportStart': starts,
                                                 'scopedReportStart': scoped_starts})
    return {team: games[0] for team, games in by_team.items() if len(games) == 1}


def _roster_lookup(rosters, season):
    pairs, by_gsis, by_athlete = {}, {}, {}
    for player in _records(rosters):
        if not isinstance(player, dict):
            continue
        if player.get('season') is not None and _integer(player.get('season')) != season:
            continue
        athlete = identifier(player.get('espn_id'))
        gsis = player.get('gsis_id')
        team = canonical_team(player.get('team'))
        if athlete and isinstance(gsis, str) and gsis.strip() and team:
            pairs.setdefault((team, athlete), set()).add(gsis.strip())
            by_gsis.setdefault(gsis.strip(), set()).add((team, athlete))
            by_athlete.setdefault(athlete, set()).add((team, gsis.strip()))
    return {key: next(iter(ids)) for key, ids in pairs.items() if len(ids) == 1
            and len(by_gsis[next(iter(ids))]) == 1 and len(by_athlete[key[1]]) == 1}


def _reported_in_game(stamp, fixture, now, week_scoped=False):
    starts = fixture['scopedReportStart'] if week_scoped else fixture['reportStart']
    return stamp is not None and starts <= stamp < fixture['kickoff'] and stamp <= now + timedelta(minutes=5)


def _cached_out(previous, fixtures, roster, season, week, now):
    retained = {}
    prior = previous.get('reports', {}) if isinstance(previous, dict) else {}
    if not isinstance(prior, dict):
        return retained
    for gsis, report in prior.items():
        if not isinstance(report, dict) or report.get('status') != 'OUT' or report.get('source') != INJURIES_URL:
            continue
        team = canonical_team(report.get('team'))
        fixture = fixtures.get(team)
        if not fixture or _integer(report.get('season')) != season or _integer(report.get('week')) != week:
            continue
        if report.get('gameId') != fixture['gameId'] or canonical_team(report.get('opponent')) != fixture['opponent']:
            continue
        if roster.get((team, identifier(report.get('athleteId')))) != gsis:
            continue
        reported = _stamp(report.get('reportedAt'))
        observed = _stamp(report.get('observedAt'))
        if not _reported_in_game(reported, fixture, now, report.get('weekScoped') is True) or observed is None or observed > now + timedelta(minutes=5):
            continue
        retained[gsis] = dict(report, cached=True)
    return retained


def _fetch_json(url, timeout):
    with urlopen(url, timeout=timeout) as response:
        return json.load(response)


def fetch_live_injuries(season, week, slate, rosters, now=None, fetch_json=None, previous=None):
    """Return exact current-game reports plus explicit source-health diagnostics.

    ``slate`` and ``rosters`` accept pandas DataFrames or lists of records.
    Missing injury rows mean unknown, never healthy or game-day active.
    """
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ValueError('Live injury observation time must include a timezone')
    now = now.astimezone(timezone.utc)
    fixtures = _fixtures(slate, season, week, now)
    roster = _roster_lookup(rosters, season)
    reports = _cached_out(previous, fixtures, roster, season, week, now)
    diagnostics = {'status': 'unavailable', 'source': INJURIES_URL, 'observed_at': now.isoformat(),
                   'source_updated_at': None, 'matched_reports': len(reports), 'fresh_reports': 0,
                   'retained_out_reports': len(reports), 'rejected_rows': 0,
                   'requested_teams': sorted(fixtures),
                   'note': 'Current injury designations are not confirmed game-day actives. Missing rows never confirm healthy.'}
    fresh = {}
    try:
        document = (fetch_json or _fetch_json)(INJURIES_URL, 10)
        if not isinstance(document, dict) or document.get('status') != 'success':
            raise ValueError('Injury source did not return success')
        if not isinstance(document.get('season'), dict) or _integer(document['season'].get('year')) != season:
            raise ValueError('Injury source belongs to another season')
        if document.get('week') is not None and _integer(document['week']) != week:
            raise ValueError('Injury source belongs to another week')
        updated = _stamp(document.get('timestamp'))
        if updated is None or not -300 <= (now - updated).total_seconds() <= 3600:
            raise ValueError('Injury source timestamp is missing, stale or in the future')
        if not isinstance(document.get('injuries'), list):
            raise ValueError('Injury source lacks team injury lists')
        diagnostics['source_updated_at'] = updated.isoformat()
        for outer in document['injuries']:
            if not isinstance(outer, dict):
                diagnostics['rejected_rows'] += 1
                continue
            outer_id = identifier(outer.get('id'))
            for row in outer.get('injuries', []) if isinstance(outer.get('injuries'), list) else []:
                if not isinstance(row, dict) or not isinstance(row.get('athlete'), dict):
                    diagnostics['rejected_rows'] += 1
                    continue
                status = str(row.get('status', '')).strip().upper()
                if status not in STATUSES:
                    continue
                athlete = row['athlete']
                team_data = athlete.get('team') if isinstance(athlete.get('team'), dict) else {}
                team = canonical_team(team_data.get('abbreviation'))
                fixture = fixtures.get(team)
                if not fixture:
                    continue
                athlete_id = _athlete_id(athlete)
                gsis = roster.get((team, athlete_id))
                reported = _stamp(row.get('date'))
                wrong_scope = (row.get('week') is not None and _integer(row['week']) != week or
                               row.get('season') is not None and _integer(row['season']) != season)
                week_scoped = _integer(row.get('week')) == week or _integer(document.get('week')) == week
                if not outer_id or outer_id != identifier(team_data.get('id')) or not gsis or wrong_scope or not _reported_in_game(reported, fixture, now, week_scoped):
                    diagnostics['rejected_rows'] += 1
                    continue
                report = {'status': status, 'team': team, 'opponent': fixture['opponent'],
                          'gameId': fixture['gameId'], 'season': season, 'week': week,
                          'athleteId': athlete_id, 'source': INJURIES_URL,
                          'reportedAt': reported.isoformat(), 'observedAt': now.isoformat(),
                          'sourceUpdatedAt': updated.isoformat()}
                if week_scoped:
                    report['weekScoped'] = True
                old = fresh.get(gsis)
                # Conservative duplicate handling: a lower-severity duplicate
                # cannot overwrite a current explicit OUT designation.
                if old is None or (SEVERITY[status], report['reportedAt']) > (SEVERITY[old['status']], old['reportedAt']):
                    fresh[gsis] = report
        for gsis, report in fresh.items():
            if gsis not in reports or report['status'] == 'OUT':
                reports[gsis] = report
        diagnostics['status'] = 'ok'
    except Exception as error:
        diagnostics['status'] = 'cached' if reports else 'unavailable'
        diagnostics['error'] = type(error).__name__ + ': ' + str(error)
    diagnostics['fresh_reports'] = len(fresh)
    diagnostics['matched_reports'] = len(reports)
    diagnostics['retained_out_reports'] = sum(bool(r.get('cached')) for r in reports.values())
    diagnostics['teams_with_reports'] = sorted({r['team'] for r in reports.values()})
    diagnostics['teams_without_reports'] = sorted(set(fixtures) - set(diagnostics['teams_with_reports']))
    return {'reports': reports, 'diagnostics': diagnostics}
