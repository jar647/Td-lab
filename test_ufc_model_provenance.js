'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const evaluator=require('./ufc_backtest_evaluator.js'),prob=require('./ufc_probability_backtest.js');
const bout={bout_id:'fight-1',fighter_a:'a',fighter_b:'b',winner:'a',status:'final',method:'decision',starts_at:'2026-10-01T20:00:00Z'};
const profiles=[{fighter_id:'a',stats_as_of:'2026-09-29T12:00:00Z',snapshot_at:'2026-09-29T13:00:00Z',stats_source:'verified archive',stats:{slpm:3}},{fighter_id:'b',stats_as_of:'2026-09-29T12:00:00Z',snapshot_at:'2026-09-29T13:00:00Z',stats_source:'verified archive',stats:{slpm:2}}];
const pick={winner_id:'a',winner_probability:.65,frozen_at:'2026-09-30T12:00:00Z'};
const evaluate=p=>evaluator.evaluate([bout],{'fight-1':profiles},{'fight-1':p});
test('valid pre-fight provenance is graded',()=>{assert.equal(evaluate({...pick,model_as_of:'2026-09-28T00:00:00Z',features_as_of:'2026-09-29T13:00:00Z',model_trained_at:'2026-09-28T00:00:00Z'}).evaluated,1)});
for(const field of ['model_as_of','features_as_of','model_trained_at']){
 test(field+' cannot postdate frozen pick',()=>{
  const audit=evaluate({...pick,[field]:'2026-09-30T12:00:01Z'});
  assert.equal(audit.evaluated,0);assert.ok(audit.rows[0].errors.includes(field+'_after_prediction'));
  const scored=prob.score([bout],{'fight-1':profiles},{'fight-1':{...pick,[field]:'2026-10-02T00:00:00Z'}});
  assert.equal(scored.scored,0);assert.equal(scored.excluded,1);
 });
 test(field+' malformed timestamp is excluded',()=>{assert.ok(evaluate({...pick,[field]:'yesterday'}).rows[0].errors.includes('invalid_'+field+'_timestamp'))});
}
