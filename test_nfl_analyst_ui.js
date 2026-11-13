/* Node smoke tests for analyst.html script syntax and simulator handoff. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const engine=require('./nfl_game_engine.js');
const goal1=require('./nfl_goal1.js');
const topPlays=require('./nfl_top_plays.js');
const html=fs.readFileSync('analyst.html','utf8');
assert(html.includes('src="./nfl_game_engine.js?v=nfl-depth-chart-qb-v4"'),'analyst must load simulator engine');
assert(html.includes('nfl_game_worker.js'),'analyst must execute off-thread');
const inline=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
 .map(x=>x[1]).filter(x=>x.trim());
assert.equal(inline.length,1,'exactly one analyst inline controller');
new vm.Script(inline[0],{filename:'analyst-inline.js'});
const def={playerAppearancesVerified:true,availability:'ROSTER_ACTIVE',injuryReportStatus:'NOT_REPORTED',
 defenseOpponentRatio:{PASS:1,RUSH:1,REC:1,CATCH:1},
 defPassYardsAllowed:300,defPassAttemptsAllowed:40,defRushYardsAllowed:100,defRushAttemptsAllowed:20,
 defRecYardsAllowed:130,defTargetsAllowed:13,defReceptionsAllowed:9};
const player=(team,id,pos,vals)=>{
 const history=Array.from({length:8},(_,i)=>({week:i+1,
  passYards:vals.py||0,passAttempts:vals.p||0,
  rushYards:vals.ry||0,rushAttempts:vals.r||0,
  recYards:vals.y||0,receptions:vals.c||0,targets:vals.t||0}));
 return {...def,player:id,player_id:id,team,opp:team==='A'?'B':'A',pos,
  seasonGameStats:history,last5GameStats:history.slice(-5),last5GamesPlayed:5,
  playerRushYards:vals.ry||0,playerCarries:vals.r||0,
  playerPassYards:vals.py||0,playerPassAttempts:vals.p||0,
  playerRecYards:vals.y||0,playerReceptions:vals.c||0,
  playerTargets:vals.t||0,
  recent3RushYards:vals.ry||0,recent3RecYards:vals.y||0,
  recent3PassYards:vals.py||0,recent3Receptions:vals.c||0};
};
const players=[
 player('A','aqb','QB',{p:35,py:265,r:4,ry:25}),
 player('A','arb','RB',{r:18,ry:84,t:4,c:3,y:30}),
 player('A','awr','WR',{t:11,c:8,y:107}),
 player('A','ate','TE',{t:10,c:8,y:95}),
 player('B','bqb','QB',{p:34,py:265,r:4,ry:25}),
 player('B','brb','RB',{r:18,ry:84,t:4,c:3,y:30}),
 player('B','bwr','WR',{t:11,c:8,y:107}),
 player('B','bte','TE',{t:10,c:8,y:95}),
 {...player('A','out','WR',{t:11,c:8,y:107}),availability:'OUT'},
 {...player('A','unverified','WR',{t:11,c:8,y:107}),playerAppearancesVerified:false},
 {...player('A','small-sample','WR',{t:11,c:8,y:107}),last5GamesPlayed:2},
 {...player('A','backup','QB',{p:35,py:265}),qbRole:'BACKUP'},
 {...player('C','other-game','WR',{t:11,c:8,y:107}),opp:'D'}
];
const elements=new Map();
function el(id){if(!elements.has(id))elements.set(id,{
 innerHTML:'',textContent:'',value:id==='simCount'?'10000':'',
 disabled:false,querySelectorAll(selector){
  if(this.queryHtml!==this.innerHTML){this.queryHtml=this.innerHTML;this.queryNodes=new Map()}
  if(!this.queryNodes.has(selector))this.queryNodes.set(selector,selector==='.exclude'
   ?[...this.innerHTML.matchAll(/class="exclude" data-key="([^"]+)"/g)].map(m=>({dataset:{key:m[1]}}))
   :[]);
  return this.queryNodes.get(selector);
 },scrollIntoView:()=>{},
 click(){if(typeof this.onclick==='function')return this.onclick();}
});return elements.get(id);}
const tickets=[],workerRequests=[];
class FakeWorker{
 postMessage(req){workerRequests.push(req);setTimeout(()=>{
  try{const result=engine.simulate(req.players,req.count,req.seed,req.selected);
   this.onmessage({data:{result}});
  }catch(err){this.onmessage({data:{error:err.message}})}
 },0)}
 terminate(){}
}
function response(obj){return {ok:true,async json(){return obj}}}
const context={document:{getElementById:el},Worker:FakeWorker,PropShopNFLTopPlays:topPlays,PropVaultGoal1:{...goal1,buildTicket(candidates,count){
 const selected=goal1.buildTicket(candidates,count);tickets.push({candidates,selected,count});return selected;
}},CookItUpQuickSlip:{button:()=>'<button class="quick-slip-add">Add to Quick Slip</button>'},
 setTimeout,Date,console,fetch:async url=>{
  if(url.includes('matchups'))return response(players);
  if(url.includes('forward'))return response({graded:0,distinct_graded_weeks:0});
  if(url.includes('game_picks.json'))return response({games:[{home:'A',away:'B',projected_home_points:25,projected_away_points:21}]});
  return response({generated_at:new Date().toISOString(),availability_diagnostics:{injuries:{matched_ids:0}}});
 }};
vm.createContext(context);
vm.runInContext(inline[0],context);
(async()=>{
 await new Promise(resolve=>setTimeout(resolve,10));
 el('game').value='A-B';
 await el('build').onclick();
 assert(!el('results').innerHTML.includes('Simulation unavailable'),'simulator should initialize');
 assert(el('results').innerHTML.includes('Game-first Monte Carlo'),'game analysis panel expected, received: '+el('results').innerHTML.slice(0,1000));
 assert(el('results').innerHTML.includes('Game-first research candidates'),'fixture should yield at least one matchup-driven research candidate, received: '+el('results').innerHTML.slice(0,1100));
 assert(el('results').innerHTML.includes('Top 3 player recommendations'));
 assert(el('results').innerHTML.includes('Best single research candidate'));
 assert(!el('results').innerHTML.includes('legOdds'));
 assert(!el('results').innerHTML.includes('fullOdds'));
 assert(!el('results').innerHTML.includes('bestOdds'));
 assert(!el('results').innerHTML.includes('Hard Rock leg odds'));
 assert(el('results').innerHTML.includes('Projected game script'));
 assert(el('results').innerHTML.includes('4-leg SGP draft'));
 for(let size=2;size<=10;size++)assert(el('results').innerHTML.includes('<option value="'+size+'"'),'ticket size option '+size);
 for(const size of [6,8,10]){
  el('legCount').value=String(size);await el('legCount').onchange();
  const actual=tickets.at(-1);
  assert.equal(actual.count,size,'requested player count reaches builder');
  assert.equal(actual.selected.length,size,'supported fixture must produce '+size+' actual legs');
  assert(el('results').innerHTML.includes(size+'-leg SGP draft'),'rendered ticket count');
  assert.equal((el('results').innerHTML.match(/class="small">LEG /g)||[]).length,size,'every selected leg renders');
  assert.equal(workerRequests.at(-1).selected.length,size,'joint simulation receives every selected leg');
  assert.equal(new Set(actual.selected.map(goal1.marketId)).size,size,'no duplicate player-market lines');
  assert(actual.selected.every(c=>['A','B'].includes(c.p.team)&&['A','B'].includes(c.p.opp)),'all legs belong to chosen game');
  assert(actual.candidates.every(c=>c.researchScore>=60&&c.researchScore<=100),'every analyst candidate meets the independent /100 minimum');
  assert(actual.candidates.every(c=>!['out','unverified','small-sample','backup','other-game'].includes(c.p.player)),'larger size preserves eligibility filters');
 }
 const excluded=el('results').querySelectorAll('.exclude')[0];
 const excludedKey=excluded.dataset.key;await excluded.onclick();
 assert.equal(tickets.at(-1).selected.length,10,'supported replacement rebuilds full larger ticket');
 assert(!tickets.at(-1).selected.some(c=>c.p.player+'|'+c.d.key===excludedKey),'excluded market stays out of rebuilt ticket');
 // Exhaust supported markets through the same exclusion controls used in the UI.
 while(tickets.at(-1).selected.length>2)await el('results').querySelectorAll('.exclude')[0].onclick();
 assert.equal(tickets.at(-1).selected.length,2);
 assert(el('results').innerHTML.includes('Requested 10 legs; only 2 supported legs are available. Showing 2; no filler legs added.'));
 assert(el('results').innerHTML.includes('2-leg SGP draft'),'scarce pool displays actual count');
 assert.equal(workerRequests.at(-1).selected.length,2,'scarce simulation receives only available props');
 // A user-entered game leg occupies one slot, including at the new maximum.
 el('marketType').value='ATS';el('marketSide').value='AWAY';el('marketLine').value='+3.5';
 await el('applyGameMarket').onclick();
 assert.equal(tickets.at(-1).count,9);
 assert(el('results').innerHTML.includes('Requested 10 legs; only 3 supported legs are available.'));
 assert(el('results').innerHTML.includes('3-leg SGP draft'));
 // Restore the supported pool for the original control and handoff checks.
 vm.runInContext('exclusions.clear()',context);
 el('marketType').value='NONE';await el('applyGameMarket').onclick();
 assert(el('results').innerHTML.includes('10-leg SGP draft'));
 el('marketType').value='ATS';await el('applyGameMarket').onclick();
 assert.equal(tickets.at(-1).selected.length,9,'game leg reserves one of ten slots');
 assert(el('results').innerHTML.includes('10-leg SGP draft'));
 assert.equal(workerRequests.at(-1).selected.length,9,'game leg remains outside player Monte Carlo');
 el('marketType').value='NONE';await el('applyGameMarket').onclick();
 for(const invalid of ['11','1','6.5']){
  const previous=tickets.length;el('legCount').value=invalid;await el('legCount').onchange();
  assert.equal(tickets.length,previous,'invalid ticket size rejected');
 }
 el('legCount').value='3';await el('legCount').onchange();
 assert(el('results').innerHTML.includes('3-leg SGP draft'));
 el('marketType').value='ATS';el('marketSide').value='AWAY';el('marketLine').value='+3.5';
 await el('applyGameMarket').onclick();
 assert(el('results').innerHTML.includes('B spread +3.5'));
 assert(el('results').innerHTML.includes('3-leg SGP draft'));
 assert(el('results').innerHTML.includes('not an engine recommendation'));
 el('marketType').value='NONE';await el('applyGameMarket').onclick();
 assert(!el('results').innerHTML.includes('Included: B spread'));
 assert(el('results').innerHTML.includes('3-leg SGP draft'));
 await new Promise(resolve=>setTimeout(resolve,35));
 assert(el('simResult').innerHTML.includes('Simulated'),'joint simulation results expected');
 console.log('NFL analyst UI syntax and simulated game-to-ticket flow passed');
})().catch(e=>{console.error(e);process.exitCode=1});
