#!/usr/bin/env python3
"""Append-only NBA feed snapshot archive. Snapshot timestamps are capture times,
not verified pre-tip injury states or sportsbook closing lines."""
import json
from pathlib import Path
from datetime import datetime, timezone

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'data/nba_evidence_archive.json'
NOW=datetime.now(timezone.utc).isoformat()
def load(p):
    try: return json.loads(p.read_text())
    except (OSError,ValueError): return None
archive=load(OUT) or {'schema_version':1,'snapshots':[]}
sources={}
for name in ('nba_injuries','nba_market_odds','nba_simulator_locks'):
    value=load(ROOT/'data'/f'{name}.json')
    if value is not None:
        if name == 'nba_games':
            # Full historical box scores already live in nba_games.json; avoid
            # duplicating the entire growing feed every thirty minutes.
            games=value.get('games',[]) if isinstance(value,dict) else []
            sources[name]={'game_count':len(games),'latest_game_date':max((str(g.get('date','')) for g in games),default='')}
        else:
            sources[name]=value
if not sources: raise SystemExit('No NBA evidence feeds found')
# Preserve the source as published, including its own generated timestamp.
# Historical game results remain in nba_games.json; don't duplicate them in every snapshot.
snapshot={'captured_at':NOW,'sources':sources,'evidence_type':'capture_not_verified_closing_line'}
snapshots=archive.setdefault('snapshots',[])
if snapshots and snapshots[-1]['sources']==sources:
    print('No source changes; no duplicate snapshot')
else:
    snapshots.append(snapshot)
    # Keep up to 240 distinct snapshots, including their original capture times.
    archive['snapshots']=snapshots[-240:]
    OUT.write_text(json.dumps(archive,separators=(',',':'))+'\n')
    print(f"Archived feed snapshot at {NOW}; retained {len(archive['snapshots'])}")
