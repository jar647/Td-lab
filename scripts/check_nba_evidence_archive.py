#!/usr/bin/env python3
"""Fail closed on malformed NBA prospective evidence; report market coverage."""
import json
import gzip
from pathlib import Path
from datetime import datetime, timezone

root=Path(__file__).resolve().parents[1]
p=root/'data/nba_evidence_archive.json.gz'
if not p.exists(): raise SystemExit('Evidence archive missing')
manifest_path=root/'data/nba_evidence_manifest.json'
if manifest_path.exists():
    manifest=json.loads(manifest_path.read_text())
    rows=[]
    for name in manifest['shards']:
        if not isinstance(name,str) or not name.startswith('nba_evidence_') or not name.endswith('.json.gz') or '/' in name:raise SystemExit('Invalid evidence shard')
        part=root/'data'/name
        if not part.exists() or part.stat().st_size>=20_000_000:raise SystemExit('Missing or oversized shard')
        rows.extend(json.loads(gzip.decompress(part.read_bytes()).decode()).get('snapshots',[]))
    if len(rows)!=manifest['snapshot_count']:raise SystemExit('Evidence count mismatch')
else:
    data=json.loads(gzip.decompress(p.read_bytes()).decode())
    rows=data.get('snapshots',[])
if not rows: raise SystemExit('No evidence snapshots')
previous=None
coverage={'snapshots':len(rows),'injury_snapshots':0,'market_snapshots':0,'lock_snapshots':0,'market_snapshots_with_game_lines':0}
for row in rows:
    at=datetime.fromisoformat(row['captured_at'].replace('Z','+00:00'))
    if at.tzinfo is None: raise SystemExit('Naive capture timestamp')
    if previous and at<=previous: raise SystemExit('Capture timestamps not increasing')
    if at>datetime.now(timezone.utc): raise SystemExit('Future capture timestamp')
    previous=at
    sources=row['sources']
    if not isinstance(sources,dict): raise SystemExit('Invalid snapshot sources')
    for name,key in [('nba_injuries','injury_snapshots'),('nba_market_odds','market_snapshots'),('nba_simulator_locks','lock_snapshots')]:
        if name in sources and sources[name] is not None: coverage[key]+=1
    odds=sources.get('nba_market_odds')
    if odds and isinstance(odds,(dict,list)):
        if isinstance(odds,list) and odds: coverage['market_snapshots_with_game_lines']+=1
        elif isinstance(odds,dict) and any(isinstance(v,(dict,list)) and bool(v) for k,v in odds.items() if k not in ('generated_at','status','source','updated_at','date')):
            coverage['market_snapshots_with_game_lines']+=1
print(json.dumps(coverage))
