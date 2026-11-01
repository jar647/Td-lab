"""Timestamped secondary injury/news source, kept separate from nflverse reports."""
from datetime import datetime, timezone
import json
from urllib.request import Request, urlopen

SOURCE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries'
ALIASES = {'WSH':'WAS','LAR':'LA','JAC':'JAX'}


def timestamp(value):
    try:
        t = datetime.fromisoformat(str(value).replace('Z','+00:00'))
        return t.astimezone(timezone.utc) if t.tzinfo else None
    except (TypeError,ValueError):
        return None


def parse_news(payload, season, teams, now=None):
    now = now or datetime.now(timezone.utc)
    payload = payload if isinstance(payload,dict) else {}
    stamp = timestamp(payload.get('timestamp'))
    current = stamp is not None and -300 <= (now-stamp).total_seconds() <= 12*3600
    season_info = payload.get('season') if isinstance(payload.get('season'),dict) else {}
    valid = payload.get('status') == 'success' and season_info.get('year') == season and current
    output = {t:{'coverage':'SOURCE_UNAVAILABLE','source':SOURCE,'retrieved_at':now.isoformat(),
                 'source_updated_at':stamp.isoformat() if stamp else None,'reports':[],
                 'current':False,'official_inactives_confirmed':False,
                 'model_use':'Secondary injury/news context; replacement point impacts are not estimated.'} for t in teams}
    if not valid:
        for item in output.values():item['reason']='Season mismatch, stale/future source timestamp or source failure'
        return output
    for item in output.values():item['coverage']='NO_MATCHED_SECONDARY_REPORTS'
    for group in payload.get('injuries') or []:
        if not isinstance(group,dict):continue
        for row in group.get('injuries') or []:
            if not isinstance(row,dict):continue
            athlete = row.get('athlete') or {}
            identity = athlete.get('team') or {}
            team = ALIASES.get(identity.get('abbreviation'),identity.get('abbreviation'))
            updated = timestamp(row.get('date'))
            if team not in output or str(identity.get('id')) != str(group.get('id')) or not athlete.get('displayName') or not row.get('id') or not updated or updated > now:
                continue
            item = output[team]
            item.update(coverage='CURRENT_SECONDARY_REPORTS',current=True)
            source_url = next((x.get('href') for x in athlete.get('links',[]) if 'playercard' in x.get('rel',[]) and str(x.get('href','')).startswith('https://')), SOURCE)
            item['reports'].append({'player':athlete.get('displayName'),'source_report_id':str(row['id']),
                'source_player_id':str(athlete['id']) if athlete.get('id') else None,
                'position':(athlete.get('position') or {}).get('abbreviation'),'designation':row.get('status'),
                'injury':(row.get('details') or {}).get('type'),'source_updated_at':updated.isoformat(),
                'report_age_hours':(now-updated).total_seconds()/3600,'summary':row.get('shortComment'),
                'source_url':source_url})
    return output


def fetch_news(season, teams):
    now = datetime.now(timezone.utc)
    try:
        request = Request(SOURCE,headers={'User-Agent':'CoOkItUp/1.0 (+https://github.com/jar647/Td-lab)'})
        with urlopen(request,timeout=15) as response:
            return parse_news(json.load(response),season,teams,now)
    except (OSError,ValueError,TypeError) as exc:
        result = parse_news({},season,teams,now)
        for item in result.values():item['reason']='Injury news fetch failed: '+type(exc).__name__
        return result
