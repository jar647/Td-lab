const test=require('node:test');const assert=require('node:assert/strict');const {evaluate}=require('../nfl_backtest.js');
const base={gameId:'game1',playerId:'AAA|WR',market:'receptions',line:4,predictionFrozenAt:'2026-10-01T12:00:00Z',kickoffAt:'2026-10-01T17:00:00Z',resultRecordedAt:'2026-10-02T12:00:00Z'};
test('Brier score and hit rate calculated from settled outcomes',()=>{
 const r=evaluate([{...base,probability:.8,actual:5},{...base,gameId:'game2',probability:.3,actual:2}]);
 assert.equal(r.overall.count,2);assert.ok(Math.abs(r.overall.brierScore-.065)<1e-12);assert.equal(r.overall.observedHitRate,.5);
});
test('rejects post-kickoff prediction leakage',()=>assert.throws(()=>evaluate([{...base,probability:.5,actual:5,predictionFrozenAt:base.kickoffAt}]),/before kickoff/));
test('rejects duplicate settled markets',()=>assert.throws(()=>evaluate([{...base,probability:.5,actual:5},{...base,probability:.5,actual:5}]),/Duplicate/));
test('rejects invalid probabilities and unsettled records',()=>{
 assert.throws(()=>evaluate([{...base,probability:1.2,actual:5}]),/Invalid/);
 assert.throws(()=>evaluate([{...base,probability:.5,actual:5,resultRecordedAt:'2026-09-30T00:00:00Z'}]),/settled/);
});
