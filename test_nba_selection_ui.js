'use strict';
const assert=require('node:assert/strict');
const ui=require('./nba_selection_ui.js'),gf=require('./nba_game_first.js');
const NOW=Date.parse('2026-11-18T17:00:00Z'),STAMP=new Date(NOW-60000).toISOString();
const clone=value=>JSON.parse(JSON.stringify(value));
const defer=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
async function until(test){for(let i=0;i<30&&!test();i++)await new Promise(resolve=>setImmediate(resolve));assert(test(),'expected asynchronous work did not start')}
function data(){
 const game=(id,offset,status='STATUS_SCHEDULED')=>({id,date:new Date(NOW+offset*3600000).toISOString(),home:'H'+id,away:'A'+id,status,season_type:2,players:[]});
 return {feed:{generated_at:STAMP,games:[game('1',3),game('2',8),game('3',14),game('4',-1),game('5',-24,'STATUS_FINAL')]},
  rosters:{generated_at:STAMP,teams:{H1:['p1'],A1:['x1'],H2:['p2'],A2:['x2']},players:{}},
  injuries:{generated_at:STAMP,status:'ok',injuries:[]},context:{generated_at:STAMP,games:{},availability:{generated_at:STAMP,status:'ok',injuries:[]}}};
}
function row(game,inputs){const id='p'+game.id;return {key:game.id+'|'+id+'|points',gameId:String(game.id),game,playerId:id,name:'Player '+id,team:game.home,opponent:game.away,market:'points',side:'over',eligible:true,reviewRequired:false,forecast:24,matchupGames:10,matchupBoost:.1,matchupRating:{score:90},samples:Array.from({length:1000},(_,i)=>i<700?30:10),
 inputTimes:{games:inputs.feed.generated_at,rosters:inputs.rosters.generated_at,injuries:inputs.injuries.generated_at},outcomeSetId:'batch-'+game.id,
 roleEvidence:{playerId:id,team:game.home,eligible:true,roleStatus:'SUPPORTED',status:'ACTIVE',projectedMinutes:31,minutesLow:30,minutesHigh:32,historyGames:10,holdReasons:[]}}}
function mount(extra={}){
 const server=data(),requests=[],workers=[],timers=new Map(),progress=[],updates=[];let clock=NOW,timer=0,globalInputs=null,fetchHook=null;
 const provider=ui.create({getInputs:()=>globalInputs,updateInputs(value){globalInputs=value;updates.push(value)},now:()=>clock,onProgress:value=>progress.push(value),
  fetch:async(url,options)=>{requests.push({url,options});if(fetchHook)return fetchHook(url,options);const key=url.includes('nba_games')?'feed':url.includes('nba_rosters')?'rosters':url.includes('nba_injuries')?'injuries':'context';return {ok:true,json:async()=>clone(server[key])}},
  workerFactory(){const worker={terminated:false,terminate(){this.terminated=true},postMessage(message){this.message=message}};workers.push(worker);return worker},
  setTimeout(fn,delay){if(delay===0){queueMicrotask(fn);return ++timer}const id=++timer;timers.set(id,{fn,delay});return id},clearTimeout(id){timers.delete(id)},...extra});
 function finish(worker=workers.at(-1),rows){const inputs=worker.message;worker.onmessage({data:{type:'result',requestId:inputs.requestId,candidates:rows??inputs.games.map(game=>row(game,inputs)),held:[]}})}
 return {provider,server,requests,workers,timers,progress,updates,finish,getInputs:()=>globalInputs,setInputs:value=>{globalInputs=value},setTime:value=>{clock=value},setFetch:fn=>{fetchHook=fn}};
}
(async()=>{
 const v=mount(),first=v.provider.getCandidates(),other=v.provider.getCandidates();await until(()=>v.workers.length===1);
 assert.equal(v.requests.length,4,'concurrent readers share one independent four-source refresh');assert(v.requests.every(request=>request.options.cache==='no-store'));assert.equal(v.updates.length,1);
 const worker=v.workers[0];assert.deepEqual(worker.message.games.map(g=>g.id),['1','2'],'slate includes future games today in Eastern time, including next UTC date');assert.equal(worker.message.now,NOW);assert.equal(worker.message.feed.generated_at,STAMP);assert.equal(v.getInputs().injuries.generated_at,STAMP,'fetching never restamps source evidence');assert([...v.timers.values()].every(timer=>timer.delay===120000));
 worker.onmessage({data:{type:'progress',requestId:worker.message.requestId,completed:1,total:2}});assert.equal(v.progress.at(-1).completed,1);v.finish();const [a,b]=await Promise.all([first,other]);assert.equal(a.ready,true);assert.equal(a.candidates.length,2);assert.equal(b.candidates.length,2);assert.equal(worker.terminated,true);assert.equal(v.timers.size,0);
 const signature=a.signature,cached=await v.provider.getCandidates();assert.equal(v.requests.length,8,'cache still refreshes source evidence before reuse');assert.equal(v.workers.length,1);assert.equal(cached.signature,signature);assert.equal(cached.candidates.length,2);
 v.setTime(NOW+61000);const expired=v.provider.getCandidates();await until(()=>v.workers.length===2);v.finish();assert.equal((await expired).ready,true,'outcome cache expires within 60 seconds');
 v.server.injuries.injuries=[{player_id:'p1',team:'H1',status:'OUT'}];const changed=v.provider.getCandidates();await until(()=>v.workers.length===3);v.finish();assert.notEqual((await changed).signature,signature,'changed injury contents invalidate even an unchanged source timestamp');
 v.provider.destroy();

 // Required requests fail independently, while optional context may fail.
 for(const source of ['feed','rosters','injuries']){
  const failed=mount();failed.setFetch(async url=>{const key=url.includes('nba_games')?'feed':url.includes('nba_rosters')?'rosters':url.includes('nba_injuries')?'injuries':'context';if(key===source)throw Error('network');return {ok:true,json:async()=>failed.server[key]}});
  const result=await failed.provider.getCandidates();assert.equal(result.ready,false,source);assert.equal(result.candidates.length,0);assert.equal(failed.requests.length,4);assert.equal(failed.workers.length,0);assert.match(result.reason,/could not be refreshed/);failed.provider.destroy();
 }
 const optional=mount();optional.setFetch(async url=>{const key=url.includes('nba_games')?'feed':url.includes('nba_rosters')?'rosters':url.includes('nba_injuries')?'injuries':'context';if(key==='context')throw Error('optional unavailable');return {ok:true,json:async()=>optional.server[key]}});const optionalRun=optional.provider.getCandidates();await until(()=>optional.workers.length);assert.equal(optional.workers[0].message.context,null);optional.finish();assert.equal((await optionalRun).ready,true);optional.provider.destroy();
 for(const [source,hours]of [['feed',13],['rosters',73],['injuries',13]]){const stale=mount();stale.server[source].generated_at=new Date(NOW-hours*3600000).toISOString();if(source==='injuries')stale.server.context.availability=stale.server[source];assert.equal((await stale.provider.getCandidates()).ready,false);assert.equal(stale.workers.length,0);stale.provider.destroy()}
 const malformed=mount();malformed.server.injuries={generated_at:STAMP,status:'error',injuries:[]};malformed.server.context=null;assert.equal((await malformed.provider.getCandidates()).ready,false);malformed.provider.destroy();

 const newer=new Date(NOW-1000).toISOString(),oldLive=mount({refreshAvailability:async()=>({injuries:{generated_at:newer,status:'ok',injuries:[{player_id:'p1',status:'OUT'}]},context:{generated_at:newer,games:{}}})});await oldLive.provider.refreshInputs();assert.equal(oldLive.getInputs().injuries.generated_at,newer);assert.equal(oldLive.getInputs().context.generated_at,newer);oldLive.provider.destroy();
 const preserve=mount();preserve.setInputs({injuries:{generated_at:newer,status:'ok',injuries:[{player_id:'p1',status:'OUT'}]},context:{generated_at:newer,games:{}}});await preserve.provider.refreshInputs();assert.equal(preserve.getInputs().injuries.generated_at,newer);assert.equal(preserve.getInputs().context.generated_at,newer,'a successful but older snapshot does not regress verified existing evidence');preserve.provider.destroy();
 const future=mount({refreshAvailability:async()=>({injuries:{generated_at:new Date(NOW+60000).toISOString(),status:'ok',injuries:[]}})});await future.provider.refreshInputs();assert.equal(future.getInputs().injuries.generated_at,STAMP,'future live evidence is not accepted as a refresh');future.provider.destroy();
 const enrichment=mount({refreshAvailability:async()=>({context:{generated_at:STAMP,games:{},defenders:{defender:{shots:100}}}})});await enrichment.provider.refreshInputs();assert.equal(enrichment.getInputs().context.defenders.defender.shots,100,'tracking enrichment at the same source timestamp survives refresh');enrichment.provider.destroy();
 const rescued=mount({refreshAvailability:async()=>({context:{generated_at:STAMP,games:{},defenders:{fresh:true}}})});rescued.server.context=null;await rescued.provider.refreshInputs();assert.equal(rescued.getInputs().context.defenders.fresh,true,'valid live context rescues a missing published context');rescued.provider.destroy();

 // Unsupported rows and stale close-to-tip injuries never escape the provider.
 const filter=mount(),filtered=filter.provider.getCandidates();await until(()=>filter.workers.length);const message=filter.workers[0].message,good=row(message.games[0],message),under={...good,key:'under',side:'under'},low={...good,key:'low',matchupRating:{score:84}},missingRole={...good,key:'no-role',roleEvidence:null},wrongSources={...good,key:'wrong-source',inputTimes:{...good.inputTimes,injuries:newer}};
 const ruledOut={...good,key:'out',roleEvidence:{...good.roleEvidence,status:'OUT'}},wrongRoster={...good,key:'traded',playerId:'traded',roleEvidence:{...good.roleEvidence,playerId:'traded'}},wrongRoleSources={...good,key:'role-source',roleEvidence:{...good.roleEvidence,inputTimes:{...good.inputTimes,injuries:newer}}};
 filter.finish(filter.workers[0],[good,under,low,missingRole,wrongSources,ruledOut,wrongRoster,wrongRoleSources]);const filteredResult=await filtered;assert.deepEqual(filteredResult.candidates.map(c=>c.key),[good.key]);filter.setTime(NOW+3*3600000);const tipped=filter.provider.getCandidates();await until(()=>filter.workers.length===2);assert.deepEqual(filter.workers[1].message.games.map(g=>g.id),['2']);filter.finish();assert((await tipped).candidates.every(c=>c.gameId==='2'));filter.provider.destroy();
 const close=mount();close.server.feed.games[0].date=new Date(NOW+3600000).toISOString();close.server.injuries.generated_at=new Date(NOW-16*60000).toISOString();close.server.context.availability=close.server.injuries;const near=close.provider.getCandidates();await until(()=>close.workers.length);close.finish();assert.deepEqual((await near).candidates.map(c=>c.gameId),['2'],'inside 90 minutes, a report older than 15 minutes cannot clear players');close.provider.destroy();

 // Failed/malformed workers never trigger a hidden main-thread simulation.
 let fallbackCalls=0;const analyze=gf.analyze;gf.analyze=(...args)=>{fallbackCalls++;return {rows:[row(args[0],{feed:args[1],injuries:args[2],rosters:args[3]})]}};
 for(const error of ['event','reported','malformed','timeout','constructor']){
  const fail=mount(error==='constructor'?{workerFactory(){throw Error('blocked')}}:{}),pending=fail.provider.getCandidates();
  if(error!=='constructor'){await until(()=>fail.workers.length);const w=fail.workers[0];if(error==='event')w.onerror();if(error==='reported')w.onmessage({data:{type:'error',requestId:w.message.requestId,error:'Source model unsupported'}});if(error==='malformed')w.onmessage({data:{type:'result',requestId:w.message.requestId,candidates:null}});if(error==='timeout')fail.timers.values().next().value.fn()}
  assert.equal((await pending).ready,false,error);assert.equal(fallbackCalls,0,error);fail.provider.destroy();
 }
 const fallback=mount({workerFactory:undefined}),fallbackResult=await fallback.provider.getCandidates();assert.equal(fallbackResult.ready,true);assert.equal(fallbackCalls,2);assert.equal(fallbackResult.candidates.length,2);fallback.provider.destroy();gf.analyze=analyze;
 gf.analyze=()=>{throw Error('unexpected engine error')};const engineFail=mount({workerFactory:undefined});const failedEngine=await Promise.all([engineFail.provider.getCandidates(),engineFail.provider.getCandidates()]);assert(failedEngine.every(result=>result.ready===false&&/engine failed/.test(result.reason)));engineFail.provider.destroy();gf.analyze=analyze;

 const held=mount(),heldRun=held.provider.getCandidates();await until(()=>held.workers.length);held.workers[0].onmessage({data:{type:'result',requestId:held.workers[0].message.requestId,candidates:[],held:[{gameId:'1',reason:'No supported rotation history'}]}});const heldResult=await heldRun;assert.equal(heldResult.ready,true);assert.equal(heldResult.heldCount,1);assert.match(heldResult.reason,/rotation history/);held.provider.destroy();
 const race=mount(),obsolete=race.provider.getCandidates();await until(()=>race.workers.length);const old=race.workers[0];race.server.injuries.generated_at=newer;const current=race.provider.getCandidates();await until(()=>race.workers.length===2);assert.equal(old.terminated,true);assert.equal((await obsolete).ready,false);race.finish(old);race.finish(race.workers[1]);assert.equal((await current).ready,true);race.provider.destroy();
 const invalid=mount(),invalidated=invalid.provider.getCandidates();await until(()=>invalid.workers.length);invalid.provider.invalidate();assert.equal((await invalidated).ready,false);assert.equal(invalid.workers[0].terminated,true);const fresh=invalid.provider.getCandidates();await until(()=>invalid.workers.length===2);invalid.finish();assert.equal((await fresh).ready,true);invalid.provider.destroy();assert.equal((await invalid.provider.getCandidates()).ready,false);
 const delayed=mount(),fetchWait=defer();delayed.setFetch(()=>fetchWait.promise);const abandoned=delayed.provider.refreshInputs();delayed.provider.destroy();fetchWait.resolve({ok:true,json:async()=>data().feed});assert.equal((await abandoned).ready,false);assert.equal(delayed.updates.length,0,'a destroyed refresh cannot update page globals');
 console.log('NBA selection provider: fresh independent snapshots, ET slate, real timestamps, worker/cache/held results, supported rows, source changes, tipoff and async failure guards PASS');
})().catch(error=>{console.error(error);process.exitCode=1});
