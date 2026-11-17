"""Share verified current-game injury evidence with the NFL score engine.

This consumes the collector's published evidence, never a guessed player-name
join. Missing reports remain unknown and a weaker source cannot clear an OUT.
"""
from copy import deepcopy
from datetime import datetime, timedelta, timezone

from nfl_depth_charts import canonical_team, identifier
from nfl_live_injuries import (INJURIES_URL, SEVERITY, STATUSES, _cached_out,
                               _fixtures, _integer, _records, _reported_in_game,
                               _roster_lookup, _stamp)

NEGATIVE = {**SEVERITY, 'INACTIVE': 3, 'IR': 3, 'INJURED RESERVE': 3,
            'INJURED_RESERVE': 3, 'SUSPENDED': 3, 'PUP': 3}


def merge_score_injury_reports(base_reports, status_payload, players, slate,
                               rosters, season, week, now=None):
    """Return existing team research reports enriched with exact live evidence.

    ``base_reports`` is the already scoped nflverse output from injury_research.
    Collector scope, ESPN/GSIS identity and report-window checks are repeated
    here. Only an exact game's previously verified OUT can outlive freshness.
    """
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ValueError('Score injury observation time must include a timezone')
    now = now.astimezone(timezone.utc)
    fixtures = _fixtures(slate, season, week, now)
    roster_join = _roster_lookup(rosters, season)
    metadata, teams_for_id = {}, {}
    for row in _records(rosters):
        if not isinstance(row, dict) or row.get('season') is not None and _integer(row['season']) != season:
            continue
        pid, team = row.get('gsis_id'), canonical_team(row.get('team'))
        if not isinstance(pid, str) or not pid.strip() or not team:
            continue
        teams_for_id.setdefault(pid, set()).add(team)
        metadata.setdefault((team, pid), {'names': [], 'positions': set()})
        item = metadata[(team, pid)]
        for key in ('full_name', 'football_name', 'display_name'):
            name = row.get(key)
            if isinstance(name, str) and name.strip():
                item['names'].append(name.strip())
                break
        position = row.get('position')
        if isinstance(position, str) and position.strip():
            item['positions'].add(position.upper().strip())
    for row in _records(players):
        if not isinstance(row, dict):
            continue
        pid, team = row.get('player_id'), canonical_team(row.get('team'))
        item = metadata.get((team, pid))
        if item is None or teams_for_id.get(pid) != {team}:
            continue
        if isinstance(row.get('player'), str) and row['player'].strip():
            item['names'].insert(0, row['player'].strip())
        if isinstance(row.get('pos'), str) and row['pos'].strip():
            item['positions'].add(row['pos'].upper().strip())

    status = status_payload if isinstance(status_payload, dict) else {}
    def mapping(value):
        return value if isinstance(value, dict) else {}
    live = mapping(mapping(mapping(status.get('availability_diagnostics')).get('injuries')).get('live_source'))
    if not isinstance(live, dict) or _integer(status.get('season')) != season or _integer(status.get('week')) != week:
        live = {}
    health = live.get('diagnostics', {}) if isinstance(live.get('diagnostics'), dict) else {}
    retained = _cached_out(live, fixtures, roster_join, season, week, now)
    accepted = {}
    rejected = 0
    published = live.get('reports', {})
    for pid, report in published.items() if isinstance(published, dict) else []:
        if not isinstance(pid, str) or not isinstance(report, dict):
            rejected += 1
            continue
        team = canonical_team(report.get('team'))
        fixture = fixtures.get(team)
        observed, updated, reported = (_stamp(report.get(k)) for k in ('observedAt', 'sourceUpdatedAt', 'reportedAt'))
        exact = (fixture is not None and report.get('source') == INJURIES_URL
                 and isinstance(report.get('status'), str) and report['status'] in STATUSES
                 and _integer(report.get('season')) == season and _integer(report.get('week')) == week
                 and report.get('gameId') == fixture['gameId']
                 and canonical_team(report.get('opponent')) == fixture['opponent']
                 and roster_join.get((team, identifier(report.get('athleteId')))) == pid
                 and _reported_in_game(reported, fixture, now, report.get('weekScoped') is True)
                 and observed is not None and observed <= now + timedelta(minutes=5)
                 and observed >= reported - timedelta(minutes=5)
                 and updated is not None and updated <= observed + timedelta(minutes=5)
                 and updated <= now + timedelta(minutes=5)
                 and observed - updated <= timedelta(hours=1))
        if not exact:
            rejected += 1
            continue
        fresh = (now - observed <= timedelta(minutes=90) and isinstance(health.get('status'), str)
                 and health['status'] in {'ok', 'partial'})
        if fresh or pid in retained:
            accepted[pid] = dict(report, cached=not fresh)
        else:
            rejected += 1

    result = {}
    for team in sorted(set(base_reports or {}) | set(fixtures)):
        original = (base_reports or {}).get(team, {})
        output = deepcopy(original) if isinstance(original, dict) else {}
        rows = {}
        for report in output.get('reports', []):
            if not isinstance(report, dict):
                continue
            pid = report.get('player_id')
            if not isinstance(pid, str) or teams_for_id.get(pid) != {team}:
                continue
            fixture = fixtures.get(team)
            if (report.get('season') is not None and _integer(report['season']) != season
                    or report.get('week') is not None and _integer(report['week']) != week
                    or report.get('team') is not None and canonical_team(report['team']) != team
                    or report.get('game_id') is not None and (not fixture or report['game_id'] != fixture['gameId'])):
                continue
            row = dict(report)
            if isinstance(row.get('designation'), str):
                row['designation'] = row['designation'].strip().upper()
            elif row.get('designation') is not None:
                continue
            old = rows.get(pid)
            if old is None or NEGATIVE.get(row.get('designation'), 0) >= NEGATIVE.get(old.get('designation'), 0):
                rows[pid] = row
        live_count = 0
        for pid, report in accepted.items():
            if canonical_team(report['team']) != team:
                continue
            item = metadata.get((team, pid), {'names': [], 'positions': set()})
            old = rows.get(pid, {})
            status_code = report['status']
            stronger = NEGATIVE.get(old.get('designation'), 0) > NEGATIVE[status_code]
            row = {**old, 'player_id': pid,
                   'player': old.get('player') or (item['names'][0] if item['names'] else pid),
                   'position': old.get('position') or (next(iter(item['positions'])) if len(item['positions']) == 1 else None),
                   'designation': old.get('designation') if stronger else status_code,
                   'practice': old.get('practice'), 'injury': old.get('injury'),
                   'season': season, 'week': week, 'team': team, 'opponent': report['opponent'],
                   'game_id': report['gameId'], 'live_evidence': deepcopy(report)}
            if not stronger:
                row.update(source=INJURIES_URL, source_updated_at=report['reportedAt'],
                           observed_at=report['observedAt'], source_document_updated_at=report['sourceUpdatedAt'],
                           cached=report.get('cached', False))
            rows[pid] = row
            live_count += 1
        output.update(reports=list(rows.values()), report_count=len(rows), live_report_count=live_count,
                      official_inactives_confirmed=False,
                      live_source={'status': health.get('status', 'unavailable'),
                                   'source': INJURIES_URL, 'observed_at': health.get('observed_at'),
                                   'accepted_reports': live_count, 'rejected_rows': rejected},
                      model_use='Verified negative game designations are shared with the score scenario. Questionable is not OUT; missing reports do not establish health. Unsupported replacement effects remain unmodeled.')
        output['coverage'] = 'REPORTED_WITH_LIVE_SOURCE' if live_count else output.get('coverage', 'SOURCE_UNAVAILABLE')
        result[team] = output
    return result
