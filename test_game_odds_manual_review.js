/* Manual book odds must only REPRICE the finished score distribution. */
'use strict';
const assert=require('node:assert/strict');
const engine=require('./game_odds_engine.js');
const review=require('./game_odds_manual_review.js');
const history={records:Array.from({length:140},(_,i)=>({
 season:2025,week:2+i%13,projected_home:23,projected_away:21,
 actual_home:23+Math.round(4*Math.sin(i*.6)),actual_away:21+Math.round(4*Math.cos(i*.8))
}))};
const game={game_id:'example',home:'HOME',away:'AWAY',gameday:'2099-11-01',
 projected_home_points:31,projected_away_points:14,
 model_inputs:{home:{games:8,offense:29,defense_allowed:18},
 away:{games:8,offense:17,defense_allowed:28}}};
const prepared=engine.nflGame(game,history);
prepared.trust={source_status:'RECONCILED',qb_context:{},calibration_status:'NOT_CALIBRATED'};
prepared.feedGeneratedAt=new Date().toISOString();
const result=engine.simulate(prepared,{},100000,647);
assert.equal(result.runCount,100000);
assert.equal(Object.values(result.scoreBins.margin).reduce((a,b)=>a+b,0),100000);
assert.equal(Object.values(result.scoreBins.total).reduce((a,b)=>a+b,0),100000);
const frozen=JSON.stringify({scores:result.simulated,bins:result.scoreBins,projection:result.projection});
const empty=review.analyze(prepared,result);
assert.equal(empty.summary,'NO ODDS ENTERED');
assert.equal(empty.status,'PASS');
const prices={homeML:'-130',awayML:'+110',homeSpread:-3.5,homeATS:'-110',awayATS:'-110',total:55.5,over:'-110',under:'-110'};
const compared=review.analyze(prepared,result,prices);
assert.equal(compared.top.key,'under','The strongest positive model-value discrepancy should rank first, regardless of market');
assert.equal(compared.top.decision,'PLAY','Model-based PLAY must be available even without a calibration badge');
const home=compared.rows.find(x=>x.key==='homeML');
const away=compared.rows.find(x=>x.key==='awayML');
const ats=compared.rows.find(x=>x.key==='homeATS');
assert.equal(ats.decision,'LEAN','Unverified ATS model discrepancies must be capped at LEAN');
assert.equal(home.win,away.loss,'Moneyline settlements share one distribution');
assert.ok(home.ev>.08&&home.modelEdge>.05);
assert.equal(compared.result.markets.length,6);
assert.equal(JSON.stringify({scores:result.simulated,bins:result.scoreBins,projection:result.projection}),frozen,
 'Manual odds comparison must never mutate the saved simulation');
assert.deepEqual(compared.result.simulated,result.simulated);
assert.deepEqual(compared.result.scoreBins,result.scoreBins);
const badBook=review.analyze(prepared,result,{homeML:'-10000'});
assert.equal(badBook.status,'PASS','A high-confidence winner is not automatically worth an extremely expensive price');
assert.throws(()=>review.analyze(prepared,result,{homeML:'-99'}),/Invalid American odds/);
assert.throws(()=>review.analyze(prepared,result,{homeATS:'-110'}),/spread/);
assert.throws(()=>review.analyze(prepared,result,{over:'-110'}),/total/);
const stale=review.analyze({...prepared,feedGeneratedAt:'2026-01-01T00:00:00Z'},result,prices);
assert.equal(stale.status,'PASS','Stale feed cannot create a PLAY or LEAN');
const uncertain=review.analyze({...prepared,trust:{...prepared.trust,qb_context:{HOME:{status:'RETURNING_STARTER_SAMPLE_MISMATCH'}}}},result,prices);
assert.equal(uncertain.status,'PASS','Unsupported QB changes cannot create a PLAY or LEAN');
const held=review.analyze({...prepared,sport:'NBA',possessionModel:{uncertain:['Player A'],teams:{HOME:{players:[{name:'Player A',status:'QUESTIONABLE',team:'HOME'}]}}}},result,prices);assert.equal(held.status,'PASS');assert.match(held.summary,/Data or availability hold/);assert.match(held.reason,/Player A \(QUESTIONABLE, HOME\)/);assert.ok(held.rows.filter(x=>x.price!==null).every(x=>Number.isFinite(x.win)&&Number.isFinite(x.breakEven)&&Number.isFinite(x.modelEdge)));const corrupted=structuredClone(result);corrupted.scoreBins.margin[12]+=1;
assert.throws(()=>review.analyze(prepared,corrupted,prices),/reconcile/);
console.log('Manual Game Odds Review: frozen 100k simulation -> odds -> PLAY / LEAN / PASS; source gates and no-resimulation invariant PASS');
