"""Game-scoped, sourced starter confirmations; never infer clearance from silence."""
import json
from pathlib import Path

BLOCKED = {'OUT', 'IR', 'INACTIVE', 'SUSPENDED', 'PUP', 'RES', 'DEV', 'CUT', 'RET', 'EXE'}

def apply_starter_context(records, season, week, confirmations=None):
    if confirmations is None:
        path = Path(__file__).resolve().parent / 'data' / 'nfl_starters.json'
        confirmations = json.loads(path.read_text()).get('confirmations', []) if path.exists() else []
    for confirmation in confirmations:
        if confirmation.get('season') != season or confirmation.get('week') != week:
            continue
        if not confirmation.get('source') or not confirmation.get('reported_at'):
            continue
        rows = [r for r in records if r.get('team') == confirmation.get('team')
                and r.get('opp') == confirmation.get('opponent') and r.get('pos') == 'QB']
        starters = [r for r in rows if r.get('player_id') == confirmation.get('player_id')]
        if len(starters) != 1:
            continue
        starter = starters[0]
        # An announcement never overrides a subsequent OUT or inactive record.
        if any(str(starter.get(k, '')).upper() in BLOCKED
               for k in ('availability', 'injuryReportStatus', 'gameDayAvailability')):
            continue
        for row in rows:
            row['qbRole'] = 'EXPECTED_STARTER' if row is starter else 'BACKUP'
            row['starterContext'] = dict(confirmation)
    return records
