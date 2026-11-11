'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const evaluator=require('./ufc_backtest_evaluator.js');
const probability=require('./ufc_probability_backtest.js');
const bout={bout_id:'conflict',fighter_a:'a',fighter_b:'b',winner:'a',status:'final',starts_at:'2026-04-01T00:00:00Z',method:'Decision',result:'Win'};
const profile=id=>({fighter_id:id,stats_source:'historical archive',stats_as_of:'2026-03-01T00:00:00Z',stats:{slpm:2}});
const snapshots={conflict:[profile('a'),profile('b')]};
const predictions={conflict:{winner_id:'a',winner_probability:0.65,frozen_at:'2026-03-20T00:00:00Z'}};
test('every populated result field must be decisive, even when another field says Decision or Win',()=>{
 for(const patch of [
  {method_display:'Decision',method:'No Contest'},
  {method_display:'NC',method:'Decision'},
  {result:'Win',result_type:'Overturned'},
  {result:'Draw',result_type:'Win'},
  {result:'Win',result_type:'N.C.'},
 ]){
  const b={...bout,...patch};
  const evaluation=evaluator.evaluate([b],snapshots,predictions);
  assert.equal(evaluation.evaluated,0,JSON.stringify(patch));
  assert.ok(evaluation.rows[0].errors.includes('no_decisive_final_result'));
  assert.equal(probability.score([b],snapshots,predictions).scored,0);
 }
});
test('consistent decisive result fields remain eligible',()=>{
 const b={...bout,method_display:'Unanimous Decision',result_type:'Win'};
 assert.equal(evaluator.evaluate([b],snapshots,predictions).evaluated,1);
 assert.equal(probability.score([b],snapshots,predictions).scored,1);
});
