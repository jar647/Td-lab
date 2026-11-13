/** Regression checks for the current game-first NFL analyst page.
 * Run: node test_analyst_ui.js
 * Legacy runMonteCarlo was replaced by nfl_game_engine.js + Web Worker.
 */
'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const engine=require('./nfl_game_engine.js');
const goal1=require('./nfl_goal1.js');
const topPlays=require('./nfl_top_plays.js');
const html=fs.readFileSync('analyst.html','utf8');
assert.match(html,/<script src="\.\/nfl_game_engine\.js\?v=nfl-depth-chart-qb-v4"><\/script>/,
  'The analyst must load the current game-first simulator');
assert.ok(html.includes("nfl_game_worker.js"),'Long simulations must run off the page thread');
assert.match(html,/<script src="\.\/nfl_top_plays\.js\?v=nfl-top-plays-v1"><\/script>/,'The analyst loads the same selection helper as the game page and capture');
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
const rosterOnlyQB={player_id:'roster-only-qb',player:'Current sourced QB',team:'A',opp:'B',pos:'QB',market:'ATD',availability:'ROSTER_ACTIVE',displayOnly:true,playerAppearancesVerified:false,games:0,last5GamesPlayed:0,seasonGameStats:[],last5GameStats:[],depthChart:{unit:'first',order:1,position:'QB',sourceStatus:'ok',source:'https://example.com/depth',observedAt:new Date().toISOString(),season:2026}};
const context=vm.createContext({
 document,console,setTimeout,Date,PropVaultGameEngine:engine,PropVaultGoal1:goal1,PropShopNFLTopPlays:topPlays,CookItUpQuickSlip:{button:()=>'<button class="quick-slip-add">Add to Quick Slip</button>'},
 fetch:async url=>({ok:true,json:async()=>
  url.includes('matchups.json')?[]:
  url.includes('prop_probability_performance.json')?{graded:0,distinct_graded_weeks:0}:
  url.includes('verification_status.json')?{bet_recommendations_enabled:false,gates:{model_calibrated:false}}:
  {generated_at:new Date().toISOString(),rosterPlayers:[rosterOnlyQB],
   availability_diagnostics:{injuries:{rows_for_week:16,matched_ids:0,practice_flags:12,report_stage:'PRACTICE_ONLY_NO_GAME_DESIGNATIONS'}}}
 })
});
vm.runInContext(inline[0],context,{filename:'analyst.html'});
assert.equal(vm.runInContext('defs',context),topPlays.defs,'analyst shares market definitions');
assert.equal(vm.runInContext('choose',context),topPlays.choose,'analyst and capture share the selection function');
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
 assert.equal(vm.runInContext('players.length',context),1,'analyst includes source-only roster cues in its raw model input');
 assert.equal(vm.runInContext('players[0].player_id',context),rosterOnlyQB.player_id);
 assert.equal(vm.runInContext('players[0].playerAppearancesVerified',context),false,'merging roster cues cannot manufacture history');
 assert.equal(vm.runInContext('players[0].seasonGameStats.length',context),0);
 assert.equal(vm.runInContext('players[0].depthChart.unit',context),'first');
 assert.equal(vm.runInContext('choose(players[0],defs.find(d=>d.key==="passYards"),new Map())',context),null,'a source-only quarterback never gets an invented individual recommendation');
 assert.match(elements.get('feedHealth').textContent,/Practice-only injury update/,
  'Practice flags must not be mistaken for a final game designation');
 assert.match(elements.get('feedHealth').textContent,/NOT confirmed/,
  'Official game-day inactives must remain visibly unverified');
 assert.match(elements.get('validationStatus').textContent,/NOT READY|Not yet validated/,
  'Unvalidated model must not appear bet-ready');
 console.log('NFL analyst regression checks passed');
});
