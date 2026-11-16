#!/usr/bin/env python3
"""Compact timestamped NBA evidence without quadratic recompression.

Preserve first-seen pre-tip predictions and the existing 240-capture window.
"""
import gzip
import json
import zlib
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SHARD_LIMIT = 20_000_000
HEADER = b'{"schema_version":3,"snapshots":['
FOOTER = b']}\n'


def load(path):
    try:
        return json.loads(gzip.decompress(path.read_bytes()).decode()) if path.suffix == '.gz' else json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def compact_lock(forecast):
    return {key: forecast[key] for key in ('capture_id', 'game_id', 'model', 'locked_at', 'tipoff', 'home', 'away', 'home_win', 'baseline', 'margin_interval', 'total_interval', 'input_timestamps', 'uncertain', 'warnings') if key in forecast}


def compact_sources(sources, seen):
    result = {}
    for name, value in sources.items():
        if name == 'nba_simulator_locks' and isinstance(value, dict):
            fresh = []
            for forecast in value.get('snapshots', []):
                if not isinstance(forecast, dict):
                    continue
                key = str(forecast.get('capture_id') or (forecast.get('game_id'), forecast.get('locked_at'), forecast.get('home'), forecast.get('away')))
                if key in seen:
                    continue
                seen.add(key)
                fresh.append(compact_lock(forecast))
            result[name] = {'snapshots': fresh}
        elif name == 'nba_injuries' and isinstance(value, dict):
            result[name] = {key: value[key] for key in ('generated_at', 'injuries') if key in value}
        else:
            result[name] = value
    return result


def load_archive(data):
    manifest_path = data / 'nba_evidence_manifest.json'
    if manifest_path.exists():
        manifest = load(manifest_path)
        rows = []
        for name in manifest['shards']:
            if not isinstance(name, str) or not name.startswith('nba_evidence_') or not name.endswith('.json.gz') or '/' in name:
                raise ValueError('Invalid evidence shard')
            part = load(data / name)
            if not isinstance(part, dict) or not isinstance(part.get('snapshots'), list):
                raise ValueError('Missing evidence shard')
            rows.extend(part['snapshots'])
        if len(rows) != manifest['snapshot_count']:
            raise ValueError('Evidence count mismatch')
        return {'schema_version': 3, 'snapshots': rows}
    return load(data / 'nba_evidence_archive.json.gz') or load(data / 'nba_evidence_archive.json') or {'schema_version': 1, 'snapshots': []}


def iter_encoded_shards(rows, limit=SHARD_LIMIT):
    """Yield deterministic gzip shards strictly below limit in one forward pass.

    A copied compressor checks the exact final size after adding a record. It
    retains the accepted compression state, rather than re-encoding every
    growing prefix. Only the record crossing a shard boundary is compressed
    twice. Gzip headers emitted by zlib use mtime=0.
    """
    compressor = zlib.compressobj(level=9, wbits=31)
    chunks = [compressor.compress(HEADER)]
    size, count = len(chunks[0]), 0
    for row in rows:
        encoded = json.dumps(row, separators=(',', ':')).encode()
        for _ in range(2):
            trial = compressor.copy()
            addition = trial.compress((b',' if count else b'') + encoded)
            closing = trial.copy()
            final = closing.compress(FOOTER) + closing.flush()
            if size + len(addition) + len(final) < limit:
                compressor = trial
                chunks.append(addition)
                size += len(addition)
                count += 1
                break
            if not count:
                raise ValueError('Single capture exceeds shard limit')
            yield b''.join(chunks + [compressor.compress(FOOTER), compressor.flush()])
            compressor = zlib.compressobj(level=9, wbits=31)
            chunks = [compressor.compress(HEADER)]
            size, count = len(chunks[0]), 0
    if not count:
        raise ValueError('No evidence')
    yield b''.join(chunks + [compressor.compress(FOOTER), compressor.flush()])


def publish(root=ROOT, now=None):
    data = Path(root) / 'data'
    now = now or datetime.now(timezone.utc)
    archive = load_archive(data)
    seen, snapshots = set(), []
    for row in archive.get('snapshots', []):
        if not isinstance(row, dict) or not isinstance(row.get('sources'), dict):
            continue
        snapshots.append({**row, 'sources': compact_sources(row['sources'], seen)})
    sources = {}
    for name in ('nba_injuries', 'nba_market_odds', 'nba_simulator_locks'):
        value = load(data / (name + '.json'))
        if value is not None:
            sources[name] = value
    if not sources:
        raise ValueError('No NBA evidence feeds found')
    compact = compact_sources(sources, seen)
    if snapshots and snapshots[-1]['sources'] == compact:
        print('No new evidence; compacted existing archive')
    else:
        snapshots.append({'captured_at': now.isoformat(), 'sources': compact, 'evidence_type': 'capture_not_verified_closing_line'})
    snapshots = snapshots[-240:]
    # Validate every shard before replacing any last-good archive file.
    encoded_shards = list(iter_encoded_shards(snapshots))
    names = []
    for index, encoded in enumerate(encoded_shards):
        name = f'nba_evidence_{index:04d}.json.gz'
        (data / name).write_bytes(encoded)
        if index == 0:
            (data / 'nba_evidence_archive.json.gz').write_bytes(encoded)
        names.append(name)
    manifest = {'schema_version': 3, 'shards': names, 'snapshot_count': len(snapshots)}
    (data / 'nba_evidence_manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    for old in data.glob('nba_evidence_*.json.gz'):
        if old.name != 'nba_evidence_archive.json.gz' and old.name not in names:
            old.unlink()
    print(f'NBA evidence: {len(snapshots)} captures in {len(names)} shards')
    return manifest


if __name__ == '__main__':
    try:
        publish()
    except ValueError as error:
        raise SystemExit(str(error)) from error
