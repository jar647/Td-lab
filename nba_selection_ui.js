/* Fresh NBA research inputs and a shared slate simulation provider. */
(function(root,factory){
 const common=typeof module==='object'&&module.exports;
 const api=factory(root,common?require('./nba_game_first.js'):root.CookNBAGameFirst,common?require('./nba_prop_lines.js'):root.CookNBAPropLines);
 if(typeof module==='object'&&module.exports)module.exports=api;root.PropShopNBASelectionUI=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root,gf,lines){
 'use strict';
 const PATHS={feed:'./data/nba_games.json',rosters:'./data/nba_rosters.json',injuries:'./data/nba_injuries.json',context:'./data/nba_game_context.json'};
 const time=value=>typeof value==='string'&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)?Date.parse(value):NaN;
 const stamp=value=>time(value?.generated_at);
 const day=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
 const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
 function stable(value){if(Array.isArray(value))return '['+value.map(stable).join(',')+']';if(object(value))return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}';return JSON.stringify(value)??'null'}
 function digest(value){const text=stable(value);let a=2166136261,b=5381;for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b,33)^text.charCodeAt(i)}return text.length+':'+(a>>>0).toString(16)+':'+(b>>>0).toString(16)}
 function fresh(value,hours,now){const t=stamp(value);return object(value)&&(!value.status||value.status==='ok')&&Number.isFinite(t)&&t<=now+300000&&now-t<=hours*3600000}
 const injurySchema=value=>object(value)&&Array.isArray(value.injuries)&&value.status==='ok'&&Number.isFinite(stamp(value));
 function fixtures(feed,now){const today=day(now),seen=new Set();return (feed?.games||[]).filter(g=>g&&g.status==='STATUS_SCHEDULED'&&g.id!==undefined&&typeof g.home==='string'&&typeof g.away==='string'&&g.home&&g.away&&g.home!==g.away&&Number.isFinite(time(g.date))&&time(g.date)>now&&day(time(g.date))===today&&!seen.has(String(g.id))&&seen.add(String(g.id))).sort((a,b)=>time(a.date)-time(b.date)||String(a.id).localeCompare(String(b.id)))}
 function sourceSignature(inputs,games){
  // Historical league boxes affect opponent normalization, so their contents
  // belong in the signature even when their teams are outside today's slate.
  const historical=inputs.feed.games.filter(g=>g.status==='STATUS_FINAL').slice().sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  return digest({stamps:[inputs.feed.generated_at,inputs.rosters.generated_at,inputs.injuries.generated_at,inputs.context?.generated_at||null],games,history:historical,rosters:inputs.rosters,injuries:inputs.injuries,context:inputs.context});
 }
 function validate(inputs,now){
  if(!object(inputs.feed)||!Array.isArray(inputs.feed.games)||!inputs.feed.games.length||!fresh(inputs.feed,12,now))return 'A valid game feed from the last 12 hours is required.';
  if(!object(inputs.rosters?.teams)||!Object.keys(inputs.rosters.teams).length||!fresh(inputs.rosters,72,now))return 'A valid roster snapshot from the last 72 hours is required.';
  if(!injurySchema(inputs.injuries)||!fresh(inputs.injuries,12,now))return 'A valid injury report from the last 12 hours is required.';
  return null;
 }
 function create(options={}){
  const now=options.now||Date.now,fetcher=options.fetch||(typeof root.fetch==='function'?root.fetch.bind(root):null),schedule=options.setTimeout||root.setTimeout.bind(root),cancel=options.clearTimeout||root.clearTimeout.bind(root);
  let destroyed=false,revision=0,request=0,refreshTask=null,computeTask=null,current=null,cache=null,job=null,lastRefreshAt=0;
  const progress=value=>{try{options.onProgress?.(value)}catch(_){}};
  const unavailable=reason=>({candidates:[],signature:current?.signature||null,reason,ready:false});
  function stop(reason){if(job){job.finish(unavailable(reason));job=null}}
  async function snapshot(key){
   if(!fetcher)throw Error('Snapshot fetch is unavailable.');
   const response=await fetcher(PATHS[key],{cache:'no-store',...(typeof AbortSignal!=='undefined'&&typeof AbortSignal.timeout==='function'?{signal:AbortSignal.timeout(20000)}:{})});
   if(!response||response.ok!==true)throw Error('Snapshot request failed.');return response.json();
  }
  async function refreshInputs(){
   if(destroyed)return unavailable('NBA selection provider was closed.');
   if(refreshTask)return refreshTask;
   const version=revision;
   const task=(async()=>{
    const entries=Object.keys(PATHS),results=await Promise.allSettled(entries.map(snapshot));
    if(destroyed||version!==revision)return unavailable('NBA sources changed during refresh.');
    const inputs={};for(let i=0;i<entries.length;i++)inputs[entries[i]]=results[i].status==='fulfilled'?results[i].value:null;
    const missing=entries.filter((key,i)=>key!=='context'&&results[i].status==='rejected');
    if(missing.length){cache=null;current=null;stop('Required NBA snapshots could not be refreshed.');return unavailable('Required NBA '+missing.join(', ')+' snapshots could not be refreshed. Retry before selecting props.');}
    let existing=null;try{existing=options.getInputs?.()}catch(_){}
    for(const prior of [current,existing]){
     if(injurySchema(prior?.injuries)&&stamp(prior.injuries)<=now()&&stamp(prior.injuries)>stamp(inputs.injuries))inputs.injuries=prior.injuries;
     if(object(prior?.context)&&Number.isFinite(stamp(prior.context))&&stamp(prior.context)<=now()&&(!Number.isFinite(stamp(inputs.context))||stamp(prior.context)>=stamp(inputs.context)))inputs.context=prior.context;
    }
    // A live report may replace a published snapshot only with its own newer
    // source timestamp. Fetch time never becomes evidence freshness.
    if(typeof options.refreshAvailability==='function'){
     try{const live=await options.refreshAvailability(inputs);if(destroyed||version!==revision)return unavailable('NBA sources changed during availability refresh.');
      const injury=injurySchema(live)?live:live?.injuries;if(injurySchema(injury)&&(!Number.isFinite(stamp(inputs.injuries))||stamp(injury)>stamp(inputs.injuries))&&stamp(injury)<=now())inputs.injuries=injury;
      if(object(live?.context)&&Number.isFinite(stamp(live.context))&&(!Number.isFinite(stamp(inputs.context))||stamp(live.context)>=stamp(inputs.context))&&stamp(live.context)<=now())inputs.context=live.context;
     }catch(_){/* Published evidence must still pass the same source age gates. */}
    }
    const embedded=inputs.context?.availability;if(injurySchema(embedded)&&stamp(embedded)>stamp(inputs.injuries)&&stamp(embedded)<=now())inputs.injuries=embedded;
    if(!object(inputs.context)||!Number.isFinite(stamp(inputs.context))||stamp(inputs.context)>now()+300000)inputs.context=null;
    const reason=validate(inputs,now());if(reason){cache=null;current=null;stop(reason);return unavailable(reason);}
    const games=fixtures(inputs.feed,now()),signature=sourceSignature(inputs,games);
    if(current&&current.signature!==signature){cache=null;stop('The NBA sources changed during simulation. Generate a fresh draft.');}
    current={...inputs,games,signature,ready:true,reason:games.length?'':'No upcoming NBA games remain today (Eastern).'};
    if(typeof options.updateInputs==='function')await options.updateInputs(current);
    if(destroyed||version!==revision)return unavailable('NBA sources changed during refresh.');
    lastRefreshAt=now();return current;
   })();
   const safeTask=task.catch(()=>{if(destroyed||version!==revision)return unavailable('NBA sources changed during refresh.');cache=null;current=null;stop('NBA input refresh failed.');return unavailable('NBA input refresh failed. Retry before selecting props.');});
   refreshTask=safeTask;try{return await safeTask}finally{if(refreshTask===safeTask)refreshTask=null}
  }
  function supported(rows,inputs){
   const at=now(),byGame=new Map(fixtures(inputs.feed,at).map(g=>[String(g.id),g]));
   return (Array.isArray(rows)?rows:[]).flatMap(row=>{
    let c;try{c=gf?.candidate?.(row)}catch(_){return []}
    const g=byGame.get(String(c?.gameId)),r=c?.roleEvidence;if(!c||!lines.selectionMarket(c.market)||!g||!r||r.eligible!==true||r.roleStatus!=='SUPPORTED'||!Array.isArray(c.samples)||c.samples.length<1000||!['over','under'].includes(c.side)||c.score<gf.minimumScore(c.market,c.side)||c.reviewRequired||c.eligible!==true)return [];
    if(!c.game||String(c.game.id)!==String(g.id)||c.game.home!==g.home||c.game.away!==g.away||time(c.game.date)!==time(g.date))return [];
    const statuses=['NOT LISTED','ACTIVE','AVAILABLE','PROBABLE'];if(!statuses.includes(String(r.status||'').toUpperCase())||c.status!==undefined&&!statuses.includes(String(c.status).toUpperCase())||![g.home,g.away].includes(c.team)||c.opponent!==undefined&&c.opponent!==(c.team===g.home?g.away:g.home)||!Array.isArray(inputs.rosters.teams[c.team])||!inputs.rosters.teams[c.team].map(String).includes(String(c.playerId)))return [];
    for(const [key,value]of [['games',inputs.feed],['rosters',inputs.rosters],['injuries',inputs.injuries]])if(time(c.inputTimes?.[key])!==stamp(value))return [];
    if(r.inputTimes&&['games','rosters','injuries'].some(key=>time(r.inputTimes[key])!==time(c.inputTimes[key])))return [];
    if(time(g.date)-at<=90*60000&&at-stamp(inputs.injuries)>15*60000)return [];
    return [c];
   });
  }
  function marketKey(value){
   const key=String(value||'unknown').trim().toLowerCase().replace(/\s+/g,' ');
   return ({'points + rebounds':'pr','points + assists':'pa','rebounds + assists':'ra','steals + blocks':'stocks'})[key]||key;
  }
  function countMarkets(rows){const result={};for(const row of rows||[]){const key=marketKey(row?.market);result[key]=(result[key]||0)+1;}return result;}
  function stages(rows){
   const eligible=[],rated=[];
   for(const row of rows||[]){
    if(!['over','under'].includes(row.side)||row.eligible!==true||row.reviewRequired)continue;
    eligible.push(row);
    if(Number.isFinite(row.matchupRating?.score)&&row.matchupRating.score>=gf.minimumScore(row.market,row.side))rated.push(row);
   }
   return {simulated:countMarkets(rows),eligible:countMarkets(eligible),rated:countMarkets(rated)};
  }
  function marketAudit(raw,accepted,stageCounts,scoreBands={}){
   const counts=stageCounts||stages(raw);
   return {simulated:counts.simulated||{},eligible:counts.eligible||{},rated:counts.rated||{},preScoreBands:scoreBands,
    beforeFinalSafety:countMarkets(raw),afterFinalSafety:countMarkets(accepted),rejectedByFinalSafety:Math.max(0,(raw||[]).length-(accepted||[]).length)};
  }
  async function fallback(inputs,version){
   if(typeof gf?.analyze!=='function'||typeof gf?.candidate!=='function')return unavailable('The NBA research engine is unavailable.');
   const rows=[],held=[],diagnostics={gamesAnalyzed:0,modelRows:0,eligibleRows:0,ratedRows:0,qualifiedRows:0,modelUnavailableGames:0,scoreBands:{}};
   for(let i=0;i<inputs.games.length;i++){
    await new Promise(resolve=>schedule(resolve,0));if(destroyed||version!==revision||current?.signature!==inputs.signature)return unavailable('NBA sources changed during simulation.');
    progress({type:'progress',completed:i,total:inputs.games.length,game:inputs.games[i]});
    const result=gf.analyze(inputs.games[i],inputs.feed,inputs.injuries,inputs.rosters,inputs.context,now(),{count:1000});
    const sampled=result?.rows||[];for(const [market,counts] of Object.entries(result?.scoreBands||{})){if(!diagnostics.scoreBands[market])diagnostics.scoreBands[market]={under60:0,from60to69:0,from70to79:0,atLeast80:0};for(const key of Object.keys(diagnostics.scoreBands[market]))diagnostics.scoreBands[market][key]+=counts[key]||0;}rows.push(...sampled);diagnostics.gamesAnalyzed++;diagnostics.modelRows+=sampled.length;diagnostics.eligibleRows+=sampled.filter(r=>['over','under'].includes(r.side)&&r.eligible===true&&!r.reviewRequired).length;diagnostics.ratedRows+=sampled.filter(r=>['over','under'].includes(r.side)&&Number.isFinite(r.matchupRating?.score)&&r.matchupRating.score>=gf.minimumScore(r.market,r.side)).length;if(result?.reason){held.push({gameId:String(inputs.games[i].id),reason:result.reason});if(!sampled.length)diagnostics.modelUnavailableGames++;}
   }
   const modelCandidates=rows.map(row=>gf.candidate(row)).filter(Boolean);const eligible=supported(modelCandidates,inputs);diagnostics.qualifiedRows=eligible.length;diagnostics.marketAudit=marketAudit(modelCandidates,eligible,stages(rows),diagnostics.scoreBands);return {candidates:eligible,held,diagnostics,signature:inputs.signature,ready:true,reason:''};
  }
  function runWorker(inputs,version){
   const make=options.workerFactory||(typeof root.Worker==='function'?()=>new root.Worker('./nba_parlay_worker.js?v=nba-qualified-view-v1'):null);
   if(!make)return fallback(inputs,version);
   return new Promise(resolve=>{
    let worker,timer,finished=false;const requestId=++request;
    const finish=result=>{if(finished)return;finished=true;if(timer!==undefined)cancel(timer);try{worker?.terminate()}catch(_){}if(job?.requestId===requestId)job=null;resolve(result)};
    job={requestId,finish};
    try{worker=make();if(!worker||typeof worker.postMessage!=='function')throw Error('Worker unavailable');
     worker.onmessage=event=>{const data=event?.data;if(finished||destroyed||version!==revision||current?.signature!==inputs.signature)return finish(unavailable('NBA sources changed during simulation.'));if(data?.requestId!==requestId)return;
      if(data.type==='progress'){progress(data);return}
      if(data.type==='error')return finish(unavailable(typeof data.error==='string'?data.error:'The NBA simulation worker failed.'));
      if(data.type!=='result'||!Array.isArray(data.candidates))return finish(unavailable('The NBA simulation returned incomplete results. Retry the research scan.'));
      const accepted=supported(data.candidates,inputs);const diagnostics={...(data.diagnostics||{}),marketAudit:marketAudit(data.candidates,accepted,data.diagnostics?.marketStages,data.diagnostics?.scoreBands)};finish({candidates:accepted,held:Array.isArray(data.held)?data.held:[],diagnostics,signature:inputs.signature,ready:true,reason:''});
     };
     worker.onerror=()=>finish(unavailable('The NBA simulation worker failed. Retry the research scan.'));
     worker.onmessageerror=()=>finish(unavailable('The NBA simulation result could not be read.'));
     timer=schedule(()=>finish(unavailable('The NBA simulation timed out. Retry the research scan.')),120000);
     worker.postMessage({requestId,feed:inputs.feed,rosters:inputs.rosters,injuries:inputs.injuries,context:inputs.context,games:inputs.games,now:now()});
    }catch(_){finish(unavailable('The NBA simulation worker could not start. Retry the research scan.'))}
   });
  }
  async function getCandidates(options={}){
   // Only a scan that just completed an explicit full source refresh may reuse
   // those already validated bytes; Quick Slip and other calls still refetch.
   const reuse=options.reuseFreshInputs===true&&current?.ready&&now()-lastRefreshAt>=0&&now()-lastRefreshAt<=10000&&!validate(current,now());
   const inputs=reuse?current:await refreshInputs();if(destroyed||!inputs.ready)return unavailable(inputs.reason||'Fresh NBA research is unavailable.');
   if(!inputs.games.length)return {candidates:[],signature:inputs.signature,reason:inputs.reason,ready:true};
   if(cache&&cache.signature===inputs.signature&&now()-cache.at<=5*60000&&now()>=cache.at)return {...cache.result,candidates:supported(cache.result.candidates,inputs)};
   if(computeTask&&computeTask.signature===inputs.signature)return computeTask.promise;
   const version=revision,promise=(async()=>{const result=await runWorker(inputs,version);if(destroyed||version!==revision||current?.signature!==inputs.signature)return unavailable('NBA sources changed during simulation.');
    if(result.ready){const candidates=supported(result.candidates,inputs);const value={...result,candidates,heldCount:result.held?.length||0,reason:candidates.length?'':result.held?.[0]?.reason||'No supported OVER or UNDER 80/100+ player props are available from the current sources.'};cache={signature:inputs.signature,at:now(),result:value};return value}return result;
   })().catch(()=>unavailable('The NBA research engine failed. Retry the research scan.'));computeTask={signature:inputs.signature,promise};
   try{return await promise}finally{if(computeTask?.promise===promise)computeTask=null}
  }
  return {refreshInputs,getCandidates,invalidate(){revision++;current=null;cache=null;lastRefreshAt=0;refreshTask=null;computeTask=null;stop('NBA sources were invalidated. Generate fresh research.');},destroy(){if(destroyed)return;destroyed=true;revision++;current=null;cache=null;lastRefreshAt=0;refreshTask=null;computeTask=null;stop('NBA selection provider was closed.');}};
 }
 return {create};
});
