const test=require('node:test');const assert=require('node:assert/strict');const {inspect,audit}=require('../ufc_backtest_guard.js');
const bout={bout_id:'1',starts_at:'2025-08-01T20:00:00Z'};
const profile={stats_as_of:'2025-07-31T00:00:00Z',stats_source:'provider snapshot',stats:{slpm:3.4}};
test('historical snapshots dated before bout are eligible',()=>assert.equal(inspect(bout,[profile,profile]).eligible,true));
test('current-day stats cannot leak into historical backtest',()=>{
 const current={...profile,stats_as_of:'2026-11-07T00:00:00Z'};
 const result=inspect(bout,[profile,current]);
 assert.equal(result.eligible,false);
 assert.ok(result.errors.includes('fighter_1_stats_snapshot_after_bout'));
});
test('unknown provenance blocks evaluation',()=>{
 const result=inspect(bout,[{stats:{slpm:3}},{stats:{slpm:4}}]);
 assert.equal(result.eligible,false);assert.ok(result.errors.some(x=>x.includes('missing_stats_source')));
});
test('audit counts eligible and blocked bouts without inventing predictions',()=>{
 const result=audit([bout,{bout_id:'2',event_date:'2025-09-01'}],{'1':[profile,profile]});
 assert.equal(result.eligible,1);assert.equal(result.blocked,1);assert.equal(result.total,2);
});
