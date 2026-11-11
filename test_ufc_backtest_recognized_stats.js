'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const guard=require('./ufc_backtest_guard.js'),prob=require('./ufc_probability_backtest.js');
const bout={bout_id:'b1',fighter_a:'a',fighter_b:'b',winner:'a',status:'final',method:'Decision',starts_at:'2026-01-10T00:00:00Z'};
const profile=(id,stats)=>({fighter_id:id,stats_as_of:'2026-01-01T00:00:00Z',snapshot_at:'2026-01-02T00:00:00Z',stats_source:'historical-provider',stats});
const pick={winner_id:'a',winner_probability:.7,frozen_at:'2026-01-03T00:00:00Z'};
test('unrecognized numeric metadata cannot masquerade as fighter statistics',()=>{
 for(const stats of [{placeholder:1},{sourceVersion:2},{id:42},{slpm:null,placeholder:1}]){
  const snapshots=[profile('a',stats),profile('b',{slpm:3})];
  assert.ok(guard.inspect(bout,snapshots).errors.includes('fighter_0_missing_recognized_numeric_stats'));
  assert.equal(prob.score([bout],{b1:snapshots},{b1:pick}).scored,0);
 }
});
test('recognized valid fighter metrics remain eligible, including zero',()=>{
 for(const stats of [{slpm:0},{tdDef:0},{subAvg:1.2},{strAcc:47}]){
  assert.equal(guard.inspect(bout,[profile('a',stats),profile('b',{sapm:2})]).eligible,true);
 }
});
