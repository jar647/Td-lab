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
 assert.equal(r.excludedByReason.missing_or_duplicate_bout_id,2);
});

// Some result feeds abbreviate no contest as NC while retaining a winner ID.
test('NC and overturned results cannot enter historical accuracy or probability scoring',()=>{
 const {score}=require('../ufc_probability_backtest.js');
 const base={bout_id:'nc',fighter_a:'a',fighter_b:'b',winner:'a',status:'final',starts_at:'2025-08-01T20:00:00Z'};
 const p={stats_as_of:'2025-07-30T12:00:00Z',stats_source:'verified',stats:{slpm:4}};
 const snaps={nc:[{...p,fighter_id:'a'},{...p,fighter_id:'b'}]};
 const preds={nc:{winner_id:'a',winner_probability:0.9,frozen_at:'2025-07-31T12:00:00Z'}};
 for(const method of ['NC','N.C.','No-Contest','Overturned','DRAW']){
  const bout={...base,method};const a=evaluate([bout],snaps,preds);const b=score([bout],snaps,preds);
  assert.equal(a.evaluated,0,method);assert.equal(b.scored,0,method);
  assert.equal(b.excludedByReason.no_decisive_final_result,1,method);
 }
 const decisive=evaluate([{...base,method:'Decision'}],snaps,preds);
 assert.equal(decisive.evaluated,1);
});
