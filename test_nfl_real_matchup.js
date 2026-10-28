/* Live-feed smoke test: run the deployed analyst logic on a real matchup. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const engine=require('./nfl_game_engine.js');
const html=fs.readFileSync('analyst.html','utf8');
const js=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).find(Boolean);
assert(js,'analyst script missing');
const players=JSON.parse(fs.readFileSync('data/matchups.json','utf8'));
const status=JSON.parse(fs.readFileSync('data/status.json','utf8'));
const elMap=new Map();
function el(id){
 if(!elMap.has(id))elMap.set(id,{innerHTML:'',textContent:'',value:id==='simCount'?'10000':'',
 disabled:false,querySelectorAll:()=>[],scrollIntoView:()=>{},
 click(){if(this.onclick)return this.onclick()}});
 return elMap.get(id);
}
class LocalWorker{
 postMessage(data){setTimeout(()=>{
  try{this.onmessage({data:{result:engine.simulate(data.players,data.count,data.seed,data.selected)}})}
  catch(error){this.onmessage({data:{error:error.message}})}
 },0)}
 terminate(){}
}
const ok=x=>({ok:true,json:async()=>x});
const context={document:{getElementById:el},Worker:LocalWorker,setTimeout,console,Date,
 fetch:async url=>{
  if(url.includes('matchups.json'))return ok(players);
  if(url.includes('status.json'))return ok(status);
  if(url.includes('game_first_capture_status'))return ok({fixtures:14,frozen_game_snapshots:13});
  if(url.includes('prop_probability_performance'))return ok({game_first_graded:0,current_model_graded:0,distinct_graded_weeks:0});
  return ok({bet_recommendations_enabled:false,gates:{model_calibrated:false}});
 }};
vm.createContext(context);
vm.runInContext(js,context);
(async()=>{
 await new Promise(resolve=>setTimeout(resolve,5));
 const games=[...new Set(players.filter(p=>p.team&&p.opp).map(p=>[p.team,p.opp].sort().join('-')))];
 // Prefer a representative matchup with robust source coverage.
 const target=games.includes('CAR-GB')?'CAR-GB':games[0];
 assert(target,'No matchup groups in live feed');
 el('game').value=target;
 await el('build').onclick();
 const output=el('results').innerHTML;
 assert(output.includes('Game-first Monte Carlo'),'Real matchup should initialize simulator: '+output.slice(0,600));
 assert(output.includes('Game-first research candidates'),'Real matchup should produce a research ticket or expose why not: '+output.slice(0,900));
 await new Promise(resolve=>setTimeout(resolve,10));
 assert(el('simResult').innerHTML.includes('Simulated'),'Joint simulation should finish');
 console.log('Actual NFL feed matchup passed game-first UI research flow:',target);
})().catch(error=>{console.error(error);process.exitCode=1});
