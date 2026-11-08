const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluate}=require('../ufc_backtest_evaluator.js');

test('duplicate bout IDs exclude every occurrence, not just later copies',()=>{
 const bouts=[{bout_id:'same'},{bout_id:'same'}];
 const report=evaluate(bouts,{},{});
 assert.equal(report.evaluated,0);
 assert.equal(report.excluded,2);
 assert.equal(report.excludedByReason.missing_or_duplicate_bout_id,2);
 assert.equal(report.accuracy,null);
 assert.equal(report.rows.length,2);
});

test('duplicate IDs cannot be rescued by one valid row',()=>{
 const bouts=[{bout_id:'same',fighter_a:'a',fighter_b:'b',winner:'a',status:'final',starts_at:'2026-01-02T00:00:00Z'}, {bout_id:'same'}];
 const report=evaluate(bouts,{},{});
 assert.equal(report.evaluated,0);
 assert.ok(report.rows.every(row=>row.errors.includes('missing_or_duplicate_bout_id')));
});

test('unique malformed bouts retain their normal exclusion reasons',()=>{
 const report=evaluate([{bout_id:'unique'}],{},{});
 assert.equal(report.excluded,1);
 assert.equal(report.excludedByReason.missing_or_duplicate_bout_id,undefined);
});
