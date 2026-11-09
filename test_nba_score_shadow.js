'use strict';
const assert=require('node:assert/strict');
const model='nba-possession-audit-v3',shadow=require('./scripts/nba_score_shadow');
const base=Date.parse('2026-09-01T18:00:00Z'),day=86400000;
const captures=Array.from({length:32},(_,i)=>{
 const tip=new Date(base+i*2*day).toISOString();
 return {game_id:String(i),model,locked_at:new Date(base+i*2*day-3*3600000).toISOString(),tipoff:tip,
  home:116,away:99,home_win:.68,baseline:{home:113,away:101},
  grade:{home:110,away:102}};
});
const inputBefore=JSON.stringify(captures);
const sample=captures[20],p=shadow.estimate(sample,captures,model);
assert(p&&p.status==='SHADOW_ONLY','Historical bias candidate should appear after the minimum history');
assert.equal(p.training_games,20);
assert(p.home<sample.home&&p.away>sample.away,'Bias correction goes against historical scoring error');
assert(Math.abs(p.home_shift)<=4&&Math.abs(p.away_shift)<=4,'Corrections are strictly capped');
assert.equal(JSON.stringify(captures),inputBefore,'Shadow research must not mutate archived forecasts');
assert.equal(shadow.estimate(captures[11],captures,model),null,'Insufficient earlier finalized games cannot produce a correction');

const backfill=structuredClone(captures);
backfill[28].grade.home=0;
backfill[29].grade.away=180;
assert.deepEqual(shadow.estimate(sample,backfill,model),p,'Changing future outcomes must not alter past corrections');

const duplicate=structuredClone(captures[0]);
duplicate.capture_id='revised';
duplicate.locked_at=new Date(base-3600000).toISOString();
duplicate.home=118;
const latest=shadow.latestSnapshots([captures[0],duplicate],model);
assert.equal(latest.length,1,'Latest pregame revision counts once per game');
assert.equal(latest[0].home,118);
assert.equal(shadow.estimate(sample,[...captures,duplicate],model).training_games,20,'Revised forecasts cannot inflate sample size');
const wrong={...captures[0],model:'nba-team-score-fallback-v1',game_id:'wrong'};
const fallback={...captures[1],game_id:'fallback',rotation_fallback:{reason:'unsupported'}};
assert.equal(shadow.latestSnapshots([...captures,wrong,fallback],model).length,captures.length);
const tooLate={...captures[0],locked_at:captures[0].tipoff,game_id:'late'};
assert.equal(shadow.latestSnapshots([...captures,tooLate],model).length,captures.length,'After-tipoff captures are excluded');

const near={...captures[20],game_id:'near',tipoff:new Date(base+100*day).toISOString(),locked_at:new Date(base+100*day-3600000).toISOString()};
const justFinished={...captures[1],game_id:'just-ended',tipoff:new Date(base+100*day-3*3600000).toISOString(),locked_at:new Date(base+100*day-4*3600000).toISOString()};
assert.equal(shadow.estimate(near,[...captures,justFinished],model).training_games,32,'Scores from games just finished must obey the 18h embargo');
const report=shadow.evaluate(captures,model);
assert.equal(report.approved,false);
assert(report.replay.games>0&&report.replay.games<captures.length);
assert(report.replay.shadow_margin_mae<report.replay.raw_margin_mae);
assert(report.replay.shadow_total_mae<report.replay.raw_total_mae);
assert.equal(report.frozen.games,0,'A reconstructed replay must not masquerade as frozen prospective shadow evidence');
const actualFrozen=captures.map(x=>({...x}));
actualFrozen[21]={...actualFrozen[21],shadow_calibration:shadow.estimate(captures[21],captures,model)};
const withFrozen=shadow.evaluate(actualFrozen,model);
assert.equal(withFrozen.frozen.games,1);
assert(withFrozen.frozen.shadow_margin_mae<withFrozen.frozen.raw_margin_mae);
const tampered=actualFrozen.map(x=>({...x}));
tampered[31]={...tampered[31],grade:{home:1,away:170}};
assert.equal(shadow.estimate(sample,tampered,model).home,p.home,'Later score cannot change prior training');
console.log('NBA shadow calibration: chronological embargo, same-model deduplication, fallback exclusion, no mutation, MAE replay and frozen-prospective separation PASS');
