'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('quick_slip.js','utf8');
const baseKey=pick=>[pick.sport,pick.game,pick.player,pick.market,pick.recommendationLine??pick.line??''].join('|').toLowerCase();
function mount(initial=[]){
 let stored=JSON.stringify(initial),writes=0;
 const context={localStorage:{getItem:()=>stored,setItem(_key,value){stored=value;writes++}},setTimeout(){}};
 vm.runInNewContext(source,context);
 return {api:context.CookItUpQuickSlip,rows:()=>JSON.parse(stored),writes:()=>writes};
}
const legacy={sport:'NFL',game:'BUF @ NYJ',player:'James Cook',market:'rushing yards',
 line:80,recommendationLine:80,recommendation:'80+ rushing yards',researchScore:100,
 scenarioRate:.807,capturedAt:'2026-11-14T18:00:00Z',notes:'Original frozen research evidence',
 sampleHits:3,sampleSize:5,inputs:{source:'verified-pbp',generatedAt:'2026-11-14T17:00:00Z'}};
legacy.key=baseKey(legacy);
const original=JSON.parse(JSON.stringify(legacy));
const review={sport:'NFL',game:legacy.game,player:legacy.player,market:legacy.market,line:80,
 recommendationLine:80,side:'over',recommendation:'OVER 80 rushing yards',overOdds:-110,
 scenarioRate:.795,notes:'Book line has a push at exactly 80'};
const view=mount([legacy]);
assert.equal(view.writes(),0,'loading does not migrate, rekey or rewrite saved records');
assert.deepEqual(view.rows(),[original]);
view.api.add(review);
let rows=view.rows();
assert.equal(rows.length,2,'a book OVER 80 must coexist with the original 80+ alternate');
assert.deepEqual(rows[0],original,'adding a different settlement side preserves every original field');
assert.equal(rows[1].side,'over');assert.equal(rows[1].key,baseKey(review)+'|over');
assert.equal(rows[1].overOdds,-110);assert.equal(rows[1].recommendation,'OVER 80 rushing yards');
view.api.add({...review,side:' OVER ',overOdds:-115});
rows=view.rows();assert.equal(rows.length,2,'the same normalized OVER side updates instead of duplicating');
assert.equal(rows[1].overOdds,-115);assert.deepEqual(rows[0],original);
view.api.add({...legacy,key:undefined,side:'at_least',notes:'Explicitly re-added alternate'});
rows=view.rows();assert.equal(rows.length,2,'explicit at_least matches the old side-less integer alternate');
assert.equal(rows[0].key,legacy.key+'|at_least');assert.equal(rows[0].side,'at_least');
assert.equal(rows[0].notes,'Explicitly re-added alternate');assert.deepEqual(rows[0].inputs,original.inputs);
assert.equal(rows[0].capturedAt,original.capturedAt);assert.equal(rows[0].scenarioRate,original.scenarioRate);
assert.equal(rows[1].overOdds,-115,'re-adding an alternate never changes the separate quoted OVER');
const reloaded=mount(rows);assert.equal(reloaded.writes(),0);assert.deepEqual(reloaded.rows(),rows);
reloaded.api.add({...review,overOdds:+120});assert.equal(reloaded.rows().length,2);
assert.equal(reloaded.rows()[1].overOdds,120);

for(const [label,expected]of [['Over 80 rushing yards','over'],['UNDER 80 rushing yards','under'],['80+ rushing yards','at_least']]){
 const saved={...original,recommendation:label};
 const slip=mount([saved]);
 slip.api.add({...review,side:expected});
 assert.equal(slip.rows().length,1,'legacy recommendation text retains its '+expected+' settlement meaning');
 assert.equal(slip.rows()[0].key,legacy.key+'|'+expected);
}
const legacyUnder=mount([{...original,recommendation:'UNDER 80 rushing yards'}]);
legacyUnder.api.add(review);assert.equal(legacyUnder.rows().length,2,'a legacy UNDER never becomes a new OVER');
assert.equal(legacyUnder.rows()[0].recommendation,'UNDER 80 rushing yards');
const decimal={...legacy,line:79.5,recommendationLine:79.5,recommendation:undefined};decimal.key=baseKey(decimal);
const decimalSlip=mount([decimal]);decimalSlip.api.add({...decimal,key:undefined,side:'over'});
assert.equal(decimalSlip.rows().length,1,'legacy fractional default already means OVER');
assert.equal(decimalSlip.rows()[0].key,baseKey(decimal)+'|over');
const winner={sport:'NFL',game:'BUF @ NYJ',player:'James Cook',market:'Anytime touchdown',line:null};winner.key=baseKey(winner);
const td=mount([winner]);td.api.add({...winner,key:undefined,side:'winner'});
assert.equal(td.rows().length,1);assert.equal(td.rows()[0].key,baseKey(winner)+'|winner');
const fresh=mount();fresh.api.add({...legacy,key:undefined,recommendation:undefined,side:undefined});
assert.equal(fresh.rows()[0].key,legacy.key+'|at_least');assert.equal(Object.hasOwn(fresh.rows()[0],'side'),false,'inference does not add a side field to legacy-shaped inputs');
fresh.api.add({...legacy,key:undefined,side:'AT-LEAST'});assert.equal(fresh.rows().length,1,'at-least aliases normalize consistently');

for(const sport of ['NBA','UFC']){
 const other={sport,game:'Away @ Home',player:'Unchanged Player',market:'Market',line:80,side:'over'};
 const slip=mount();slip.api.add(other);assert.equal(slip.rows()[0].key,baseKey(other),sport+' keys retain their existing format');
 slip.api.add({...other,side:'under'});assert.equal(slip.rows().length,1,sport+' deduplication behavior is unchanged');
}
console.log('NFL Quick Slip side-aware keys: exact OVER and at_least coexist; legacy semantics, saved fields, reload and non-NFL behavior preserved PASS');
