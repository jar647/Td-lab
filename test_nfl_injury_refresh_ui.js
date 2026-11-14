'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
assert.match(html,/<p id="nflInjuryStatus"[^>]*role="status"[^>]*aria-live="polite"/);
assert(html.indexOf('id="nflInjuryStatus"')>html.indexOf('id="nflTopPlaysHeading"'));
assert(html.indexOf('id="nflInjuryStatus"')<html.indexOf('id="nflTopPlays"'));
assert.match(html,/startNFLInjuryRefresh\(\);\s*<\/script>/,'browser starts the published-feed poll');
const start=html.indexOf('const NFL_INJURY_POLL_MS='),end=html.indexOf('async function loadProjectionTracker()',start);
assert(start>0&&end>start);const source=html.slice(start,end);new vm.Script(source);
const beginning=Date.parse('2026-11-14T17:00:00Z');
const clone=value=>JSON.parse(JSON.stringify(value));
const published={status:'ready',season:2026,week:11,generated_at:new Date(beginning).toISOString(),rosterPlayers:[],
 availability_diagnostics:{injuries:{live_source:{reports:{gsis:{status:'OUT'}},diagnostics:{status:'ok',observed_at:new Date(beginning-60000).toISOString(),source_updated_at:new Date(beginning-3600000).toISOString(),source:'ESPN'}}}}};
function response(payload,ok=true){return {ok,async json(){return clone(payload)}}}
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}
function harness(){
 let time=beginning,meta=clone(published),items=[{player:'Player Test',team:'A',opp:'B',pos:'RB',market:'ATD',availability:'ROSTER_ACTIVE'}],statusError=false,statusGate=null;
 const elements=new Map(),requests=[],renders=[],gameLoads=[],intervals=[],events=new Map();
 const element=id=>{if(!elements.has(id))elements.set(id,{textContent:'',innerHTML:'',className:''});return elements.get(id)};
 class ClockDate extends Date{constructor(...args){super(...(args.length?args:[time]))}static now(){return time}}
 const context={Date:ClockDate,console,Promise,JSON,Number,String,Object,Array,Set,Map,
  nflTopPlaysFeedMeta:null,activeFeedWeek:null,autoRecords:[],propVaultGameFeed:{generated_at:null,games:[]},
  $:element,escapeHTML:value=>String(value??''),valid:r=>!!r.player,manuallyInactive:()=>false,
  save(){},loadHardRockStatus(){},renderBestBets(){},renderGameSGP(){},
  renderBoard(){renders.push({records:context.autoRecords,meta:context.nflTopPlaysFeedMeta,gameFeed:context.propVaultGameFeed})},
  PropShopNFLTopPlays:{mergeRecords:(rows,roster)=>[...rows,...roster]},
  async loadGamePicks(options){gameLoads.push(options);context.propVaultGameFeed={generated_at:meta.generated_at,games:[{home:'A',away:'B'}]};return true},
  async fetch(url,options){requests.push({url,options});if(url.includes('status.json')){if(statusGate){const gate=statusGate;statusGate=null;return gate.promise}return response(meta,!statusError)}if(url.includes('matchups.json'))return response(items);throw Error('Unexpected fetch '+url)},
  document:{visibilityState:'visible',addEventListener(name,fn){events.set(name,fn)}},
  setInterval(fn,delay){intervals.push({fn,delay});return intervals.length}
 };
 vm.createContext(context);vm.runInContext(source,context);
 return {context,element,requests,renders,gameLoads,intervals,events,meta:()=>meta,
  setMeta(value){meta=clone(value)},setItems(value){items=clone(value)},setTime(value){time=value},advance(ms){time+=ms},setError(value){statusError=value},setGate(value){statusGate=value}};
}
(async()=>{
 const view=harness(),ctx=view.context;assert.equal(await ctx.loadAutoFeed(),true);
 const status=view.element('nflInjuryStatus');assert(status.textContent.includes(new Date(beginning-60000).toLocaleString()));assert.match(status.textContent,/ESPN \+ nflverse/);assert.match(status.textContent,/OUT players excluded/);assert.match(status.textContent,/actives still require verification/);assert.doesNotMatch(status.className,/notice/);
 const originalRecords=ctx.autoRecords,originalRenders=view.renders.length,originalRequests=view.requests.length;
 assert.equal(await ctx.pollNFLInjuryStatus(),false);assert.equal(ctx.autoRecords,originalRecords,'unchanged publication preserves canonical object identity and cached simulations');assert.equal(view.renders.length,originalRenders,'unchanged status does not reset the player board or quotes');assert.equal(view.gameLoads.length,0);assert.equal(view.requests.length,originalRequests+1);assert(view.requests.every(r=>r.options?.cache==='no-store'));
 const changed=clone(published);changed.availability_diagnostics.injuries.live_source.reports.gsis.status='DOUBTFUL';changed.availability_diagnostics.injuries.live_source.diagnostics.observed_at=new Date(beginning).toISOString();view.setMeta(changed);view.setItems([{player:'Player Test',team:'A',opp:'B',pos:'RB',market:'ATD',availability:'OUT'}]);
 assert.equal(await ctx.pollNFLInjuryStatus(),true,'changed injury data reloads even when the publication timestamp is unchanged');assert.notEqual(ctx.autoRecords,originalRecords);assert.equal(ctx.autoRecords[0].availability,'OUT');assert.equal(view.gameLoads.length,1);assert.equal(view.gameLoads[0].deferRender,true);assert.equal(view.renders.length,originalRenders+1,'batch publishes one render after the new records and fixtures are loaded');assert.equal(view.renders.at(-1).gameFeed.generated_at,changed.generated_at);
 const newer=clone(changed);newer.generated_at=new Date(beginning+1000).toISOString();view.setMeta(newer);assert.equal(await ctx.pollNFLInjuryStatus(),true,'new publication timestamp reloads the canonical feed');assert.equal(view.gameLoads.length,2);
 const unchangedRecords=ctx.autoRecords,unchangedRenders=view.renders.length;assert.equal(await ctx.pollNFLInjuryStatus(),false);assert.equal(ctx.autoRecords,unchangedRecords);assert.equal(view.renders.length,unchangedRenders);
 for(const state of ['cached','partial','unavailable']){const meta=clone(newer);meta.availability_diagnostics.injuries.live_source.diagnostics.status=state;ctx.renderNFLInjuryStatus(meta);assert.match(status.className,/notice/);assert.match(status.textContent,/verify official injury and inactive reports/i);assert.doesNotMatch(status.textContent,/OUT players excluded/)}
 ctx.renderNFLInjuryStatus({});assert.match(status.textContent,/unavailable/);assert.match(status.className,/notice/);
 view.setTime(beginning+91*60000);ctx.renderNFLInjuryStatus(newer);assert.match(status.textContent,/over 90 minutes old/);assert.match(status.className,/notice/);
 view.setTime(beginning+2000);view.setError(true);const lastDate=new Date(beginning).toLocaleString();assert.equal(await ctx.pollNFLInjuryStatus(),false);assert(status.textContent.includes(lastDate),'API error retains the last published injury check time');assert.match(status.textContent,/Could not refresh injury reports/);assert.match(status.className,/notice/);assert.equal(ctx.autoRecords,unchangedRecords);assert.equal(view.renders.length,unchangedRenders,'failed status polling preserves data and saved selections');
 // Polling and visibility listeners have one five-minute cadence and one
 // shared request, including while a failed check is awaiting its next turn.
 ctx.startNFLInjuryRefresh();ctx.startNFLInjuryRefresh();assert.equal(view.intervals.length,1);assert.equal(view.intervals[0].delay,300000);assert(view.events.has('visibilitychange'));
 let count=view.requests.length;ctx.document.visibilityState='hidden';view.advance(300000);view.intervals[0].fn();assert.equal(view.requests.length,count,'hidden tabs do not poll');ctx.document.visibilityState='visible';view.events.get('visibilitychange')();await ctx.pollNFLInjuryStatus();assert.equal(view.requests.length,count+1,'returning after five minutes checks published status');
 count=view.requests.length;view.events.get('visibilitychange')();assert.equal(view.requests.length,count,'failed poll has no immediate visibility retry');view.advance(299999);view.events.get('visibilitychange')();assert.equal(view.requests.length,count);view.advance(1);view.events.get('visibilitychange')();await ctx.pollNFLInjuryStatus();assert.equal(view.requests.length,count+1);
 view.setError(false);const gate=deferred();view.setGate(gate);const pending=ctx.pollNFLInjuryStatus();assert.equal(ctx.pollNFLInjuryStatus(),pending,'overlapping polls share one in-flight operation');gate.resolve(response(newer));await pending;assert.doesNotMatch(status.textContent,/Could not refresh/);
 // Manual/startup data loads also share a request and reject an older response
 // rather than overwriting a newer feed already applied to the page.
 const guarded=harness(),oldGate=deferred();guarded.setGate(oldGate);const one=guarded.context.loadAutoFeed(),two=guarded.context.loadAutoFeed();assert.equal(one,two);assert.equal(guarded.requests.length,2);const future=clone(published);future.generated_at=new Date(beginning+60000).toISOString();guarded.context.nflTopPlaysFeedMeta=future;const heldRecords=guarded.context.autoRecords;oldGate.resolve(response(published));assert.equal(await one,false);assert.equal(guarded.context.nflTopPlaysFeedMeta,future);assert.equal(guarded.context.autoRecords,heldRecords,'older asynchronous response cannot replace the current player feed');
 const loading=harness(),startupGate=deferred();loading.setGate(startupGate);const startup=loading.context.loadAutoFeed();loading.setMeta(newer);const pollDuringStartup=loading.context.pollNFLInjuryStatus();
 await Promise.resolve();await Promise.resolve();await Promise.resolve();assert.equal(loading.gameLoads.length,0,'poll waits for existing data loaders before applying a new publication');startupGate.resolve(response(published));await startup;
 assert.equal(await pollDuringStartup,true,'new injury publication is not lost by joining an older in-flight startup load');assert.equal(loading.context.nflTopPlaysFeedMeta.generated_at,newer.generated_at);assert.equal(loading.renders.at(-1).gameFeed.generated_at,newer.generated_at);
 const gameStart=html.indexOf('function loadGamePicks(options={})'),gameEnd=html.indexOf('async function loadNFLGamePicks(options={})',gameStart),gameGate=deferred();let gameRequests=0;
 const gameContext={loadNFLGamePicks:()=>{gameRequests++;return gameGate.promise}};vm.createContext(gameContext);vm.runInContext('let nflGameFeedLoad=null;'+html.slice(gameStart,gameEnd),gameContext);const first=gameContext.loadGamePicks(),second=gameContext.loadGamePicks();assert.equal(first,second);assert.equal(gameRequests,1);gameGate.resolve(true);await first;
 console.log('NFL injury refresh UI: source timestamps, five-minute polling, changed-only canonical reloads, batched rendering, warnings and async guards PASS');
})().catch(error=>{console.error(error);process.exitCode=1});
