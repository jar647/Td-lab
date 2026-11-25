'use strict';
const assert=require('node:assert/strict');
const ui=require('./nba_parlay_ui.js');
const now=Date.parse('2026-11-18T12:00:00Z');
const stamp=new Date(now-60000).toISOString();
const decode=value=>String(value).replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const camel=value=>value.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());

// A small DOM adapter exercises delegated inputs and targeted updates. Nodes
// retain identity until the host is rendered again, like real browser inputs.
class Host{
 constructor(){this.listeners={};this.nodes=[];this.renderCount=0;this.activeElement=null;this._html='';}
 set innerHTML(value){
  this._html=String(value);this.renderCount++;this.nodes=[];
  for(const match of this._html.matchAll(/<([a-z]+)\b([^>]*)>/gi)){
   const attrs={};for(const a of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g))attrs[a[1]]=decode(a[2]??'');
   if(!Object.keys(attrs).some(key=>key.startsWith('data-')))continue;
   const tag=match[1],rest=this._html.slice(match.index+match[0].length),close=rest.indexOf('</'+tag+'>');
   const node={tagName:tag.toUpperCase(),dataset:{},value:attrs.value??'',disabled:Object.hasOwn(attrs,'disabled'),
    innerHTML:close<0?'':rest.slice(0,close),textContent:close<0?'':decode(rest.slice(0,close).replace(/<[^>]*>/g,'')),
    focus:()=>{this.activeElement=node},closest:selector=>selector==='button'&&tag==='button'?node:null};
   for(const [key,val]of Object.entries(attrs))if(key.startsWith('data-'))node.dataset[camel(key.slice(5))]=val;
   node.attributes=attrs;this.nodes.push(node);
  }
 }
 get innerHTML(){return this._html}
 querySelectorAll(selector){return this.nodes.filter(node=>selector.split(',').some(part=>{const m=/^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(part.trim());return !!m&&Object.hasOwn(node.attributes,m[1])&&(m[2]===undefined||node.attributes[m[1]]===m[2])}))}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null}
 addEventListener(name,fn){this.listeners[name]=fn}
 removeEventListener(name){delete this.listeners[name]}
}
function candidate(id,gameId='G1',score=94,market='points'){
 const index=Number(gameId.replace(/\D/g,''))||1,home='H'+index,away='A'+index;
 const samples=Array.from({length:1000},(_,i)=>i<500?30:i<700?20:10);
 return {key:gameId+'|'+id+'|'+market,playerId:id,gameId,name:'Player '+id,team:home,opponent:away,position:'SG',market,side:'over',eligible:true,reviewRequired:false,score,matchupRating:{score},line:19.5,samples,
  game:{id:gameId,home,away,date:new Date(now+(index+4)*3600000).toISOString(),status:'STATUS_SCHEDULED'},
  inputTimes:{games:stamp,injuries:stamp,rosters:stamp},outcomeSetId:'batch-'+gameId,
  roleEvidence:{playerId:id,team:home,eligible:true,roleStatus:'SUPPORTED',status:'ACTIVE',projectedMinutes:31,minutesLow:30,minutesHigh:32,historyGames:10,holdReasons:[]},
  selectedLineEvidence:{policy:'nba-balanced-alt-v1',offered:false},linePolicy:'nba-balanced-alt-v1'};
}
function pool(){return [candidate('a'),candidate('b'),candidate('c'),candidate('d','G2',93),candidate('e','G3',92),candidate('f','G4',91)]}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
function mount(candidates=pool()){
 const host=new Host(),existing={sport:'NFL',player:'Previously saved',line:50},picks=[existing];let clock=now,calls=0,loader=null;
 const state={signature:'source-1',ready:true,candidates};
 const controller=ui.create({root:host,now:()=>clock,getCandidates:async()=>{calls++;return loader?loader():state},quickSlip:{add(pick){picks.push(pick)}}});
 const node=attr=>host.querySelector('[data-nba-parlay-'+attr+']');
 return {host,state,picks,existing,controller,node,calls:()=>calls,setTime:value=>{clock=value},setLoader:fn=>{loader=fn},
  result:()=>node('result')?.innerHTML||'',status:()=>node('status')?.textContent||'',
  event(type,dataset,value){host.listeners[type]({target:{dataset,value:String(value)}})}};
}
function fill(view,line='19.5',odds=''){
 for(const c of view.controller.getDraft())assert(view.controller.setQuote(c.key,{line,odds}));
}
const near=(actual,expected)=>assert(Math.abs(actual-expected)<1e-12,actual+' != '+expected);

(async()=>{
 const view=mount();assert.deepEqual(view.controller.getState().count,3);
 let draft=await view.controller.generate();assert.equal(draft.length,3);assert.equal(new Set(draft.map(c=>c.gameId)).size,3);assert.equal(new Set(draft.map(c=>c.playerId)).size,3);
 assert(draft.every(c=>c.score>=85&&c.side==='over'));assert.match(view.host.innerHTML,/supported minutes/);assert.match(view.host.innerHTML,/rather than simply taking the highest scores/);
 assert.match(view.result(),/Unverified research targets/);assert.match(view.result(),/34\.3% simulated/);assert.match(view.result(),/Separate games are assumed independent/);
 for(const input of view.host.querySelectorAll('[data-nba-parlay-line]'))assert.equal(input.value,'','research lines must not masquerade as actual book offerings');
 assert.equal(view.node('add').disabled,true);assert.equal(await view.controller.add(),false);assert.equal(view.picks.length,1);
 assert.equal(view.controller.setQuote('unknown',{line:'19.5'}),false);
 fill(view);assert.match(view.result(),/Exact book lines/);assert.equal(view.node('add').disabled,false);assert.doesNotMatch(view.result(),/Book’s combined price:/);

 const key=draft[0].key,lineNode=view.host.querySelectorAll('[data-nba-parlay-line]').find(node=>node.dataset.nbaParlayLine===key);
 lineNode.focus();const rendered=view.host.renderCount;
 view.event('input',{nbaParlayLine:key},'20.5');assert.equal(view.host.renderCount,rendered);assert.equal(view.host.activeElement,lineNode);assert.equal(lineNode.value,'20.5');
 assert.match(view.result(),/24\.5% simulated/,'exact book line updates both marginal and joint frequencies');assert.match(view.host.querySelectorAll('[data-nba-parlay-review]').find(n=>n.dataset.nbaParlayReview===key).innerHTML,/50\.0% simulated wins/);
 view.controller.setCombined('+500');view.controller.setStake('10');assert.equal(view.node('combined').value,'+500');assert.equal(view.node('stake').value,'10');assert.match(view.result(),/returns \$60\.00/);assert.match(view.result(),/\$50\.00 profit/);assert.match(view.result(),/requires 16\.7% wins/);assert.match(view.result(),/does not establish a betting edge/);
 view.event('input',{nbaParlayStake:''},'20');assert.match(view.result(),/returns \$120\.00/);assert.equal(view.host.renderCount,rendered,'prices and stake preserve active inputs');
 const original=draft.map(c=>({key:c.key,score:c.score,line:c.line}));const before=view.calls();
 assert.equal(await view.controller.add(),true);assert.equal(view.calls(),before+1,'saving rechecks current source evidence');assert.equal(view.picks[0],view.existing);assert.equal(view.picks.length,4);
 const exact=view.picks.slice(1);for(const pick of exact){assert.equal(pick.sport,'NBA');assert.equal(pick.side,'over');assert.equal(pick.line,pick.playerId===draft[0].playerId?20.5:19.5);assert.equal(pick.line,pick.recommendationLine);assert.equal(pick.lineOfferingConfirmed,true);assert.equal(pick.parlayCombinedOdds,500);assert.equal(pick.parlayType,'cross_game');assert.equal(pick.parlaySize,3);assert.equal(pick.propScore,null);assert(!Object.hasOwn(pick,'americanOdds'),'blank per-leg price is not invented');assert.match(pick.notes,/uncalibrated/);near(pick.scenarioRate,pick.playerId===draft[0].playerId?.5:.7);near(pick.parlayJointFrequency,.245)}
 assert.deepEqual(view.controller.getDraft().map(c=>({key:c.key,score:c.score,line:c.line})),original,'actual prices and lines do not rewrite research targets or scores');
 assert.equal(await view.controller.refresh(),true);assert.equal(view.host.renderCount,rendered,'unchanged refresh retains active inputs and exact typed values');

 // Every invalid input fails closed without changing the suggested research.
 for(const bad of ['', '0','-1','19.25','401','NaN','Infinity']){view.controller.setQuote(key,{line:bad});assert.equal(view.node('add').disabled,true);assert.equal(await view.controller.add(),false);assert.doesNotMatch(view.result(),/Book’s combined price:/)}
 fill(view);for(const bad of ['+99','-90','wrong','0']){view.controller.setQuote(key,{odds:bad});assert.equal(view.node('add').disabled,true);assert.equal(await view.controller.add(),false)}
 view.controller.setQuote(key,{odds:'-110'});view.controller.setCombined('+500');assert.equal(view.node('add').disabled,false);
 view.controller.setQuote(key,{odds:'+150'});assert.equal(view.node('combined').value,'');assert.doesNotMatch(view.result(),/Book’s combined price:/,'changed leg price invalidates the old full-ticket quote');
 view.controller.setCombined('100x');assert.equal(view.node('add').disabled,true);assert.equal(await view.controller.add(),false);assert.match(view.result(),/valid combined American odds/);
 view.controller.setCombined('+500');for(const bad of ['',0,-10,'nope',100001]){view.controller.setStake(bad);assert.match(view.result(),/stake greater than/);assert.doesNotMatch(view.result(),/returns \$/)}
 view.controller.setStake(10);const probability=view.result().match(/all legs win: ([\d.]+)%/)[1];view.controller.setCombined('+5000');assert.equal(view.result().match(/all legs win: ([\d.]+)%/)[1],probability,'odds never affect simulated frequencies');
 view.controller.setQuote(key,{line:'20'});assert.match(view.result(),/at least one push: 9\.8%/);assert.match(view.result(),/reduced-ticket/);view.controller.setCombined('+500');assert.doesNotMatch(view.result(),/requires .* wins/,'push tickets do not use full-price break-even math');

 // Counts, all-game selection, same-game shared draws, no filler and Q limits.
 assert.equal(view.controller.setCount(1),false);assert.equal(view.controller.setMode('bogus'),false);
 for(const count of [2,4]){assert.equal(view.controller.setCount(count),true);draft=await view.controller.generate();assert.equal(draft.length,count);assert.equal(new Set(draft.map(c=>c.gameId)).size,count)}
 view.controller.setCount(3);view.controller.setMode('sgp');view.controller.setGame('G1');draft=await view.controller.generate();assert.equal(draft.length,3);assert(draft.every(c=>c.gameId==='G1'));assert.match(view.result(),/70\.0% simulated/,'shared same-game draws replace a product of 70% marginals');assert.match(view.result(),/same simulated games/);assert.doesNotMatch(view.result(),/assumed independent/);fill(view);
 assert.equal(await view.controller.add(),true);for(const pick of view.picks.slice(-3)){near(pick.parlayJointFrequency,.7);assert.equal(pick.parlayType,'sgp');assert.equal(pick.side,'over')}
 view.controller.setGame('G2');draft=await view.controller.generate();assert.equal(draft.length,1);assert.match(view.result(),/complete 3-leg/);assert.doesNotMatch(view.result(),/all legs win:/);assert.equal(await view.controller.add(),false);
 const ten=mount(Array.from({length:10},(_,i)=>candidate('ten'+i,i<5?'G1':'G2')));
 ten.controller.setCount(10);ten.controller.setMode('multi_game');
 assert.equal((await ten.controller.generate()).length,10);
 assert.equal(await ten.controller.addResearch(),true);
 assert.equal(ten.picks.length,11,'Add All preserves existing picks and saves ten research targets');
 ten.state.signature='changed-after-generation';
 assert.equal(await ten.controller.addResearch(),false);
 assert.equal(ten.picks.length,11,'Add All rejects changed source evidence');
 ten.controller.destroy();
 const sameTen=mount(Array.from({length:10},(_,i)=>candidate('same'+i,'G1')));
 sameTen.controller.setCount(10);sameTen.controller.setMode('sgp');
 assert.equal((await sameTen.controller.generate()).length,10);
 sameTen.controller.destroy();
 const sensitive=mount(pool().map(c=>({...c,availabilitySensitivity:{type:'equal_weight_in_out',players:['Questionable teammate'],probabilityValidated:false}})));await sensitive.controller.generate();assert.match(sensitive.host.innerHTML,/not estimates of participation probability/);assert.match(sensitive.host.innerHTML,/equally weighted in\/out sensitivity/);sensitive.controller.destroy();

 // A source ID alone is insufficient: actual role, availability and sample
 // edits also invalidate a previously quoted ticket before it can be saved.
 for(const kind of ['signature','injuries','role','status','samples','removed','not-ready']){
  const changed=mount();await changed.controller.generate();fill(changed);const first=changed.controller.getDraft()[0],source=changed.state.candidates.find(c=>c.key===first.key);
  if(kind==='signature')changed.state.signature='source-2';if(kind==='injuries')source.inputTimes={...source.inputTimes,injuries:new Date(now).toISOString()};if(kind==='role')source.roleEvidence={...source.roleEvidence,minutesLow:22};if(kind==='status')source.status='OUT';if(kind==='samples')source.samples=[...source.samples.slice(1),25];if(kind==='removed')changed.state.candidates=changed.state.candidates.filter(c=>c.key!==first.key);if(kind==='not-ready')changed.state.ready=false;
  assert.equal(await changed.controller.add(),false,kind);assert.equal(changed.controller.getDraft().length,0,kind);assert.equal(changed.picks.length,1,kind);assert.match(changed.status(),/source evidence changed/);changed.controller.destroy();
 }
 const elapsed=mount();await elapsed.controller.generate();fill(elapsed);elapsed.setTime(now+6*3600000);assert.equal(await elapsed.controller.add(),false);assert.equal(elapsed.picks.length,1);await elapsed.controller.refresh();assert.equal(elapsed.controller.getDraft().length,0);elapsed.controller.destroy();
 const failure=mount();await failure.controller.generate();fill(failure);failure.setLoader(()=>Promise.reject(new Error('provider unavailable')));assert.equal(await failure.controller.add(),false);assert.equal(failure.controller.getDraft().length,0);assert.equal(failure.picks.length,1);assert.match(failure.status(),/could not be verified/);failure.controller.destroy();

 // Late requests cannot replace a newer configuration, source or edited line.
 const race=mount(),late=deferred();race.setLoader(()=>late.promise);const old=race.controller.generate();race.controller.setCount(2);race.setLoader(null);assert.equal((await race.controller.generate()).length,2);late.resolve({...race.state,signature:'obsolete'});assert.deepEqual(await old,[]);assert.equal(race.controller.getDraft().length,2);assert(!race.controller.getState().signature.includes('obsolete'));race.controller.destroy();
 const editing=mount();await editing.controller.generate();fill(editing);const waiting=deferred();editing.setLoader(()=>waiting.promise);const adding=editing.controller.add();editing.controller.setQuote(editing.controller.getDraft()[0].key,{line:'20.5'});waiting.resolve(editing.state);assert.equal(await adding,false);assert.equal(editing.picks.length,1);assert.match(editing.status(),/changed during the source check/);editing.setLoader(null);assert.equal(await editing.controller.add(),true);editing.controller.destroy();
 const stopped=mount(),stop=deferred();stopped.setLoader(()=>stop.promise);const obsolete=stopped.controller.generate();stopped.controller.destroy();const stoppedHTML=stopped.host.innerHTML;stop.resolve(stopped.state);assert.deepEqual(await obsolete,[]);assert.equal(stopped.host.innerHTML,stoppedHTML);assert.deepEqual(stopped.host.listeners,{});assert.equal(stopped.controller.setCount(2),false);assert.equal(stopped.controller.setCombined('+500'),false);assert.equal(await stopped.controller.add(),false);

 // Feed text stays text across card labels, option values and limit details.
 const hostile=pool();hostile[0].name='<img src=x onerror="alert(1)">';hostile[0].key+='" onclick="alert(2)';const escaped=mount(hostile);await escaped.controller.generate();assert.doesNotMatch(escaped.host.innerHTML,/<img| onclick="alert/);assert.match(escaped.host.innerHTML,/&lt;img/);escaped.controller.destroy();
 const under=mount(pool().map(c=>({...c,side:'under'})));assert.equal((await under.controller.generate()).length,0);assert.equal(await under.controller.add(),false);under.controller.destroy();
 const stale=mount();await stale.controller.generate();fill(stale);stale.state.ready=false;stale.state.reason='A valid game feed from the last 12 hours is required.';assert.deepEqual(await stale.controller.generate(),[]);assert.equal(stale.status(),stale.state.reason,'provider refresh failures remain visible instead of a generic score-filter reason');assert.equal(stale.controller.getDraft().length,0);assert.equal(stale.node('add'),null);assert.equal(stale.picks.length,1);stale.controller.destroy();
 view.controller.destroy();assert.deepEqual(view.host.listeners,{});
 console.log('NBA parlay UI: supported full-pool drafts, exact-line joint frequencies, real book payouts, input focus, save metadata, source freshness and asynchronous race guards PASS');
})().catch(error=>{console.error(error);process.exitCode=1});
