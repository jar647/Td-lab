'use strict';
const assert=require('node:assert/strict'),engine=require('./nfl_game_engine'),ui=require('./nfl_parlay_ui');
const now=Date.parse('2026-11-19T16:00:00Z'),fixture={game_id:'AB',home:'A',away:'B',kickoff_at:new Date(now+3600000).toISOString()};
const records=[];for(const [team,opp]of [['A','B'],['B','A']])for(const pos of ['QB','WR','RB','TE'])records.push({player_id:team+pos,player:team+pos,team,opp,pos,market:'ATD',availability:'ROSTER_ACTIVE',injuryReportStatus:'ACTIVE',playerAppearancesVerified:true,last5GamesPlayed:5,
 seasonGameStats:Array.from({length:5},(_,i)=>({gameId:team+i,week:i+1,passAttempts:32,passYards:250,rushAttempts:pos==='RB'?16:2,rushYards:60,targets:8,receptions:6,recYards:90})),last5GameStats:Array.from({length:5},()=>({targets:8,receptions:6,recYards:90,rushAttempts:16,rushYards:60}))});
const candidates=records.filter(p=>p.pos!=='QB').map((p,i)=>({p,key:'AB|'+p.player_id+'|recYards',fixture,market:'recYards',side:'at_least',line:60,scenarioRate:.7,researchScore:85-i,score:100,d:{key:'recYards',label:'receiving yards'}}));
const base=engine.simulate(records,10000,982451653,[],{collectSettlements:true});
function mount(){
 const host={innerHTML:'',listeners:{},addEventListener(k,v){this.listeners[k]=v},removeEventListener(k){delete this.listeners[k]}};
 const state={ready:true,signature:'fresh-1',candidates:candidates.slice(0,1),offeredCandidates:candidates,fixtures:[fixture],records,simulations:new Map([['AB',base]]),quotes:{}};
 const jobs=[],saved=[{sport:'NBA',player:'Saved existing'}],timers=new Map();let serial=0;
 const controller=ui.create({root:host,getState:()=>state,now:()=>now,quickSlip:{add:p=>saved.push(p)},setTimeout(fn){timers.set(++serial,fn);return serial},clearTimeout(id){timers.delete(id)},workerFactory(){const job={terminate(){this.terminated=true},postMessage(m){this.message=m}};jobs.push(job);return job}});
 const change=(key,value)=>host.listeners.change({target:{dataset:{[key]:''},value:String(value)}}),input=(key,value)=>host.listeners.input({target:{dataset:{[key]:''},value:String(value)}});
 function finish(job){const m=job.message,result=engine.simulate(m.players,m.count,m.seed,m.selected,m.options);job.onmessage({data:{requestId:m.requestId,result}})}
 return {host,state,jobs,saved,timers,controller,change,input,finish};
}
(async()=>{
 const view=mount();view.change('parlayMode','same');view.change('parlayGame','AB');view.change('parlayCount',2);
 assert.match(view.host.innerHTML,/Compare my options/);assert.match(view.host.innerHTML,/Explore 2 unpriced research targets/);
 assert.equal(await view.controller.optimize(),null);assert.equal(view.jobs.length,0,'no invented book offers');
 const a=candidates.find(c=>c.p.player_id==='AWR'),b=candidates.find(c=>c.p.player_id==='BWR');
 assert(view.controller.addOffer(a.key,{line:49.5,odds:'-110'}));assert(view.controller.addOffer(a.key,{line:59.5,odds:'+100'}));assert(view.controller.addOffer(b.key,{line:49.5,odds:'-120'}));
 assert.equal(view.controller.getOffers().length,3);assert.equal(view.controller.addOffer(b.key,{line:50.1,odds:'-90'}),false);
 const pending=view.controller.optimize();assert.equal(view.jobs.length,1);const job=view.jobs[0];assert.equal(job.message.options.collectPlayerOutcomes.length,2,'multiple offered lines reuse one aligned player-market outcome array');
 view.controller.refresh();assert(!job.terminated,'ordinary same-source refresh cannot cancel comparison');view.finish(job);const selected=await pending;
 assert(selected.available,selected.reason);assert.equal(view.controller.getDraft().length,2);assert(selected.legs.some(c=>c.key===b.key),'selection may use supported players outside the default visible cards');
 assert.match(view.host.innerHTML,/Selected book OVER/);assert.match(view.host.innerHTML,/All legs win:/);assert.match(view.host.innerHTML,/readonly/);assert.match(view.host.innerHTML,/Individual prices are not multiplied/);
 assert.equal(view.controller.setQuote(a.key,{line:'79.5'}),false,'changing an optimized line must rerank the alternatives');
 const selectedFirst=view.controller.getDraft()[0];assert(view.controller.setQuote(selectedFirst.key,{odds:'+120'}));assert.equal(view.controller.getOffers().find(o=>o.id===selectedFirst.offerId).odds,'+120','a revised selected price must persist into the next comparison');
 view.input('parlayCombined','+500');assert.match(view.host.innerHTML,/returns \$60\.00/);assert.equal(view.controller.add(),true);assert.equal(view.saved.length,3);assert.equal(view.saved[0].sport,'NBA');
 for(const p of view.saved.slice(1)){assert.equal(p.side,'over');assert([49.5,59.5].includes(p.line));assert(p.scenarioRate>=.5);assert([-110,-120,100,120].includes(p.americanOdds))}
 const id=view.controller.getOffers()[0].id;assert(view.controller.removeOffer(id));assert.equal(view.controller.getDraft().length,0);assert.equal(view.controller.add(),false,'changing the offered pool invalidates the previous selected ticket');
 const stale=mount();stale.change('parlayMode','same');stale.change('parlayCount',2);stale.controller.addOffer(a.key,{line:49.5,odds:'-110'});stale.controller.addOffer(b.key,{line:49.5,odds:'-110'});const awaiting=stale.controller.optimize();stale.state.signature='changed';stale.finish(stale.jobs[0]);assert.equal(await awaiting,null);assert.equal(stale.controller.getDraft().length,0);
 const failure=mount();failure.change('parlayMode','same');failure.change('parlayCount',2);failure.controller.addOffer(a.key,{line:49.5,odds:'-110'});failure.controller.addOffer(b.key,{line:49.5,odds:'-110'});const bad=failure.controller.optimize();failure.jobs[0].onmessage({data:{requestId:999,result:{count:10000}}});assert.equal(await bad,null);assert.equal(failure.controller.getDraft().length,0);assert.match(failure.host.innerHTML,/aligned outcomes/);
 view.controller.destroy();stale.controller.destroy();failure.controller.destroy();
 console.log('NFL offered UI: exact options before selection, broader pool, real shared simulation, refresh/race guards, actual payout, quote edits and preserved Quick Slip PASS');
})().catch(error=>{console.error(error);process.exitCode=1});
