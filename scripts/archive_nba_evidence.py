#!/usr/bin/env python3
"""Compact timestamped NBA evidence. Preserve first-seen pre-tip predictions
without repeatedly copying the entire growing simulator lock history."""
import json
import gzip
from pathlib import Path
from datetime import datetime, timezone

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'data/nba_evidence_archive.json.gz'
LEGACY=ROOT/'data/nba_evidence_archive.json'
NOW=datetime.now(timezone.utc).isoformat()
def load(p):
    try: return json.loads(gzip.decompress(p.read_bytes()).decode()) if p.suffix=='.gz' else json.loads(p.read_text())
    except (OSError, ValueError): return None

def compact_lock(f):
    return {k:f[k] for k in ('capture_id','game_id','model','locked_at','tipoff','home','away','home_win','baseline','margin_interval','total_interval','input_timestamps','uncertain','warnings') if k in f}

def compact_sources(sources,seen):
    result={}
    for name,value in sources.items():
        if name=='nba_simulator_locks' and isinstance(value,dict):
            fresh=[]
            for f in value.get('snapshots',[]):
                if not isinstance(f,dict):continue
                key=str(f.get('capture_id') or (f.get('game_id'),f.get('locked_at'),f.get('home'),f.get('away')))
                if key in seen:continue
                seen.add(key)
                fresh.append(compact_lock(f))
            result[name]={'snapshots':fresh}
        elif name=='nba_injuries' and isinstance(value,dict):
            # Retain the timestamped injury states, not redundant metadata.
            result[name]={k:value[k] for k in ('generated_at','injuries') if k in value}
        else:
            result[name]=value
    return result

archive=load(OUT) or load(LEGACY) or {'schema_version':1,'snapshots':[]}
manifest_path=ROOT/'data/nba_evidence_manifest.json'
if manifest_path.exists():
    manifest=load(manifest_path)
    rows=[]
    for name in manifest['shards']:
        if not isinstance(name,str) or not name.startswith('nba_evidence_') or not name.endswith('.json.gz') or '/' in name:
            raise SystemExit('Invalid evidence shard')
        part=load(ROOT/'data'/name)
        if not isinstance(part,dict) or not isinstance(part.get('snapshots'),list):
            raise SystemExit('Missing evidence shard')
        rows.extend(part['snapshots'])
    if len(rows)!=manifest['snapshot_count']:raise SystemExit('Evidence count mismatch')
    archive={'schema_version':3,'snapshots':rows}
old=archive.get('snapshots',[])
seen=set()
snapshots=[]
for row in old:
    if not isinstance(row,dict) or not isinstance(row.get('sources'),dict):continue
    snapshots.append({**row,'sources':compact_sources(row['sources'],seen)})
sources={}
for name in ('nba_injuries','nba_market_odds','nba_simulator_locks'):
    value=load(ROOT/'data'/f'{name}.json')
    if value is not None:sources[name]=value
if not sources:raise SystemExit('No NBA evidence feeds found')
compact=compact_sources(sources,seen)
# Preserve an existing timestamp if sources are unchanged; otherwise append.
if snapshots and snapshots[-1]['sources']==compact:
    print('No new evidence; compacted existing archive')
else:
    snapshots.append({'captured_at':NOW,'sources':compact,'evidence_type':'capture_not_verified_closing_line'})
snapshots=snapshots[-240:]
def encode(rows):
    return gzip.compress((json.dumps({'schema_version':3,'snapshots':rows},separators=(',',':'))+'\n').encode(),compresslevel=9,mtime=0)
shards=[]
current=[]
for row in snapshots:
    trial=current+[row]
    if current and len(encode(trial))>=20_000_000:
        shards.append(current)
        current=[row]
    else:current=trial
    if len(encode(current))>=20_000_000:raise SystemExit('Single capture exceeds shard limit')
if current:shards.append(current)
if not shards:raise SystemExit('No evidence')
names=[]
for i,rows in enumerate(shards):
    name=f'nba_evidence_{i:04d}.json.gz'
    (ROOT/'data'/name).write_bytes(encode(rows))
    names.append(name)
OUT.write_bytes(encode(shards[0]))
manifest_path.write_text(json.dumps({'schema_version':3,'shards':names,'snapshot_count':len(snapshots)},indent=2)+'\n')
for old in (ROOT/'data').glob('nba_evidence_*.json.gz'):
    if old != OUT and old.name not in names:old.unlink()
print(f'NBA evidence: {len(snapshots)} captures in {len(names)} shards')
