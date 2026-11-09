/* Shadow-only NBA score-bias correction from immutable pregame captures.
 * Never changes the actual game simulator, markets, or pregame locks.
 * Chronological replay assumes finals are knowable 18 hours after tipoff;
 * only a shadow correction frozen before a future game is a truly prospective test. */
'use strict';
const MIN_HISTORY=12,MAX_HISTORY=80,EMBARGO_MS=18*3600000,SHRINK_GAMES=24,MAX_SHIFT=4;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const avg=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const timestamp=x=>{const v=Date.parse(x);return Number.isFinite(v)?v:null;};
const round=x=>Math.round(x*10)/10;
function valid(lock,version){
 if(!lock||lock.model!==version||lock.rotation_fallback||!lock.grade)return false;
 const captured=timestamp(lock.locked_at),tip=timestamp(lock.tipoff),g=lock.grade;
 return captured!==null&&tip!==null&&captured<tip&&
  [lock.home,lock.away,g.home,g.away].every(finite)&&
  lock.home>=0&&lock.away>=0&&g.home>=0&&g.away>=0&&
  String(lock.game_id||'').length>0;
}
function latestSnapshots(snapshots,version){
 const byGame=new Map();
 for(const lock of snapshots||[]){
  if(!valid(lock,version))continue;
  const id=String(lock.game_id),previous=byGame.get(id);
  if(!previous||timestamp(lock.locked_at)>timestamp(previous.locked_at))byGame.set(id,lock);
 }
 return [...byGame.values()].sort((a,b)=>timestamp(a.locked_at)-timestamp(b.locked_at)||String(a.game_id).localeCompare(String(b.game_id)));
}
function estimate(target,history,version){
 const captured=timestamp(target?.locked_at),tip=timestamp(target?.tipoff);
 if(!target||target.model!==version||captured===null||tip===null||captured>=tip||![target.home,target.away].every(finite)||target.rotation_fallback)return null;
 const prior=latestSnapshots(history,version).filter(x=>
  String(x.game_id)!==String(target.game_id)&&timestamp(x.tipoff)+EMBARGO_MS<=captured
 ).sort((a,b)=>timestamp(b.tipoff)-timestamp(a.tipoff)).slice(0,MAX_HISTORY);
 if(prior.length<MIN_HISTORY)return null;
 // Heavy shrinkage, robust error cap, and a four-point shift ceiling keep this
 // a conservative hypothesis, not an automatically approved adjustment.
 const homeBias=avg(prior.map(x=>clamp(x.home-x.grade.home,-35,35)));
 const awayBias=avg(prior.map(x=>clamp(x.away-x.grade.away,-35,35)));
 const reliability=prior.length/(prior.length+SHRINK_GAMES);
 const homeShift=round(clamp(-homeBias*reliability,-MAX_SHIFT,MAX_SHIFT));
 const awayShift=round(clamp(-awayBias*reliability,-MAX_SHIFT,MAX_SHIFT));
 return {status:'SHADOW_ONLY',historically_validated:false,training_games:prior.length,
  embargo_hours:EMBARGO_MS/3600000,home_shift:homeShift,away_shift:awayShift,
  home:round(Math.max(0,target.home+homeShift)),away:round(Math.max(0,target.away+awayShift)),
  method:'Earlier same-version frozen pregame games only; last 80, 18h final-score embargo, winsorized score error, 24-game shrinkage, +/-4-point cap. Not applied to live markets or winning chances.'};
}
function compare(rows,source){
 if(!rows.length)return {games:0,source,raw_margin_mae:null,shadow_margin_mae:null,raw_total_mae:null,shadow_total_mae:null,baseline_margin_mae:null,baseline_total_mae:null};
 const diff=(x,side)=>side==='margin'?x.home-x.away:x.home+x.away;
 const actual=x=>({home:x.grade.home,away:x.grade.away});
 const error=(x,projection,side)=>Math.abs(diff(projection,side)-diff(actual(x),side));
 const knownBase=rows.filter(x=>x.baseline&&finite(x.baseline.home)&&finite(x.baseline.away));
 return {games:rows.length,source,
  raw_margin_mae:avg(rows.map(x=>error(x,x,'margin'))),
  shadow_margin_mae:avg(rows.map(x=>error(x,x.shadow_calibration,'margin'))),
  raw_total_mae:avg(rows.map(x=>error(x,x,'total'))),
  shadow_total_mae:avg(rows.map(x=>error(x,x.shadow_calibration,'total'))),
  baseline_games:knownBase.length,
  baseline_margin_mae:avg(knownBase.map(x=>error(x,x.baseline,'margin'))),
  baseline_total_mae:avg(knownBase.map(x=>error(x,x.baseline,'total')))};
}
function evaluate(snapshots,version){
 const games=latestSnapshots(snapshots,version);
 const replay=games.flatMap(x=>{const correction=estimate(x,games,version);return correction?[{...x,shadow_calibration:correction}]:[]});
 // These shadow scores were saved with the actual pregame capture. Unlike
 // replay, the correction itself was frozen before knowing this result.
 const frozen=games.filter(x=>x.shadow_calibration?.status==='SHADOW_ONLY'&&
  x.shadow_calibration?.historically_validated===false&&
  x.shadow_calibration.training_games>=MIN_HISTORY&&
  [x.shadow_calibration.home,x.shadow_calibration.away].every(finite));
 return {status:'RESEARCH ONLY · NO AUTOMATIC CALIBRATION',approved:false,
  model:version,graded_frozen_games:games.length,minimum_history:MIN_HISTORY,
  replay:compare(replay,'Chronological reconstruction from frozen predictions; score availability approximated by 18h embargo'),
  frozen:compare(frozen,'Truly prospective: shadow projection frozen before tipoff'),
  rollout_gate:'No promotion until at least 100 distinct future games have frozen shadow scores, both total and margin MAE improve by at least 5% versus the raw model, and a separate calibration review approves the change. Winner probabilities are NOT recalibrated.'};
}
module.exports={MIN_HISTORY,MAX_HISTORY,EMBARGO_MS,latestSnapshots,estimate,evaluate};
