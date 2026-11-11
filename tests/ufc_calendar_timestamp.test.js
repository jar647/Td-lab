const test = require('node:test');
const assert = require('node:assert/strict');
const guard = require('../ufc_backtest_guard.js');
const evaluator = require('../ufc_backtest_evaluator.js');
const bout = {bout_id:'calendar-check',fighter_a:'a',fighter_b:'b',starts_at:'2026-03-01T00:00:00Z',status:'final',winner:'a',method:'Decision'};
const profiles = [{fighter_id:'a',stats_source:'historical archive',stats_as_of:'2026-02-27T00:00:00Z',stats:{slpm:3}},{fighter_id:'b',stats_source:'historical archive',stats_as_of:'2026-02-27T00:00:00Z',stats:{slpm:2}}];
const prediction = {winner_id:'a',frozen_at:'2026-02-28T00:00:00Z'};
test('valid historical dates remain eligible',()=>{
 assert.equal(guard.inspect(bout,profiles).eligible,true);
 assert.equal(evaluator.evaluate([bout],{'calendar-check':profiles},{'calendar-check':prediction}).evaluated,1);
});
test('invalid leap days and impossible calendar dates are rejected',()=>{
 for(const invalid of ['2026-02-29T00:00:00Z','2026-02-30T00:00:00Z','2026-04-31T00:00:00Z','2026-13-01T00:00:00Z']){
  assert.equal(guard.inspect({...bout,starts_at:invalid},profiles).eligible,false,invalid);
  assert.equal(evaluator.evaluate([bout],{'calendar-check':profiles},{'calendar-check':{...prediction,frozen_at:invalid}}).evaluated,0,invalid);
 }
});
test('invalid time components and offsets are rejected',()=>{
 for(const invalid of ['2026-02-28T24:00:00Z','2026-02-28T00:60:00Z','2026-02-28T00:00:60Z','2026-02-28T00:00:00+15:00','2026-02-28T00:00:00+14:30']){
  assert.equal(guard.inspect({...bout,starts_at:invalid},profiles).eligible,false,invalid);
  assert.equal(evaluator.evaluate([bout],{'calendar-check':profiles},{'calendar-check':{...prediction,frozen_at:invalid}}).evaluated,0,invalid);
 }
});
test('valid leap day is accepted',()=>{
 assert.equal(guard.inspect({...bout,starts_at:'2028-02-29T00:00:00Z'},profiles).eligible,true);
});
