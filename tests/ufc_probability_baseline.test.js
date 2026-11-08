const test=require('node:test');
const assert=require('node:assert/strict');
const {score}=require('../ufc_probability_backtest.js');
const bout={bout_id:'benchmark-1',starts_at:'2025-08-01T20:00:00Z',fighter_a:'a',fighter_b:'b',winner:'a',status:'final',method:'Decision'};
const base={stats_as_of:'2025-07-31T00:00:00Z',stats_source:'verified',stats:{slpm:4}};
const snapshots={'benchmark-1':[{...base,fighter_id:'a'},{...base,fighter_id:'b'}]};
const prediction=p=>({'benchmark-1':{winner_id:'a',winner_probability:p,frozen_at:'2025-08-01T19:00:00Z'}});
test('even-chance forecast matches naive baseline',()=>{
 const result=score([bout],snapshots,prediction(0.5));
 assert.equal(result.brierSkillVsEven,0);
 assert.ok(Math.abs(result.logLossImprovementVsEven)<1e-12);
});
test('correct confident forecast improves baseline while wrong confident forecast worsens it',()=>{
 const correct=score([bout],snapshots,prediction(0.8));
 const wrong=score([bout],snapshots,prediction(0.1));
 assert.ok(correct.brierSkillVsEven>0);
 assert.ok(correct.logLossImprovementVsEven>0);
 assert.ok(wrong.brierSkillVsEven<0);
 assert.ok(wrong.logLossImprovementVsEven<0);
 assert.equal(correct.bettingEdgeVerified,false);
});
test('no eligible frozen forecasts means no benchmark skill',()=>{
 const result=score([],{},{});assert.equal(result.brierSkillVsEven,null);
 assert.equal(result.logLossImprovementVsEven,null);
});
