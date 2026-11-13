"""Validate the real provider attempt without mistaking throttling for live prices."""
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
from nba_model import fresh, UTC


def fingerprint(path):
    path = Path(path)
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None


def verify(status, odds_path, before, now=None):
    now = now or dt.datetime.now(UTC)
    if not fresh({'generated_at': status.get('generated_at')}, now, 1):
        raise ValueError('Provider attempt status is not current')
    if status.get('status') == 'ok':
        odds = json.loads(Path(odds_path).read_text())
        quotes = odds.get('markets', [])
        if status.get('live_price_verified') is not True or not fresh(odds, now, 1) or not quotes:
            raise ValueError('Successful provider attempt requires actual fresh quotes')
        if any(not fresh({'generated_at': q.get('observed_at')}, now, 1) for q in quotes):
            raise ValueError('A published provider quote is stale or future dated')
        return {'mode': 'FRESH_PRICES_VERIFIED', 'live_price_verified': True,
                'verified_markets': len(quotes), 'checked_at': now.isoformat()}
    if status.get('status') != 'unavailable' or status.get('reason_code') != 'provider_rate_limit':
        raise ValueError('Provider authentication or unknown failures do not pass the live gate')
    if status.get('live_price_verified') is not False or status.get('rate_limit_source') not in ('http_429', 'persisted_cooldown'):
        raise ValueError('Rate-limit mode needs an identified HTTP 429 or its saved cooldown')
    try:
        retry = dt.datetime.fromisoformat(status['retry_at'].replace('Z', '+00:00'))
        if retry.tzinfo is None or retry <= now:
            raise ValueError('Expired or timezone-free cooldown')
    except (KeyError, TypeError, ValueError):
        raise ValueError('Rate-limit mode needs a valid future retry time') from None
    if fingerprint(odds_path) != before.get('sha256'):
        raise ValueError('Rate-limited refresh changed or re-dated retained prices')
    return {'mode': 'RESEARCH_ONLY_PROVIDER_RATE_LIMITED', 'live_price_verified': False,
            'priced_path': 'UNVERIFIED', 'retained_prices_unchanged': True,
            'retry_at': retry.isoformat(), 'checked_at': now.isoformat()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--status', default='data/nba_market_status.json')
    parser.add_argument('--odds', default='data/nba_market_odds.json')
    parser.add_argument('--before', required=True)
    parser.add_argument('--evidence', required=True)
    args = parser.parse_args()
    evidence = verify(json.loads(Path(args.status).read_text()), args.odds,
                      json.loads(Path(args.before).read_text()))
    Path(args.evidence).write_text(json.dumps(evidence, indent=2)+'\n')
    print(json.dumps(evidence))


if __name__ == '__main__':
    main()
