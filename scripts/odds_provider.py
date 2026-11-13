"""Bounded OddsPapi transport shared by NBA and NFL exporters.

Only public catalog/fixture responses are cached. Odds responses are always
requested live; cached prices are never re-dated by this transport.
"""
import datetime as dt
import email.utils
import json
import math
import os
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
UTC = dt.timezone.utc
CACHE_SECONDS = {'fixtures': 600, 'markets': 86400, 'tournaments': 86400}
MAX_CACHE_BYTES = 8 * 1024 * 1024
DEFAULT_COOLDOWN_SECONDS = 900
SENSITIVE_FIELDS = {'apikey', 'authorization', 'password', 'secret', 'token', 'accesstoken'}


class ProviderRateLimit(RuntimeError):
    def __init__(self, retry_at, endpoint, source='http_429'):
        super().__init__('Odds provider HTTP 429')
        self.retry_at = retry_at
        self.endpoint = endpoint
        self.source = source

    def safe_details(self):
        return {'retry_at': self.retry_at, 'endpoint': self.endpoint,
                'rate_limit_source': self.source}


def stamp(value):
    try:
        value = dt.datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return value.astimezone(UTC) if value.tzinfo else None
    except (ValueError, TypeError, OverflowError):
        return None


def read(path):
    try:
        result = json.loads(path.read_text())
        return result if isinstance(result, dict) else {}
    except (OSError, ValueError, TypeError):
        return {}


def atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, separators=(',', ':'), allow_nan=False))
    temporary.replace(path)


def public_response(value, secret):
    """Defensively exclude echoed credentials from the persisted public catalog."""
    redact = lambda text: text.replace(secret, '[redacted]') if secret else text
    if isinstance(value, dict):
        return {redact(k): public_response(v, secret) for k, v in value.items()
                if ''.join(c for c in k.lower() if c.isalnum()) not in SENSITIVE_FIELDS}
    if isinstance(value, list):
        return [public_response(v, secret) for v in value]
    return redact(value) if isinstance(value, str) else value


def retry_time(headers, now):
    """Parse only a reset instant, never persist raw headers or provider URLs."""
    raw = headers.get('Retry-After') if headers else None
    try:
        seconds = float(raw)
        if not math.isfinite(seconds) or seconds < 0:
            raise ValueError('Invalid retry duration')
        return now + dt.timedelta(seconds=max(60, math.ceil(seconds)))
    except (ValueError, TypeError, OverflowError):
        pass
    try:
        date = email.utils.parsedate_to_datetime(raw)
        if date.tzinfo is None:
            raise ValueError('Missing reset timezone')
        return max(date.astimezone(UTC), now + dt.timedelta(seconds=60))
    except (ValueError, TypeError, OverflowError, AttributeError):
        return now + dt.timedelta(seconds=DEFAULT_COOLDOWN_SECONDS)


def request_json(endpoint, params, *, root=ROOT, now=None, opener=None, sleep=None):
    now = now or dt.datetime.now(UTC)
    opener = opener or urllib.request.urlopen
    sleep = sleep or time.sleep
    key = os.environ.get('ODDSPAPI_API_KEY')
    if not key:
        raise RuntimeError('Missing ODDSPAPI_API_KEY')
    if endpoint not in {'fixtures', 'markets', 'tournaments', 'odds'}:
        raise ValueError('Unsupported odds provider endpoint')
    if any(''.join(c for c in k.lower() if c.isalnum()) in SENSITIVE_FIELDS for k in params):
        raise ValueError('Credentials cannot be supplied as provider parameters')
    root = Path(root)
    state_path, cache_path = root/'data/odds_provider_state.json', root/'data/odds_provider_cache.json'
    cache = read(cache_path)
    if not isinstance(cache.get('entries'), dict):
        cache = {'entries': {}}
    cache_key = endpoint + '|' + json.dumps(params, sort_keys=True, separators=(',', ':'))
    ttl = CACHE_SECONDS.get(endpoint)
    entry = cache.get('entries', {}).get(cache_key, {}) if ttl else {}
    if not isinstance(entry, dict):
        entry = {}
    observed = stamp(entry.get('observed_at'))
    if observed and 0 <= (now-observed).total_seconds() <= ttl and 'response' in entry:
        return entry['response']
    state = read(state_path)
    retry_at = stamp(state.get('retry_at'))
    if state.get('reason_code') == 'provider_rate_limit' and retry_at and retry_at > now:
        raise ProviderRateLimit(retry_at.isoformat(), endpoint, 'persisted_cooldown')
    url = 'https://api.oddspapi.io/v4/' + endpoint + '?' + urllib.parse.urlencode({'apiKey': key, **params})
    for attempt in range(3):
        try:
            with opener(urllib.request.Request(url, headers={'User-Agent': 'TD-LAB-feed/1.1'}), timeout=30) as response:
                result = json.load(response)
            if not isinstance(result, (dict, list)):
                raise RuntimeError('Odds provider invalid response')
            atomic(state_path, {'provider': 'OddsPapi', 'status': 'ok', 'last_success_at': now.isoformat()})
            if ttl:
                entries = {k:v for k,v in cache.get('entries', {}).items()
                           if isinstance(v, dict) and stamp(v.get('observed_at'))
                           and 0 <= (now-stamp(v['observed_at'])).total_seconds() <= 86400}
                entries[cache_key] = {'observed_at': now.isoformat(), 'response': public_response(result, key)}
                value = {'provider': 'OddsPapi', 'entries': entries}
                if len(json.dumps(value, separators=(',', ':')).encode()) <= MAX_CACHE_BYTES:
                    atomic(cache_path, value)
            return result
        except urllib.error.HTTPError as exc:
            if exc.code == 429:
                reset = retry_time(exc.headers, now)
                atomic(state_path, {'provider': 'OddsPapi', 'status': 'unavailable',
                    'reason_code': 'provider_rate_limit', 'observed_at': now.isoformat(),
                    'retry_at': reset.isoformat(), 'endpoint': endpoint})
                # Retrying a quota response immediately only spends more quota.
                raise ProviderRateLimit(reset.isoformat(), endpoint) from None
            raise RuntimeError('Odds provider HTTP ' + str(exc.code)) from None
        except (urllib.error.URLError, TimeoutError):
            if attempt == 2:
                raise RuntimeError('Odds provider unavailable') from None
            sleep(2 * (attempt + 1))
    raise RuntimeError('Odds provider retry limit reached')
