/* Node smoke tests for analyst.html script syntax and simulator handoff. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const engine=require('./nfl_game_engine.js');
const goal1=require('./nfl_goal1.js');
const html=fs.readFileSync('analyst.html','utf8');
assert(html.includes('src="./nfl_game_engine.js"'),'analyst must load simulator engine');
assert(html.includes('nfl_game_worker.js'),'analyst must execute off-thread');
const inline=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
 .map(x=>x[1]).filter(x=>x.trim());
assert.equal(inline.length,1,'exactly one analyst inline controller');
new vm.Script(inline[0],{filename:'analyst-inline.js'});
const def={playerAppearancesVerified:true,availability:'ROSTER_ACTIVE',injuryReportStatus:'NOT_REPORTED',
 defenseOpponentRatio:{PASS:1,RUSH:1,REC:1,CATCH:1}};
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
 player('A','ate','TE',{t:6,c:4,y:57}),
 player('B','bqb','QB',{p:34,py:265,r:4,ry:25}),
 player('B','brb','RB',{r:18,ry:84,t:4,c:3,y:30}),
 player('B','bwr','WR',{t:11,c:8,y:107}),
 player('B','bte','TE',{t:6,c:4,y:57})
];
const elements=new Map();
function el(id){if(!elements.has(id))elements.set(id,{
 innerHTML:'',textContent:'',value:id==='simCount'?'10000':'',
 disabled:false,querySelectorAll:()=>[],scrollIntoView:()=>{},
 click(){if(typeof this.onclick==='function')return this.onclick();}
});return elements.get(id);}
class FakeWorker{
 postMessage(req){setTimeout(()=>{
  try{const result=engine.simulate(req.players,req.count,req.seed,req.selected);
   this.onmessage({data:{result}});
  }catch(err){this.onmessage({data:{error:err.message}})}
 },0)}
 terminate(){}
}
function response(obj){return {ok:true,async json(){return obj}}}
const context={document:{getElementById:el},Worker:FakeWorker,PropVaultGoal1:goal1,CookItUpQuickSlip:{button:()=>'<button class="quick-slip-add">Add to Quick Slip</button>'},
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
 assert(el('results').innerHTML.includes('Best single bet for this game'));
 assert(el('results').innerHTML.includes('bestOdds'));
 assert(el('results').innerHTML.includes('Projected game script'));
 assert(el('results').innerHTML.includes('4-leg SGP draft'));
 el('legCount').value='3';await el('legCount').onchange();
 assert(el('results').innerHTML.includes('3-leg SGP draft'));
 el('marketType').value='ATS';el('marketSide').value='AWAY';el('marketLine').value='+3.5';el('marketOdds').value='-110';
 await el('applyGameMarket').onclick();
 assert(el('results').innerHTML.includes('B spread +3.5'));
 assert(el('results').innerHTML.includes('3-leg SGP draft'));
 assert(el('results').innerHTML.includes('not an engine recommendation'));
 el('marketType').value='NONE';await el('applyGameMarket').onclick();
 assert(!el('results').innerHTML.includes('Included: B spread'));
 assert(el('results').innerHTML.includes('3-leg SGP draft'));
 await new Promise(resolve=>setTimeout(resolve,35));
 assert(el('simResult').innerHTML.includes('Simulated'),'joint simulation results expected');
 el('fullOdds').value='+313';
 el('reducedOdds').value='';
 assert.equal(typeof el('compareOdds').onclick,'function');
 el('compareOdds').onclick();
 assert(el('oddsResult').textContent.includes('break-even'),'valid American odds must parse correctly');
 assert(el('oddsResult').textContent.includes('NO BET'),'unverified model must fail closed on price checks');
 console.log('NFL analyst UI syntax and simulated game-to-ticket flow passed');
})().catch(e=>{console.error(e);process.exitCode=1});
