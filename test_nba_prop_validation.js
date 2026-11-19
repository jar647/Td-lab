'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const validation=require('./nba_prop_validation'),results=require('./results'),ledger=require('./recommendation_ledger');
const CLOCK=Date.parse('2026-11-18T23:00:00Z'),options={now:CLOCK,resamples:300,seed:647};
function pick(id,extra={}){
 return {id:'pick-'+id,sport:'NBA',board:'Best Props',modelVersion:'model-v1',market:'points',side:'at_least',line:20,score:88,
  playerId:'p-'+id,player:'Player '+id,gameId:'g-'+id,day:'2026-11-01',capturedAt:'2026-11-01T12:00:00Z',startsAt:'2026-11-01T20:00:00Z',
  label:'Player '+id+' 20+ points',outcome:{status:'win',actual:24},inputs:{selectionEvidence:{
   role:{projectedMinutes:34,minutesLow:32,minutesHigh:36,historyGames:10},
   line:{policy:'balanced-v1',sampleKind:'role_adjusted_history',frequency:.75,milestone:20,strictOverLine:19.5}}},...extra};
}
const separated=[pick('a'),pick('b',{market:'assists'}),pick('c',{modelVersion:'model-v2'}),pick('d',{side:'under'}),pick('e',{board:'Game-first recommendations'}),
 pick('f',{inputs:{selectionEvidence:{line:{policy:'balanced-v2',sampleKind:'simulation'}}}}),pick('old',{inputs:{}}),
 pick('nfl',{sport:'NFL'}),pick('basket',{market:'first_basket',score:null}),pick('old-score',{score:82})];
const original=JSON.stringify(separated),separate=validation.analyze(separated,options);
assert.equal(separate.groups.length,7);assert.equal(separate.counts.eligibleProps,7);assert.equal(separate.counts.outOfScope,2);
assert.equal(separate.groups.find(g=>g.linePolicy==='UNKNOWN').strata[0].roleRange,'UNKNOWN');
assert(separate.groups.every(g=>g.bands.map(b=>b.band).join(',')==='85–89,90–94,95–100'));
assert.equal(JSON.stringify(separated),original,'Reports must never rewrite captured predictions or fill missing metadata');

const states=['win','loss','pending','live','void','push','awaiting_result'];
const mixed=validation.analyze(states.map((status,i)=>pick('state-'+i,{outcome:{status}})),options).groups[0];
assert.equal(mixed.tracked,7);assert.equal(mixed.settled,2);assert.equal(mixed.wins,1);assert.equal(mixed.hitRate,.5);
assert.equal(mixed.games,2);assert.equal(mixed.playerGames,2);assert.equal(mixed.pending,2);assert.equal(mixed.voids,1);assert.equal(mixed.pushes,1);
assert(mixed.strata.every(s=>s.scoreTest.status==='INSUFFICIENT_EVIDENCE'));

const related=Array.from({length:10},(_,i)=>pick('related-'+i,{gameId:i<5?'game-win':'game-loss',outcome:{status:i<5?'win':'loss'}}));
const uncertainty=validation.clusterInterval(related,options);
assert.deepEqual(uncertainty.interval,[0,1],'Whole-game sampling must preserve all-win/all-loss game clusters');
assert.equal(uncertainty.clusters,2);assert.deepEqual(uncertainty,validation.clusterInterval(related,options));
const duplicates=validation.analyze([...related,...Array.from({length:50},()=>({...related[0]}))],options);
assert.equal(duplicates.counts.eligibleProps,10);assert.equal(duplicates.counts.duplicates,50);
assert.equal(duplicates.groups[0].playerGames,10);assert.equal(duplicates.groups[0].games,2);
assert.deepEqual(duplicates.groups[0].clusterUncertainty.interval,uncertainty.interval);
const conflict=validation.analyze([pick('conflict'),pick('conflict',{line:30})],options);
assert.equal(conflict.counts.conflictingIdentities,1);assert.equal(conflict.groups.length,0,'Conflicting versions of one frozen identity cannot be arbitrary extra trials');
for(const field of ['projectedMinutes','minutesLow','minutesHigh','historyGames']){
 const first=pick('role-conflict'),second=structuredClone(first);second.inputs.selectionEvidence.role[field]+=.5;
 const report=validation.analyze([first,second],options);
 assert.equal(report.counts.conflictingIdentities,1,'Conflicting frozen '+field+' cannot be chosen arbitrarily');assert.equal(report.groups.length,0);
}
const firstEvidence=pick('evidence-conflict'),secondEvidence=structuredClone(firstEvidence);secondEvidence.inputs.selectionEvidence.line.frequency=.8;
assert.equal(validation.analyze([firstEvidence,secondEvidence],options).counts.conflictingIdentities,1,'Different captured frequencies cannot silently retain the first copy');
const reorderedEvidence=structuredClone(firstEvidence);reorderedEvidence.inputs.selectionEvidence.line={strictOverLine:19.5,milestone:20,frequency:.75,sampleKind:'role_adjusted_history',policy:'balanced-v1'};
assert.equal(validation.analyze([firstEvidence,reorderedEvidence],options).counts.conflictingIdentities,0,'Property order is not a conflicting frozen input');
assert.equal(validation.clusterInterval(related.slice(0,5),options).interval,null,'A single game cannot establish precision');
assert.equal(validation.clusterInterval([pick('w1'),pick('w2')],options).interval,null,'No-loss samples cannot claim a 100–100% uncertainty interval');

const matched=[];
for(let i=0;i<40;i++){
 const day='2026-11-'+String(1+i%12).padStart(2,'0'),common={gameId:'matched-'+i,day,capturedAt:day+'T12:00:00Z',startsAt:day+'T20:00:00Z'};
 matched.push(pick('low-'+i,{...common,score:88,outcome:{status:i%2?'loss':'win'}}));
 matched.push(pick('high-'+i,{...common,score:i%2?92:97,outcome:{status:i%4?'win':'loss'}}));
}
const supported=validation.analyze(matched,options).groups[0];
assert.equal(supported.strata.length,1);assert.equal(supported.strata[0].scoreTest.status,'DESCRIPTIVE_COMPARISON_ONLY');
assert.equal(supported.strata[0].scoreTest.low.settled,40);assert.equal(supported.strata[0].scoreTest.high.settled,40);
assert.equal(supported.strata[0].scoreTest.difference,.25);assert(supported.strata[0].scoreTest.differenceInterval);
assert.equal(supported.strata[0].scoreTest.clusters,40);
assert(!JSON.stringify(supported).includes('VALIDATED'),'A descriptive comparison must never become an automatic validation claim');
const unmatched=validation.analyze(matched.map(p=>p.score>=90?{...p,line:35}:p),options).groups[0];
assert.equal(unmatched.strata.length,2);assert(unmatched.strata.every(s=>s.scoreTest.status==='INSUFFICIENT_EVIDENCE'),
 'Different captured line ranges must not be pooled into a score-effectiveness claim');
const missing=validation.analyze(matched.map(p=>({...p,inputs:{}})),options).groups[0];
assert.equal(missing.strata[0].scoreTest.status,'INSUFFICIENT_METADATA');assert.equal(missing.metadataComplete,0);
const wrongLine=validation.analyze(matched.map(p=>({...p,inputs:{selectionEvidence:{...p.inputs.selectionEvidence,line:{...p.inputs.selectionEvidence.line,milestone:40}}}})),options).groups[0];
assert.equal(wrongLine.strata[0].scoreTest.status,'INSUFFICIENT_METADATA','Line evidence must describe the exact frozen recommendation');
for(const frequency of [undefined,NaN,-.01,1.01]){
 const withoutFrequency=matched.map(p=>({...p,inputs:{selectionEvidence:{...p.inputs.selectionEvidence,line:{...p.inputs.selectionEvidence.line,frequency}}}}));
 assert.equal(validation.analyze(withoutFrequency,options).groups[0].strata[0].scoreTest.status,'INSUFFICIENT_METADATA','Valid captured frequency is required; it is never inferred after results');
}
const oneHighGame=matched.map(p=>p.score>=90?{...p,gameId:'one-high-game',day:'2026-11-01',capturedAt:'2026-11-01T12:00:00Z',startsAt:'2026-11-01T20:00:00Z'}:p);
const borrowedCoverage=validation.analyze(oneHighGame,options).groups[0].strata[0].scoreTest;
assert.equal(borrowedCoverage.status,'INSUFFICIENT_EVIDENCE','A score range cannot borrow independent game/date coverage from the other range');
assert.equal(borrowedCoverage.high.games,1);assert.equal(borrowedCoverage.differenceInterval,null);
const sameBandOnly=validation.analyze(matched.map(p=>({...p,score:88})),options).groups[0];
assert.equal(sameBandOnly.strata[0].scoreTest.status,'INSUFFICIENT_EVIDENCE');

const future=validation.analyze([pick('pending-future',{startsAt:'2026-12-01T20:00:00Z',outcome:{status:'pending'}}),
 pick('fake-future-result',{startsAt:'2026-12-01T20:00:00Z'}),pick('captured-future',{capturedAt:'2026-12-01T12:00:00Z',startsAt:'2026-12-01T20:00:00Z'})],options);
assert.equal(future.counts.eligibleProps,1);assert.equal(future.counts.malformed,2);assert.equal(future.groups[0].settled,0);
const revised=matched.map(p=>({...p,revisions:[{at:'2026-11-15',score:100,line:1,label:'Later changed winner'}]}));
assert.deepEqual(validation.analyze(revised,options),validation.analyze(matched,options),'Later revisions are not substituted or counted as extra trials');
const repriced=matched.map(p=>({...p,americanOdds:500,probability:.999,priceObservedAt:'2026-11-01T10:00:00Z'}));
assert.deepEqual(validation.analyze(repriced,options),validation.analyze(matched,options),'Prices and simulated estimates do not affect observed score validation');

const hostile=pick('hostile',{board:'<img src=x onerror=evil()>',modelVersion:'<script>bad</script>',inputs:{selectionEvidence:{line:{policy:'<svg onload=bad()>'}}}});
const rendered=results.nbaValidation([hostile]);
assert(!rendered.includes('<img src=x'));assert(!rendered.includes('<script>bad'));assert(rendered.includes('&lt;svg onload=bad()&gt;'));
assert(rendered.includes('UNKNOWN'));assert(rendered.includes('game-cluster interval'));assert(!rendered.includes('95% win probability'));
const raw=JSON.stringify(matched);results.nbaValidation(matched);assert.equal(JSON.stringify(matched),raw);
assert(results.csv([pick('csv')]).includes('"model-v1"'),'Existing export remains available');
const pooled=ledger.summarize({picks:matched},CLOCK).groups;
const nbaSummary=results.scores(pooled);
assert(nbaSummary.includes('NBA prop selection validation'));assert(!nbaSummary.includes('Wilson'),'NBA comparisons must not also display independent pick intervals from the older pooled widget');
const nflGroups=ledger.summarize({picks:matched.map(p=>({...p,sport:'NFL'}))},CLOCK).groups;
assert(results.scores(nflGroups).includes('Wilson'),'NFL score rendering remains unchanged');
const ufcGroups=ledger.summarize({picks:matched.map(p=>({...p,sport:'UFC'}))},CLOCK).groups;
assert(results.scores(ufcGroups).includes('Wilson'),'UFC score rendering remains unchanged');

const page=fs.readFileSync('results.html','utf8'),controller=fs.readFileSync('results.js','utf8');
assert(page.indexOf('nba_prop_validation.js')<page.indexOf('results.js'));
assert.match(page,/id="nba-prop-validation-panel" hidden/);
assert(page.includes('results.js?v=issue130-v1'));
const elements=new Map();
function el(id){
 if(!elements.has(id)){
  let html='';const node={value:['sport','date','board','outcome'].includes(id)?'ALL':'',hidden:false,disabled:false,textContent:'',options:[],classList:{toggle(){}},addEventListener(){}};
  Object.defineProperty(node,'innerHTML',{get(){return html},set(value){html=value;node.options=[...value.matchAll(/<option(?: value="([^"]*)")?[^>]*>([^<]*)<\/option>/g)].map(m=>({value:m[1]??m[2]}));}});
  elements.set(id,node);
 }
 return elements.get(id);
}
const todayPicks=[pick('today-win',{day:'2026-11-18',capturedAt:'2026-11-18T12:00:00Z',startsAt:'2026-11-18T20:00:00Z'}),
 pick('today-loss',{day:'2026-11-18',capturedAt:'2026-11-18T12:00:00Z',startsAt:'2026-11-18T20:00:00Z',outcome:{status:'loss'}}),
 pick('today-nfl',{sport:'NFL',board:'NFL top plays',day:'2026-11-18',capturedAt:'2026-11-18T12:00:00Z',startsAt:'2026-11-18T20:00:00Z'}),
 pick('today-ufc',{sport:'UFC',board:'UFC picks',day:'2026-11-18',capturedAt:'2026-11-18T12:00:00Z',startsAt:'2026-11-18T20:00:00Z'})];
const originalTodayPicks=JSON.stringify(todayPicks);
class FixedDate extends Date{constructor(...args){super(...(args.length?args:[CLOCK]));}static now(){return CLOCK;}}
const sandbox={document:{getElementById:el},location:{search:'?sport=NBA'},URLSearchParams,Intl,Date:FixedDate,console,
 PropShopResults:ledger,PropShopNBAValidation:{analyze:(p,o)=>validation.analyze(p,{...o,now:CLOCK})},
 fetch:async()=>({ok:true,json:async()=>({generatedAt:new Date(CLOCK).toISOString(),startedAt:'2026-11-01T12:00:00Z',picks:todayPicks,dailyCoverage:[],coverage:[],limits:[],method:'Forward-only'})})};
vm.createContext(sandbox);vm.runInContext(controller,sandbox,{timeout:5000});
(async()=>{
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(el('nba-prop-validation-panel').hidden,false);assert(el('nba-prop-validation').innerHTML.includes('1W / 1L'));
 const allNBA=el('nba-prop-validation').innerHTML;el('outcome').value='win';el('outcome').onchange();
 assert.equal(el('nba-prop-validation').innerHTML,allNBA,'Outcome filters cannot manufacture a winning validation sample');
 assert(!el('records').innerHTML.includes('today-loss'));
 el('sport').value='NFL';el('sport').onchange();assert.equal(el('nba-prop-validation-panel').hidden,true);
 assert(el('records').innerHTML.includes('today-nfl'));assert(el('summary').innerHTML.includes('1 – 0'));
 el('sport').value='UFC';el('sport').onchange();assert.equal(el('nba-prop-validation-panel').hidden,true);
 assert(el('records').innerHTML.includes('today-ufc'));assert(el('summary').innerHTML.includes('1 – 0'));
 el('sport').value='NBA';el('board').value='NFL top plays';el('board').onchange();assert.equal(el('nba-prop-validation-panel').hidden,true,'Board filters apply to NBA validation');
 el('board').value='ALL';el('board').onchange();assert.equal(el('nba-prop-validation-panel').hidden,false);
 el('sport').value='NBA';el('date').value='2026-11-01';el('date').onchange();assert.equal(el('nba-prop-validation-panel').hidden,true);
 assert.equal(JSON.stringify(todayPicks),originalTodayPicks,'Dashboard rendering cannot mutate captured results or evidence');
 console.log('NBA prop validation: frozen/model/market/policy isolation, game-cluster uncertainty, matched line/role score checks and NBA-only filtered dashboard PASS');
})().catch(error=>{console.error(error);process.exitCode=1});
