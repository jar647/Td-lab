const test=require('node:test');const assert=require('node:assert/strict');const {describe}=require('../ufc_matchup_research.js');
const a={slpm:6,sapm:2,strAcc:60,strDef:70,tdAvg:3,tdAcc:55,tdDef:75,subAvg:2};
const b={slpm:2,sapm:5,strAcc:35,strDef:40,tdAvg:1,tdAcc:25,tdDef:35,subAvg:0};
function profile(id,other){
 return {id,recent_fights:[1,2].map(n=>({bout_id:id+n,event_date:'2026-0'+n+'-01',fighter_a:id,fighter_b:other,winner:id,method_display:'Decision',opponent_record:{wins:5,losses:3},opponent_record_source:'provider'}))};
}
test('still picks a winner without recent and opponent evidence',()=>{
 const d=describe(a,b).decision;
 assert.equal(d.status,'PREDICTED_WINNER');assert.equal(d.fighter,'Fighter 1');assert.equal(d.confidence,'LOW');
});
test('prediction includes both victory and counter routes',()=>{
 const d=describe(a,b,{names:['A','B'],profiles:[profile('a','x'),profile('b','y')]}).decision;
 assert.equal(d.status,'PREDICTED_WINNER');assert.equal(d.fighter,'A');
 assert.ok(d.primaryRoute);assert.ok(d.counterRoute);assert.equal(d.confidence,'UNVALIDATED');
});

test('total absence of comparative stats still yields transparent deterministic pick',()=>{const d=describe({}, {},{names:['Z','A']}).decision;assert.equal(d.fighter,'A');assert.equal(d.status,'NO_DATA_LEAN');assert.equal(d.confidence,'VERY_LOW');assert.equal(d.calibratedProbability,null);});
