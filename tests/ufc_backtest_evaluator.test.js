const test=require('node:test');const assert=require('node:assert/strict');const {evaluate}=require('../ufc_backtest_evaluator.js');
const bout={bout_id:'101',starts_at:'2025-08-01T20:00:00Z',fighter_a:'a',fighter_b:'b',winner:'a',status:'final',method_display:'Decision'};
const p={stats_as_of:'2025-07-31T00:00:00Z',stats_source:'provider',stats:{slpm:4}};
const snap={'101':[{...p,fighter_id:'a'},{...p,fighter_id:'b'}]};const pred={'101':{winner_id:'a',frozen_at:'2025-08-01T19:00:00Z'}};
test('scores a valid frozen historical winner pick',()=>{const x=evaluate([bout],snap,pred);assert.equal(x.evaluated,1);assert.equal(x.correct,1);assert.equal(x.accuracy,1);assert.equal(x.calibrated,false)});
test('rejects late prediction',()=>{const x=evaluate([bout],snap,{'101':{winner_id:'a',frozen_at:'2025-08-01T21:00:00Z'}});assert.equal(x.evaluated,0);assert.ok(x.rows[0].errors.includes('prediction_not_frozen_before_bout'))});
test('rejects post-bout snapshots',()=>{const x=evaluate([bout],{'101':[{...p,fighter_id:'a'},{...p,fighter_id:'b',stats_as_of:'2025-08-02'}]},pred);assert.equal(x.evaluated,0)});
test('rejects draws, no contests, pending fights, invalid picks and duplicates',()=>{const bouts=[{...bout,bout_id:'102',winner:null,method_display:'Draw'},{...bout,bout_id:'103',status:'scheduled'},{...bout,bout_id:'104',winner:'a'}];const x=evaluate(bouts,{'102':[p,p],'103':[p,p],'104':[p,p]},{'102':{...pred['101']},'103':{...pred['101']},'104':{winner_id:'wrong',frozen_at:pred['101'].frozen_at}});assert.equal(x.evaluated,0);assert.equal(evaluate([bout,bout],snap,pred).excluded,1)});
test('empty backtest never invents accuracy',()=>{const x=evaluate([],{},{});assert.equal(x.accuracy,null);assert.equal(x.evaluated,0)});

test('rejects snapshots without fighter identity',()=>{const x=evaluate([bout],{'101':[p,p]},pred);assert.equal(x.evaluated,0);assert.ok(x.rows[0].errors.includes('fighter_0_missing_snapshot_identity'));});

test('rejects ambiguous date-only prediction timestamps',()=>{const x=evaluate([bout],snap,{'101':{winner_id:'a',frozen_at:'2025-07-31'}});assert.equal(x.evaluated,0);assert.ok(x.rows[0].errors.includes('missing_frozen_prediction_timestamp'));});
