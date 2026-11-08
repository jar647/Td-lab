const test=require('node:test');const assert=require('node:assert/strict');const guard=require('../ufc_backtest_guard.js');const evaluator=require('../ufc_backtest_evaluator.js');
const bout={bout_id:'101',fighter_a:'A',fighter_b:'B',starts_at:'2026-10-01T20:00:00Z',status:'final',winner:'A',method:'decision'};
const snap=id=>({fighter_id:id,stats_as_of:'2026-09-30T20:00:00Z',stats_source:'verified provider',stats:{slpm:4}});
test('matched fighter snapshots remain eligible',()=>assert.equal(guard.inspect(bout,[snap('A'),snap('B')]).eligible,true));
test('swapped snapshots are rejected',()=>{
 const check=guard.inspect(bout,[snap('B'),snap('A')]);
 assert.equal(check.eligible,false);assert.ok(check.errors.includes('fighter_0_snapshot_identity_mismatch'));assert.ok(check.errors.includes('fighter_1_snapshot_identity_mismatch'));
});
test('backtest cannot score winner from swapped snapshots',()=>{
 const result=evaluator.evaluate([bout],{'101':[snap('B'),snap('A')]},{'101':{winner_id:'A',frozen_at:'2026-09-30T21:00:00Z'}});
 assert.equal(result.evaluated,0);assert.equal(result.accuracy,null);
});
