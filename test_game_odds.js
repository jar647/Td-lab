/* Game-only 100k-simulation probability, settlement and fail-closed tests. */
'use strict';
const assert=require('node:assert/strict');
const e=require('./game_odds_engine.js');
assert.ok(Math.abs(e.quote('-115').implied-115/215)<1e-12,'American odds implied probability');
assert.equal(e.quote('+110').decimal,2.1);
for(const invalid of ['',null,0,'-99','+20','abc','-110x'])assert.equal(e.quote(invalid),null);
const backtest={records:Array.from({length:155},(_,i)=>({
 season:i<125?2024:2025,week:5+i%12,
 projected_home:22,projected_away:21,
 actual_home:Math.round(22+7*Math.sin(i*.61)+2*Math.cos(i*.7)),
 actual_away:Math.round(21+8*Math.cos(i*.56)+1*Math.sin(i*.32))
}))};
const game={game_id:'2026_08_TST_FOO',home:'FOO',away:'TST',gameday:'2026-11-01',
 projected_home_points:25.5,projected_away_points:22.4,
 model_inputs:{home:{games:7,offense:28,defense_allowed:20},away:{games:6,offense:24,defense_allowed:26}}};
const prepared=e.nflGame(game,backtest);
assert.equal(prepared.sample.residualGames,155);
assert.equal(prepared.projectedHome,25.5);
const market={homeSpread:-3.5,total:47.5,homeML:'-120',awayML:'+105',
 homeATS:'-110',awayATS:'-110',over:'-115',under:'-105'};
const r=e.simulate(prepared,market,100000,77);
assert.equal(r.runCount,100000);
assert.equal(r.markets.length,6);
const close=(a,b,t=.00000001)=>assert.ok(Math.abs(a-b)<t,a+' versus '+b);
for(const [a,b] of [['homeML','awayML'],['homeATS','awayATS'],['over','under']]){
 const x=r.markets.find(m=>m.key===a),y=r.markets.find(m=>m.key===b);
 close(x.win,y.loss);close(x.loss,y.win);close(x.push,y.push);
 close(x.win+x.loss+x.push,1);
 if(x.key==='homeML')close(x.noVig+y.noVig,1);
}
const same=e.simulate(prepared,{...market,homeML:'-200',over:'+120'},100000,77);
assert.deepEqual(same.simulated,r.simulated,'Bookmaker prices MUST NOT shift score simulation');
const repeated=e.simulate(prepared,market,100000,77);
assert.deepEqual(repeated.simulated,r.simulated,'Simulation must be reproducible');
assert.equal(r.modelStatus,'RESEARCH ONLY · NOT CALIBRATED');
assert.ok(r.markets.every(m=>m.signal!=='PLAY'),'Unvalidated research must not become betting advice');
assert.ok(r.markets.some(m=>Number.isFinite(m.ev)),'Expected value math should work with an actual quote');
const noOdds=e.simulate(prepared,{},1000,17);
assert.equal(noOdds.markets.length,2);
assert.ok(noOdds.markets.every(m=>m.signal==='NO ODDS ENTERED'));
assert.throws(()=>e.simulate(prepared,{over:'-115'},1000,12),/total/i);
assert.throws(()=>e.simulate(prepared,{homeATS:'-110'},1000,12),/spread/i);
assert.throws(()=>e.simulate(prepared,{homeML:'-90'},1000,12),/odds/i);
assert.throws(()=>e.simulate(prepared,{},100001,12),/between/i);
const pushGame={...prepared,sport:'NFL',projectedHome:21,projectedAway:17,residuals:Array.from({length:50},()=>({homeError:0,awayError:0}))};
const push=e.simulate(pushGame,{homeSpread:-4,total:38,homeATS:'-110',awayATS:'-110',over:'-110',under:'-110'},1000,2);
for(const key of ['homeATS','awayATS','over','under']){
 const m=push.markets.find(m=>m.key===key);
 close(m.push,1);close(m.ev,0);close(m.breakEven,0);
}
const makePlayers=(team,total)=>Array.from({length:8},(_,i)=>({team,didNotPlay:false,stats:{PTS:i<7?Math.floor(total/8):total-7*Math.floor(total/8)}}));
const nbaAll={games:Array.from({length:46},(_,i)=>({
 id:'test'+i,home:i%3?'Home Team':'Other',away:i%3?'Away Team':'Away Team',
 date:new Date(Date.UTC(2026,9,1+i,23)).toISOString(),status:'STATUS_FINAL',season_type:2,
 players:[...makePlayers(i%3?'Home Team':'Other',105+i%13),...makePlayers('Away Team',101+(i*3)%17)]
}))};
const nbaFixture={id:'future',home:'Home Team',away:'Away Team',date:'2026-11-22T23:00Z',status:'STATUS_SCHEDULED'};
const nba=e.nbaGame(nbaFixture,nbaAll);
assert.equal(nba.sport,'NBA');
assert.ok(nba.sample.homeGames>=2&&nba.sample.awayGames>=2);
const n=e.simulate(nba,market,100000,99);
assert.equal(n.runCount,100000);
assert.equal(n.simulated.tie,0,'NBA sim must not end tied');
assert.ok(n.markets.every(m=>!m.signal.includes('VERIFIED PLAY')));
assert.throws(()=>e.nbaGame(nbaFixture,{games:[]}),/Insufficient/i);
console.log('Game Odds: paired simulation, 100,000 outcomes, price isolation, market settlement, NBA+NFL contracts PASS');
