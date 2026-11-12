'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {pairedMarketBenchmark}=require('./nba_pretip_evidence.cjs');
const date='2026-11-10T23:00:00Z';
const market={captured_at:'2026-11-10T22:00:00Z',source_published_at:'2026-11-10T21:00:00Z',home_spread:-3.5,total:220.5,home_moneyline:-150,away_moneyline:130,source:'fixture-book',source_event_id:'event-1',verified:true};
const game={date,home:'BOS',away:'MIA',closing_market:market};
const row={date,home:'BOS',away:'MIA',probability:.6,outcome:1};
test('paired comparison uses verified pre-tip odds and computes finite proper scores',()=>{
 const x=pairedMarketBenchmark([row],[game]);
 assert.equal(x.pairedGames,1);assert.ok(Math.abs(x.modelBrier-.16)<1e-10);
 assert.ok(Number.isFinite(x.marketLogLoss));assert.equal(x.beatsMarketBrier,null);assert.equal(x.validatedForBetting,false);
});
test('rejects post-tip, unverified, mismatched, ambiguous and absent markets',()=>{
 const invalid=[{...game,closing_market:{...market,captured_at:date}},{...game,closing_market:{...market,verified:false}},{...game,away:'NYK'}];
 for(const g of invalid)assert.equal(pairedMarketBenchmark([row],[g]).pairedGames,0);
 assert.equal(pairedMarketBenchmark([row],[game,game]).pairedGames,0);
 assert.equal(pairedMarketBenchmark([row],[]).modelBrier,null);
});
test('rejects malformed forecast probability and outcome',()=>{
 assert.equal(pairedMarketBenchmark([{...row,probability:1.2}],[game]).pairedGames,0);
 assert.equal(pairedMarketBenchmark([{...row,outcome:null}],[game]).pairedGames,0);
});

test('duplicate model forecasts cannot inflate paired market accuracy sample',()=>{
 assert.equal(pairedMarketBenchmark([row,row],[game]).pairedGames,0);
 assert.equal(pairedMarketBenchmark([row,{...row,probability:.9}],[game]).pairedGames,0);
 assert.equal(pairedMarketBenchmark([row],[game,game,game]).pairedGames,0);
 assert.equal(pairedMarketBenchmark([row],[game,game,game,game]).pairedGames,0);
});
