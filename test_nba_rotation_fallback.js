'use strict';
const assert=require('node:assert/strict');
const engine=require('./game_odds_engine');
const ui=require('./nba_simulator_ui');

// Complete synthetic box scores isolate the unsupported-availability case.
// Eleven supported players minus six uncertain players leaves five, below
// the rotation model's six-player minimum for a 240-minute/40-minute budget.
const now=Date.parse('2026-11-09T21:30:00Z'),stamp=new Date(now).toISOString();
const game={id:'fixture-upcoming',date:new Date(now+86400000).toISOString(),home:'Home',away:'Away',status:'STATUS_SCHEDULED',season_type:2};
const rosterIds=team=>Array.from({length:11},(_,i)=>team+'-'+i);
const players=team=>rosterIds(team).map((id,i)=>({id,name:team+' Player '+i,team,starter:i<5,didNotPlay:false,stats:{MIN:i===10?'20':'22',FG:'4-8','3PT':'1-3',FT:team==='Home'?'2-2':'1-2',PTS:team==='Home'?11:10,OREB:1,DREB:3,REB:4,AST:2,TO:1}}));
const feed={generated_at:stamp,games:Array.from({length:40},(_,i)=>({id:'fixture-history-'+i,date:new Date(now-(i+1)*86400000).toISOString(),home:'Home',away:'Away',status:'STATUS_FINAL',season_type:2,players:[...players('Home'),...players('Away')]}))};
const injuries={generated_at:stamp,status:'ok',injuries:Array.from({length:6},(_,i)=>({player_id:'Away-'+i,player:'Away Player '+i,status:'DAY-TO-DAY'}))};
const rosters={generated_at:stamp,teams:{Home:rosterIds('Home'),Away:rosterIds('Away')}};
const strict={injuries,rosters,now},optIn={...strict,allowScoreFallback:true};
const realNow=Date.now;
Date.now=()=>now;
try{
 assert.throws(()=>engine.nbaGame(game,feed,strict),/Rotation availability cannot be simulated: Away: only 5 supported players/);
 const model=engine.nbaGame(game,feed,optIn);
 assert.equal(model.possessionModel,undefined);
 assert.equal(model.rotationFallback.teams.length,1);
 assert.equal(model.rotationFallback.teams[0].availablePlayers,5);
 assert.equal(model.rotationFallback.teams[0].uncertainPlayers.length,6);
 assert.match(model.warning,/Player availability, minutes and player props are not modeled/);
 assert.equal(model.feedGeneratedAt,stamp);
 assert.deepEqual(model.pregameInputTimes,{games:stamp,injuries:stamp,rosters:stamp});

 const noOdds=engine.simulate(model,{},1000,6472026);
 assert.equal(noOdds.runCount,1000);
 assert.equal(noOdds.possession,null);
 assert.deepEqual(noOdds.rotationFallback,model.rotationFallback);
 assert.equal(noOdds.audit.calibrationVerified,false);
 assert.ok(Number.isFinite(noOdds.simulated.home+noOdds.simulated.away));
 assert.ok(noOdds.markets.every(m=>!m.eligible&&m.signal==='PASS · TEAM-SCORE BASELINE ONLY'));
 const rendered=ui.compact(noOdds,model);
 assert.match(rendered,/Simulation Results · 1,000 runs/);
 assert.doesNotMatch(rendered,/Possessions \+ player rotations/);
 assert.equal(ui.capture(noOdds,model,{getItem:()=>null,setItem(){throw Error('Fallback must not save a possession forecast')}}).saved,false);

 const priced=engine.simulate(model,{homeML:100,awayML:100,homeSpread:-3.5,homeATS:100,awayATS:100,total:225.5,over:100,under:100},1000,6472026);
 assert.equal(priced.markets.length,6);
 assert.ok(priced.markets.every(m=>!m.eligible&&m.signal==='PASS · TEAM-SCORE BASELINE ONLY'));
 assert.equal(priced.audit.passed,true);

 // Fallback is restricted to unsupported uncertainty, not source/data errors.
 assert.throws(()=>engine.nbaGame(game,{...feed,generated_at:new Date(now-13*3600000).toISOString()},optIn),/Fresh game, injury and roster feeds/);
 assert.throws(()=>engine.nbaGame({...game,date:new Date(now-1).toISOString()},feed,optIn),/closed after tipoff/);
 assert.throws(()=>engine.nbaGame(game,feed,{...optIn,injuries:{...injuries,generated_at:new Date(now-13*3600000).toISOString()}}),/Fresh game, injury and roster feeds/);
 const nearTip={...game,date:new Date(now+60*60000).toISOString()},oldAvailability={...injuries,generated_at:new Date(now-16*60000).toISOString()};
 assert.throws(()=>engine.nbaGame(nearTip,feed,{...optIn,injuries:oldAvailability}),/within 15 minutes/);

 const confirmed={sources:{lineups:{retrieved_at:stamp}},games:{[game.id]:{tipoff:game.date,observed_at:stamp,teams:{Home:{status:'CONFIRMED',starters:players('Home').slice(0,5)}}}}};
 const conflicting={...injuries,injuries:[...injuries.injuries,{player_id:'Home-0',player:'Home Player 0',status:'OUT'}]};
 assert.throws(()=>engine.nbaGame(game,feed,{...optIn,gameContext:confirmed,injuries:conflicting}),/conflicts with an absence report/);

 // An otherwise supported rotation continues through the possession engine.
 const supported=engine.nbaGame(game,feed,{...optIn,injuries:{...injuries,injuries:injuries.injuries.slice(0,5)}});
 assert.ok(supported.possessionModel);
 assert.equal(supported.rotationFallback,undefined);
 const healthy=engine.simulate(supported,{},1000,6472026);
 assert.ok(healthy.possession.players.length>=12);

 // A queued baseline run must still reject expired or started inputs.
 Date.now=()=>now+13*3600000;
 assert.throws(()=>engine.simulate(model,{},1000),/Pregame inputs are stale/);
 Date.now=()=>Date.parse(game.date);
 assert.throws(()=>engine.simulate(model,{},1000),/game has started/);
 Date.now=()=>now;
 assert.throws(()=>engine.simulate({...model,date:nearTip.date,pregameInputTimes:{...model.pregameInputTimes,injuries:oldAvailability.generated_at}},{},1000),/within 15 minutes/);
 console.log('NBA rotation fallback: strict default, explicit baseline, no player claims, PASS-only markets, freshness and supported rotations PASS');
}finally{Date.now=realNow}
