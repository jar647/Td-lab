#!/usr/bin/env python3
"""Compact timestamped NBA evidence. Preserve first-seen pre-tip predictions
without repeatedly copying the entire growing simulator lock history."""
import json
from pathlib import Path
from datetime import datetime, timezone

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'data/nba_evidence_archive.json'
NOW=datetime.now(timezone.utc).isoformat()
def load(p):
    try: return json.loads(p.read_text())
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

archive=load(OUT) or {'schema_version':1,'snapshots':[]}
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
archive={'schema_version':2,'snapshots':snapshots[-240:]}
payload=json.dumps(archive,separators=(',',':'))+'\n'
# Fail before writing/committing if archive would approach GitHub's 100 MB cap.
if len(payload.encode())>=40_000_000:
    raise SystemExit('Evidence archive exceeds 40 MB safety limit; split archive before publishing')
OUT.write_text(payload)
print(f"Compact NBA evidence: {len(archive['snapshots'])} captures, {len(payload.encode())} bytes")
