/** Regression checks for the current game-first NFL analyst page.
 * Run: node test_analyst_ui.js
 * Legacy runMonteCarlo was replaced by nfl_game_engine.js + Web Worker.
 */
'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const engine=require('./nfl_game_engine.js');
const html=fs.readFileSync('analyst.html','utf8');
assert.match(html,/<script src="\.\/nfl_game_engine\.js"><\/script>/,
  'The analyst must load the current game-first simulator');
assert.ok(html.includes("nfl_game_worker.js"),'Long simulations must run off the page thread');
const inline=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(m=>m[1]).filter(s=>s.trim());
assert.equal(inline.length,1,'Exactly one controller should exist');
new vm.Script(inline[0],{filename:'analyst-controller.js'});
const elements=new Map();
const document={getElementById(id){
 if(!elements.has(id))elements.set(id,{
  textContent:'',innerHTML:'',value:'',disabled:false,onclick:null,
  querySelectorAll:()=>[],scrollIntoView:()=>{}
 });
 return elements.get(id);
}};
const context=vm.createContext({
 document,console,setTimeout,Date,
 fetch:async url=>({ok:true,json:async()=>
  url.includes('matchups.json')?[]:
  url.includes('prop_probability_performance.json')?{graded:0,distinct_graded_weeks:0}:
  url.includes('verification_status.json')?{bet_recommendations_enabled:false,gates:{model_calibrated:false}}:
  {generated_at:new Date().toISOString(),
   availability_diagnostics:{injuries:{rows_for_week:16,matched_ids:0,practice_flags:12,report_stage:'PRACTICE_ONLY_NO_GAME_DESIGNATIONS'}}}
 })
});
vm.runInContext(inline[0],context,{filename:'analyst.html'});
assert.equal(vm.runInContext('n(null)',context),null,'Null data is not zero');
assert.equal(vm.runInContext('n(undefined)',context),null,'Missing data is not zero');
assert.equal(vm.runInContext("n('10.5')",context),10.5);
assert.equal(engine.blocked({injuryReportStatus:'OUT',availability:'ROSTER_ACTIVE'}),true);
assert.equal(engine.blocked({injuryReportStatus:'QUESTIONABLE',availability:'ROSTER_ACTIVE'}),false);
function player(team,id,pos,usage){
 const history=Array.from({length:7},(_,i)=>({
  week:i+1,passAttempts:usage.p||0,rushAttempts:usage.r||0,
  targets:usage.t||0,receptions:usage.c||0,recYards:usage.y||0,rushYards:usage.ry||0
 }));
 return {player_id:id,player:id,team,opp:team==='A'?'B':'A',pos,
  playerAppearancesVerified:true,seasonGameStats:history,last5GameStats:history.slice(-5),
  availability:'ROSTER_ACTIVE',injuryReportStatus:'NOT_REPORTED'};
}
const lineup=[
 player('A','aqb','QB',{p:34,r:3}),player('A','arb','RB',{r:17,t:3,c:2,y:20,ry:80}),
 player('A','awr','WR',{t:10,c:7,y:90}),player('A','ate','TE',{t:6,c:4,y:40}),
 player('B','bqb','QB',{p:32,r:3}),player('B','brb','RB',{r:18,t:3,c:2,y:20,ry:70}),
 player('B','bwr','WR',{t:10,c:7,y:90}),player('B','bte','TE',{t:5,c:3,y:30})
];
const chosen=[
 {id:'awr',market:'recYards',line:40},
 {id:'awr',market:'receptions',line:4}
];
const outcome=engine.simulate(lineup,2000,123,chosen);
const yards=outcome.markets.find(x=>x.id==='awr'&&x.market==='recYards'&&x.line===40);
const catches=outcome.markets.find(x=>x.id==='awr'&&x.market==='receptions'&&x.line===4);
assert.ok(yards&&catches,'Both receiving markets must be represented');
assert.ok(outcome.joint.scenarioRate<=yards.scenarioRate+1e-6);
assert.ok(outcome.joint.scenarioRate<=catches.scenarioRate+1e-6);
assert.equal(outcome.status,'RESEARCH_ONLY_UNCALIBRATED');
setImmediate(()=>{
 assert.match(elements.get('feedHealth').textContent,/Practice-only injury update/,
  'Practice flags must not be mistaken for a final game designation');
 assert.match(elements.get('feedHealth').textContent,/NOT confirmed/,
  'Official game-day inactives must remain visibly unverified');
 assert.match(elements.get('validationStatus').textContent,/NOT READY|Not yet validated/,
  'Unvalidated model must not appear bet-ready');
 console.log('NFL analyst regression checks passed');
});
