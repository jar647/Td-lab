'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const guard=require('./ufc_backtest_guard.js'),evaluator=require('./ufc_backtest_evaluator.js'),probability=require('./ufc_probability_backtest.js');
const stamp='2026-01-01T00:00:00Z',start='2026-01-10T00:00:00Z';
const bout={bout_id:'b1',fighter_a:'a',fighter_b:'b',winner:'a',status:'final',method:'Decision',starts_at:start};
const profile=(id,stats)=>({fighter_id:id,stats_as_of:stamp,snapshot_at:'2026-01-02T00:00:00Z',stats_source:'verified-pre-fight-provider',stats});
const snapshots=stats=>[profile('a',stats),profile('b',{slpm:3.5,strAcc:45})];
const prediction={winner_id:'a',winner_probability:.7,frozen_at:'2026-01-03T00:00:00Z'};
test('valid historical pre-fight statistics can be evaluated',()=>{
 assert.equal(guard.inspect(bout,snapshots({slpm:4.2,strAcc:48})).eligible,true);
 assert.equal(probability.score([bout],{b1:snapshots({slpm:4.2,strAcc:48})},{b1:prediction}).scored,1);
});
test('impossible or nonnumeric sourced measurements fail closed',()=>{
 for(const stats of [{slpm:-1},{strAcc:101},{tdDef:Infinity},{slpm:'4.2'},{slpm:NaN},{slpm:4,tdAcc:-1},{slpm:4,strDef:110}]){
  const check=guard.inspect(bout,snapshots(stats));
  assert.ok(check.errors.includes('fighter_0_invalid_stats_values'),JSON.stringify(stats));
  const result=probability.score([bout],{b1:snapshots(stats)},{b1:prediction});
  assert.equal(result.scored,0);assert.equal(result.brier,null);assert.equal(result.calibrated,false);
 }
});
test('snapshot cannot arrive after frozen prediction or bout',()=>{
 const after=snapshots({slpm:4});
 after[0].snapshot_at='2026-01-04T00:00:00Z';
 assert.ok(evaluator.evaluate([bout],{b1:after},{b1:prediction}).rows[0].errors.includes('fighter_0_snapshot_after_prediction'));
});
