'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const clock=Date.parse('2026-11-18T17:00:00Z'),stamp=new Date(clock).toISOString(),messages=[],imports=[];
const context={console,Date,Math,Number,String,Object,Array,Set,Map,JSON,Uint8Array,postMessage:value=>messages.push(JSON.parse(JSON.stringify(value)))};
context.self=context;
context.importScripts=(...urls)=>{for(const url of urls){const file=url.replace(/^\.\//,'').split('?')[0];imports.push(file);vm.runInContext(fs.readFileSync(path.join(__dirname,file),'utf8'),context,{filename:file})}};
vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'nba_parlay_worker.js'),'utf8'),context,{filename:'nba_parlay_worker.js'});
assert.deepEqual(imports,['nba_game_context.js','nba_possession_engine.js','nba_prop_evidence.js','nba_prop_lines.js','nba_matchup_discovery.js','nba_game_first.js']);
const positions=['PG','SG','SF','PF','C','PG','SG','C'],rosters={generated_at:stamp,teams:{},players:{}};
function players(team){return positions.map((position,i)=>({id:team+i,name:team+' Player '+i,team,position,starter:i<5,didNotPlay:false,
 stats:{MIN:'30',FG:'4-10','3PT':'1-3',FT:'2-2',PTS:'11',OREB:'1',DREB:'4',REB:'5',AST:'3',TO:'1'}}))}
for(const team of ['A','B']){const rows=players(team);rosters.teams[team]=rows.map(p=>p.id);for(const p of rows)rosters.players[p.id]={name:p.name,team,position:p.position}}
const feed={generated_at:stamp,games:Array.from({length:15},(_,i)=>({id:'history'+i,date:new Date(clock-(i+1)*86400000).toISOString(),status:'STATUS_FINAL',season_type:2,home:'A',away:'B',players:[...players('A'),...players('B')]}))};
const future={id:'upcoming',home:'A',away:'B',date:new Date(clock+6*3600000).toISOString(),status:'STATUS_SCHEDULED',season_type:2};
const closed={...future,id:'already-started',date:new Date(clock-3600000).toISOString()};
const injuries={generated_at:stamp,status:'ok',injuries:[]};
let draws=0,analyzed=0;const actualDraws=context.CookNBAPossessions.draws,actualAnalyze=context.CookNBAGameFirst.analyze;
context.CookNBAPossessions.draws=(model,count,...rest)=>{draws++;assert.equal(count,1000);return actualDraws(model,count,...rest)};
context.CookNBAGameFirst.analyze=(game,...rest)=>{analyzed++;assert.equal(game.id,future.id,'Started games must be skipped before engine execution');return actualAnalyze(game,...rest)};
context.self.onmessage({data:{requestId:17,feed,rosters,injuries,context:null,games:[future,closed],now:clock}});
assert.equal(analyzed,1);assert.equal(draws,1,'The worker runs the existing shared-outcome simulation once for the fixture');
assert(messages.some(m=>m.type==='progress'&&m.requestId===17&&m.completed===1&&m.total===2));
const result=messages.find(m=>m.type==='result');assert(result);assert.equal(result.requestId,17);assert.deepEqual(result.candidates,[]);
assert.equal(result.diagnostics.gamesAnalyzed,1);assert(result.diagnostics.modelRows>0);assert.equal(result.diagnostics.qualifiedRows,0);assert.equal(result.diagnostics.modelUnavailableGames,0);
assert.equal(result.held.length,1);assert.equal(result.held[0].gameId,future.id);assert.match(result.held[0].reason,/80\/100/);
assert(!messages.some(m=>m.type==='error'),'Valid evidence with no qualifying matchup is a supported PASS, not a worker failure');
const prior=messages.length;
context.self.onmessage({data:{requestId:18,feed,rosters,injuries,games:[future],now:'invalid'}});
assert.equal(messages.length,prior+1);assert.equal(messages.at(-1).type,'error');assert.equal(messages.at(-1).requestId,18);
assert.match(messages.at(-1).error,/Invalid NBA source inputs/);assert.equal(draws,1,'Invalid requests cannot start a simulation');
console.log('NBA parlay worker: real dependency imports, existing aligned 1,000-outcome engine, started-game exclusion, PASS/progress and request-scoped errors PASS');
