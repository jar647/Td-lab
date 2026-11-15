/* Fixed five-scorer TD drafts use rankings and actual book prices, never invented TD simulations. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ui=require('./nfl_anytime_parlay_ui.js');
const now=Date.parse('2026-11-15T12:00:00Z'),stamp=new Date(now).toISOString();
function candidate(id,score=90,game='AB',extra={}){
 const scale=score/100,home=game[0],away=game[1];
 return {key:game+'|'+id+'|anytime_td',market:'anytime_td',category:'TD',side:'winner',line:null,scenarioRate:null,
  researchScore:score,score,d:{key:'anytime_td',label:'anytime rushing/receiving TD'},
  fixture:{game_id:game,home,away,kickoff_at:new Date(now+(game==='AB'?1:2)*3600000).toISOString()},
  p:{player_id:id,player:'TD Player '+id,team:home,opp:away,pos:'RB',market:'ATD',games:2,seasonGamesPlayed:2,last5GamesPlayed:2,
   availability:'ROSTER_ACTIVE',injuryReportStatus:'ACTIVE',playerAppearancesVerified:true,
   tdallowed:1.2*scale,rzallowed:3.5*scale,playerRz:2.5*scale,rzshare:35*scale,goalLine5:.8*scale,snapShare:.85*scale,
   playerAnytimeTDs:scale,recent3AnytimeTDs:scale,last5GameStats:[],...extra}};
}
function candidates(){return [
 candidate('a',99,'AB',{availability:'QUESTIONABLE',injuryReportStatus:'QUESTIONABLE',injuryPracticeStatus:'DNP_PRACTICE'}),
 candidate('b',98),candidate('c',97),candidate('d',96),candidate('e',95),candidate('f',94,'CD'),candidate('g',90,'CD'),
 {...candidate('yards',100,'CD'),market:'recYards',category:'REC',side:'at_least',line:50,scenarioRate:.99},
 candidate('out',100,'CD',{availability:'OUT',injuryReportStatus:'OUT'})];
}
function hostNode(){
 let html='',writes=0;const oddsNodes=new Map(),combined={value:'',dataset:{tdParlayCombined:''}},stake={value:'10',dataset:{tdParlayStake:''}},result={innerHTML:''};
 const value=tag=>/\bvalue="([^"]*)"/.exec(tag)?.[1]??'';
 const host={listeners:{},get innerHTML(){return html},set innerHTML(next){
  html=String(next);writes++;oddsNodes.clear();
  for(const tag of html.match(/<input\b[^>]*>/g)||[]){
   const key=/\bdata-td-parlay-odds="([^"]*)"/.exec(tag)?.[1];
   if(key)oddsNodes.set(key,{dataset:{tdParlayOdds:key},value:value(tag)});
   if(tag.includes('data-td-parlay-combined'))combined.value=value(tag);
   if(tag.includes('data-td-parlay-stake'))stake.value=value(tag);
  }
  result.innerHTML=/<div[^>]*data-td-parlay-result[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1]??'';
 },addEventListener(name,fn){this.listeners[name]=fn},removeEventListener(name){delete this.listeners[name]},
 querySelector(selector){return selector==='[data-td-parlay-result]'&&html.includes('data-td-parlay-result')?result:selector==='[data-td-parlay-combined]'?combined:selector==='[data-td-parlay-stake]'?stake:null},
 querySelectorAll(selector){return selector==='[data-td-parlay-odds]'?[...oddsNodes.values()]:[]}};
 return {host,oddsNodes,combined,stake,result,writes:()=>writes};
}
function mount(overrides={}){
 let clock=now;const nodes=hostNode(),existing={sport:'NBA',player:'Existing saved play',line:8},picks=[existing];
 const state={ready:true,tdReady:true,signature:'source-1',feedGeneratedAt:stamp,fixturesGeneratedAt:stamp,candidates:candidates(),...overrides};
 const controller=ui.create({root:nodes.host,getState:()=>state,now:()=>clock,quickSlip:{add(pick){picks.push(pick)}}});
 const input=(name,value)=>{const node=name==='tdParlayCombined'?nodes.combined:name==='tdParlayStake'?nodes.stake:{dataset:{[name]:''}};node.value=String(value);nodes.host.listeners.input({target:node})};
 const odds=(key,value)=>{const node=nodes.oddsNodes.get(key);assert(node,'generated TD odds control exists');node.value=String(value);nodes.host.listeners.input({target:node})};
 return {...nodes,controller,state,picks,existing,input,odds,setTime(value){clock=value}};
}
const count=view=>(view.host.innerHTML.match(/data-td-parlay-key=/g)||[]).length;
function noTDProbability(view){
 assert.doesNotMatch(view.host.innerHTML+view.result.innerHTML,/All legs win:|% simulated|simulated wins|simulated hit frequency|Model is [^<]*percentage points/);
 assert.doesNotMatch(view.host.innerHTML,/data-td-parlay-(?:line|simulate|count|mode|replace)(?:=|\s|>)/);
 assert.equal(typeof view.controller.simulate,'undefined','TD draft has no unsupported simulation method');
}

const view=mount({ready:false,tdReady:true}),draft=view.controller.generate();
assert.deepEqual(draft.map(c=>c.p.player_id),['a','b','c','d','e'],'fixed draft is exactly the highest five board scores');
assert.equal(count(view),5);assert.equal(new Set(draft.map(c=>c.fixture.game_id)).size,1,'same-game leaders are not replaced by lower-ranked players from other games');
assert.match(view.host.innerHTML,/QUESTIONABLE/);assert.match(view.host.innerHTML,/DNP/);
assert.match(view.host.innerHTML,/5 ANYTIME TD LEGS/);assert.match(view.host.innerHTML,/not touchdown probabilities/);
assert.doesNotMatch(view.host.innerHTML,/TD Player out|TD Player yards/);noTDProbability(view);
assert.equal(view.controller.setOdds('unknown','+150'),false);
assert.equal(view.controller.add(),true,'five current research picks can be saved without inventing missing prices');
assert.equal(view.picks.length,6);assert.strictEqual(view.picks[0],view.existing);
for(const saved of view.picks.slice(1)){
 assert.equal(saved.sport,'NFL');assert.equal(saved.marketKey,'anytime_td');assert.equal(saved.side,'winner');
 assert.equal(saved.line,null);assert.equal(saved.recommendationLine,null);assert.equal(saved.scenarioRate,null);
 assert.equal(saved.gameId,'AB');assert.equal(saved.game,'B @ A');assert.equal(saved.parlaySize,5);
 assert(!Object.hasOwn(saved,'americanOdds'),'blank odds stay absent instead of becoming assumed prices');
 assert(!Object.hasOwn(saved,'overOdds'),'a TD YES selection must not become a yardage OVER leg');
}
view.controller.destroy();assert.equal(Object.keys(view.host.listeners).length,0);

const pending=mount({ready:true,tdReady:false});assert.deepEqual(pending.controller.generate(),[],'explicit TD unavailability overrides generic ready');assert.equal(pending.controller.add(),false);pending.controller.destroy();
const legacy=mount();delete legacy.state.tdReady;assert.equal(legacy.controller.generate().length,5,'legacy ready fallback remains supported');legacy.controller.destroy();

const priced=mount();priced.controller.generate();
priced.input('tdParlayCombined','+500');assert.match(priced.result.innerHTML,/\$60\.00/);assert.match(priced.result.innerHTML,/\$50\.00/);
priced.input('tdParlayStake','20');assert.match(priced.result.innerHTML,/\$120\.00/);assert.match(priced.result.innerHTML,/\$100\.00/);
const writes=priced.writes(),first=priced.controller.getDraft()[0];
priced.odds(first.key,'+150');assert.equal(priced.writes(),writes,'typing a leg price preserves existing input nodes/focus');
assert.equal(priced.combined.value,'','changed leg prices invalidate the previous combined quote');
assert.doesNotMatch(priced.result.innerHTML,/\$120\.00/);
priced.input('tdParlayCombined','+500');priced.input('tdParlayStake','10');
assert.equal(priced.writes(),writes,'combined odds and stake typing do not replace the focused input');
assert.match(priced.result.innerHTML,/\$60\.00/);assert.equal(priced.controller.add(),true);
assert.equal(priced.picks.find(p=>p.playerId==='a').americanOdds,150);assert.equal(priced.picks.find(p=>p.playerId==='a').parlayCombinedOdds,500);
assert(!Object.hasOwn(priced.picks.find(p=>p.playerId==='b'),'americanOdds'));
priced.controller.generate();assert.equal(priced.oddsNodes.get(first.key).value,'+150','regenerating the same top five retains entered individual prices');
for(const invalid of ['-90','+95','-110.5','Infinity','garbage','0']){
 priced.controller.setOdds(first.key,invalid);const before=priced.picks.length;assert.equal(priced.controller.add(),false,'entered invalid leg price blocks save: '+invalid);assert.equal(priced.picks.length,before);
}
priced.controller.setOdds(first.key,'+150');
for(const invalid of ['-90','+95','-110.5','Infinity','garbage','0']){
 priced.input('tdParlayCombined',invalid);assert.doesNotMatch(priced.result.innerHTML,/returns \$/);assert.equal(priced.controller.add(),false,'invalid combined quote blocks save: '+invalid);
}
priced.input('tdParlayCombined','+500');
for(const invalid of ['','0','-5','Infinity','not-a-number','100001']){
 priced.input('tdParlayStake',invalid);assert.doesNotMatch(priced.result.innerHTML,/returns \$/,'invalid stake must not create a payout');assert.doesNotMatch(priced.result.innerHTML,/\$NaN|\$Infinity/);
}
priced.input('tdParlayStake','10');assert.match(priced.result.innerHTML,/\$60\.00/);noTDProbability(priced);priced.controller.destroy();

const short=mount({candidates:candidates().slice(0,4)});assert.equal(short.controller.generate().length,4);assert.equal(count(short),4);assert.match(short.host.innerHTML,/Only 4 qualifying.*no filler/);assert.match(short.host.innerHTML,/data-td-parlay-add disabled/);assert.equal(short.controller.add(),false);
short.input('tdParlayCombined','+500');assert.doesNotMatch(short.result.innerHTML,/returns \$/,'an incomplete fixed-five draft cannot show a five-leg payout');short.controller.destroy();

for(const change of ['source','kickoff','ranking','score','removed']){
 const changed=mount();changed.controller.generate();changed.input('tdParlayCombined','+500');
 if(change==='source')changed.state.signature='source-2';
 if(change==='kickoff')changed.setTime(now+3600000);
 if(change==='ranking')changed.state.candidates=[...changed.state.candidates,candidate('new-best',100,'CD')];
 if(change==='score')changed.state.candidates=changed.state.candidates.map(c=>c.p.player_id==='a'?{...c,researchScore:100,score:100}:c);
 if(change==='removed')changed.state.candidates=changed.state.candidates.filter(c=>c.p.player_id!=='a');
 assert.equal(changed.controller.add(),false,'stale source/ranking/kickoff cannot save: '+change);assert.equal(changed.picks.length,1);
 changed.controller.refresh();assert.doesNotMatch(changed.host.innerHTML+changed.result.innerHTML,/returns \$60\.00/,'old ticket price is withdrawn after '+change);
 changed.controller.destroy();
}
const malicious=mount({candidates:[...candidates().slice(0,4),candidate('unsafe',100,'CD',{player:'Unsafe <img src=x onerror=alert(1)>'})]});malicious.controller.generate();assert(malicious.host.innerHTML.includes('&lt;img'));assert(!malicious.host.innerHTML.includes('<img'));malicious.controller.destroy();

const browser={PropShopNFLParlay:require('./nfl_parlay.js'),CookItUpPricing:require('./market_odds.js')};
vm.runInNewContext(fs.readFileSync('nfl_anytime_parlay_ui.js','utf8'),browser);assert.equal(typeof browser.PropShopNFLAnytimeParlayUI.create,'function');
console.log('NFL anytime TD UI: fixed board top five, pending-yardage independence, honest book payout, exact saved legs, input persistence and source/ranking/kickoff guards PASS');
