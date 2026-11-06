#!/usr/bin/env python3
"""Grade immutable pre-tip NBA simulator forecasts against completed ESPN boxes."""
import json
from pathlib import Path
from datetime import datetime
from statistics import mean
ROOT=Path(__file__).resolve().parents[1]/'data'
def load(name):
 p=ROOT/name
 try:return json.loads(p.read_text())
 except (OSError,ValueError):return {}
def when(value):
 try:return datetime.fromisoformat(str(value).replace('Z','+00:00'))
 except (ValueError,TypeError):return None
games={str(g.get('id')):g for g in load('nba_games.json').get('games',[]) if g.get('status')=='STATUS_FINAL'}
archive=load('nba_evidence_archive.json').get('snapshots',[])
candidates=[]
for capture in archive:
 captured=when(capture.get('captured_at'))
 locks=capture.get('sources',{}).get('nba_simulator_locks')
 if not captured or not isinstance(locks,dict):continue
 if 'snapshots' not in locks or not isinstance(locks['snapshots'],list):
  raise SystemExit('NBA simulator lock archive missing snapshots list')
 for f in locks.get('snapshots',[]):
  tip=when(f.get('tipoff'));locked=when(f.get('locked_at'))
  if not tip or not locked or not (locked<=captured<tip):continue
  if not all(isinstance(f.get(k),(int,float)) for k in ('home','away','home_win')):continue
  candidates.append((captured,f))
# Earliest captured forecast for each game; no after-the-fact revisions.
earliest={}
for at,f in sorted(candidates,key=lambda x:x[0]):
 earliest.setdefault(str(f.get('game_id')),(at,f))
rows=[]
for gid,(at,f) in earliest.items():
 g=games.get(gid)
 if not g:continue
 def score(team):
  vals=[]
  for p in g.get('players',[]):
   if p.get('team')!=team or p.get('didNotPlay'):continue
   try:vals.append(float(p.get('stats',{}).get('PTS')))
   except (ValueError,TypeError):pass
  return sum(vals) if len(vals)>=5 else None
 h,a=score(g.get('home')),score(g.get('away'))
 if h is None or a is None:continue
 ph,pa=f['home'],f['away']
 actual=1 if h>a else 0 if h<a else None
 rows.append({'game_id':gid,'tipoff':f['tipoff'],'captured_at':at.isoformat(),
  'predicted_home':ph,'predicted_away':pa,'actual_home':h,'actual_away':a,
  'home_probability':f['home_win'],'score_mae':(abs(h-ph)+abs(a-pa))/2,
  'margin_error':abs((h-a)-(ph-pa)),'total_error':abs((h+a)-(ph+pa)),
  'brier':(f['home_win']-actual)**2 if actual is not None else None,
  'correct_winner':(f['home_win']>=.5)==bool(actual) if actual is not None else None,
  'model':f.get('model')})
def avg(key):return mean(r[key] for r in rows if r[key] is not None) if any(r[key] is not None for r in rows) else None
report={'method':'Earliest archived pre-tip simulator forecast per game; only final ESPN box scores; no backfilled forecasts',
 'captured_forecasts':len(earliest),'archive_snapshots':len(archive),'candidate_locks':len(candidates),'graded_games':len(rows),'score_mae':avg('score_mae'),
 'margin_mae':avg('margin_error'),'total_mae':avg('total_error'),'brier':avg('brier'),
 'winner_accuracy':avg('correct_winner'),'validated_for_betting':False,'rows':rows}
(ROOT/'nba_prospective_accuracy.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='rows'}))
