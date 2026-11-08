const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluate}=require('../ufc_backtest_evaluator.js');
test('empty backtest never invents accuracy or confidence interval',()=>{
 const r=evaluate([],{},{});assert.equal(r.accuracy,null);assert.equal(r.accuracyInterval95,null);
 assert.deepEqual(r.excludedByReason,{});assert.equal(r.calibrated,false);
});
test('exclusions counted by distinct reason, with no spurious accuracy',()=>{
 const r=evaluate([{bout_id:'b',fighter_a:'a',fighter_b:'c',starts_at:'2026-01-01T12:00:00Z',status:'scheduled'}],{},{});
 assert.equal(r.evaluated,0);assert.equal(r.excluded,1);
 assert.equal(r.excludedByReason.no_decisive_final_result,1);
 assert.equal(r.excludedByReason.missing_frozen_prediction_timestamp,1);
 assert.equal(r.accuracyInterval95,null);
});
test('duplicate bout IDs are reported once per rejected row',()=>{
 const b={bout_id:'b'};
 const r=evaluate([b,b],{},{});
 assert.equal(r.excludedByReason.missing_or_duplicate_bout_id,1);
});
