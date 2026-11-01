#!/usr/bin/env python3
"""Archive newly observed full-game quotes without inventing or backdating prices.

Usage: python scripts/archive_game_odds.py quotes.json
Schema and distinction from closing proxies: docs/game-projection-validation.md.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from game_market import american, number


def timestamp(value):
    result = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('Quote and kickoff timestamps must include timezone')
    return result.astimezone(timezone.utc)


def validate(feed, now=None):
    now = now or datetime.now(timezone.utc)
    captured = timestamp(feed.get('captured_at'))
    if not 0 <= (now - captured).total_seconds() <= 900:
        raise ValueError('Capture must be observed within the last 15 minutes; no future/backdated quotes')
    for key in ('source', 'sportsbook'):
        if not isinstance(feed.get(key), str) or not feed[key].strip():
            raise ValueError('Missing quote ' + key)
    if not isinstance(feed.get('games'), list) or not feed['games']:
        raise ValueError('No game quotes supplied')
    ids = set()
    for g in feed['games']:
        if any(not isinstance(g.get(k), str) or not g[k].strip() for k in ('game_id', 'home', 'away')):
            raise ValueError('Missing game identity')
        if g['game_id'] in ids or g['home'] == g['away']:
            raise ValueError('Duplicate game or invalid teams')
        ids.add(g['game_id'])
        if timestamp(g.get('kickoff')) <= captured:
            raise ValueError('Quote is not pre-kickoff')
        markets = 0
        for line, sides in ((None, ('homeML','awayML')), ('homeSpread', ('homeATS','awayATS')), ('total', ('over','under'))):
            supplied = any(g.get(k) is not None for k in sides) or (line is not None and g.get(line) is not None)
            if not supplied:
                continue
            if any(american(g.get(k)) is None for k in sides):
                raise ValueError('Both sides require valid American odds: ' + '/'.join(sides))
            if line is not None:
                value = number(g.get(line))
                if value is None or (line == 'homeSpread' and abs(value) > 35) or (line == 'total' and not 15 <= value <= 90):
                    raise ValueError('Invalid ' + line)
            markets += 1
        if not markets:
            raise ValueError('Game has no complete two-sided market')
    # Timestamp validation cannot independently verify a submitted sportsbook price.
    return {**feed, 'capture_policy': 'Fresh timestamped user/source-supplied pregame quotes; price authenticity not independently verified',
            'spread_convention': 'Home handicap: negative for home favorite; home_score + homeSpread - away_score',
            'historical_closing_proxy': False}


def archive(feed, root=Path('data/game_odds_history'), now=None):
    validated = validate(feed, now)
    payload = json.dumps(validated, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n'
    digest = hashlib.sha256(payload.encode()).hexdigest()[:16]
    stamp = timestamp(validated['captured_at']).strftime('%Y%m%dT%H%M%S%fZ')
    destination = Path(root) / (stamp + '-' + digest + '.json')
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        with destination.open('x') as output:
            output.write(payload)
    except FileExistsError:
        if destination.read_text() != payload:
            raise ValueError('Archived quote collision')
    return destination


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('quotes', type=Path)
    parser.add_argument('--output-dir', type=Path, default=Path(__file__).resolve().parents[1] / 'data/game_odds_history')
    args = parser.parse_args()
    print(archive(json.loads(args.quotes.read_text()), args.output_dir))
