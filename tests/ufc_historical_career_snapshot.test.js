const test=require('node:test');
const assert=require('node:assert/strict');
const {describe}=require('../ufc_matchup_research.js');
const strong={slpm:8,sapm:1,strAcc:80,strDef:80,tdAvg:5,tdAcc:80,tdDef:80,subAvg:3};
const weak={slpm:1,sapm:7,strAcc:20,strDef:20,tdAvg:0,tdAcc:20,tdDef:20,subAvg:0};
const asOf='2026-06-01T00:00:00Z';
const profiles=(a,b)=>[{id:'1',fetched_at:a},{id:'2',fetched_at:b}];
test('future fighter career snapshots are excluded from historical analysis',()=>{
 const r=describe(strong,weak,{asOf,profiles:profiles('2026-07-01T00:00:00Z','2026-05-01T00:00:00Z')});
 assert.equal(r.missing[0].length,8);
 assert.equal(r.missing[1].length,0);
 assert.equal(r.areas.filter(x=>x.complete).length,0);
 assert.ok(r.cautions.some(x=>x.includes('future-data leakage')));
});
test('both valid earlier snapshots retain complete comparisons',()=>{
 const r=describe(strong,weak,{asOf,profiles:profiles('2026-05-01T00:00:00Z','2026-05-02T00:00:00Z')});
 assert.equal(r.areas.filter(x=>x.complete).length,4);
 assert.equal(r.decision.fighter,'Fighter 1');
});
test('unknown snapshot provenance is excluded for historical picks',()=>{
 const r=describe(strong,weak,{asOf,profiles:[{id:'1'},{id:'2'}]});
 assert.equal(r.areas.filter(x=>x.complete).length,0);
 assert.equal(r.decision.status,'NO_DATA_LEAN');
});
test('live analysis without historical cutoff retains supplied career rates',()=>{
 const r=describe(strong,weak,{profiles:profiles('2026-07-01T00:00:00Z','2026-07-01T00:00:00Z')});
 assert.equal(r.areas.filter(x=>x.complete).length,4);
});
test('snapshot at fight start is not pre-fight evidence',()=>{
 const r=describe(strong,weak,{asOf,profiles:profiles(asOf,asOf)});
 assert.equal(r.areas.filter(x=>x.complete).length,0);
});
