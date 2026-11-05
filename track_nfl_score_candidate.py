#!/usr/bin/env python3
"""Freeze first observed pregame candidate/baseline pair; never rewrite a forecast."""
import copy
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def track(feed, ledger, results, now):
    out = copy.deepcopy(ledger)
    records = out.setdefault('records', {})
    for game in feed.get('games', []):
        candidate = game.get('model_inputs', {}).get('score_candidate')
        kickoff = game.get('kickoff_at')
        if not candidate or not kickoff:
            continue
        try:
            start = datetime.fromisoformat(kickoff.replace('Z', '+00:00'))
            generated = datetime.fromisoformat(feed['generated_at'].replace('Z', '+00:00'))
        except (ValueError, KeyError, TypeError):
            continue
        if start.tzinfo is None or generated.tzinfo is None or not generated <= now < start or (now-generated).total_seconds() > 86400:
            continue
        key = game['game_id']+'|'+candidate['version']
        if key not in records:
            records[key] = {'game_id': game['game_id'], 'version': candidate['version'],
                'frozen_at': now.isoformat(), 'kickoff_at': kickoff,
                'baseline': {'home': game['projected_home_points'], 'away': game['projected_away_points']},
                'candidate': copy.deepcopy(candidate)}
    for entry in records.values():
        if 'actual' in entry or now < datetime.fromisoformat(entry['kickoff_at'].replace('Z', '+00:00')):
            continue
        actual = results.get('games', {}).get(entry['game_id'])
        if actual:
            entry['actual'] = copy.deepcopy(actual)
    graded = [r for r in records.values() if 'actual' in r]
    out['summary'] = {'frozen': len(records), 'graded': len(graded), 'models': {}}
    for name in ['baseline', 'candidate']:
        def error(r, kind):
            p, a = r[name], r['actual']
            return abs((p['home']-p['away'])-(a['home']-a['away'])) if kind == 'margin' else abs((p['home']+p['away'])-(a['home']+a['away']))
        out['summary']['models'][name] = {kind+'_mae': round(sum(error(r, kind) for r in graded)/len(graded), 4) if graded else None for kind in ['margin', 'total']}
    out['status'] = 'PROSPECTIVE_SHADOW_COMPARISON_NOT_CALIBRATED'
    return out


def main():
    path = ROOT/'data/nfl_score_candidate_forecasts.json'
    read = lambda p: json.loads(p.read_text()) if p.exists() else {}
    result = track(read(ROOT/'data/game_picks.json'), read(path), read(ROOT/'data/game_score_results.json'), datetime.now(timezone.utc))
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(result, indent=2, allow_nan=False)+'\n')
    temp.replace(path)
    print(json.dumps(result['summary']))


if __name__ == '__main__':
    main()
