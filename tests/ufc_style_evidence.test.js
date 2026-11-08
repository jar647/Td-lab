const test=require('node:test');const assert=require('node:assert/strict');const {describe}=require('../ufc_matchup_research.js');
test('uses verified stance and reach but does not claim a tactical win',()=>{
 const result=describe({}, {},{names:['A','B'],profiles:[{stance:'Southpaw',reach_in:78,height_in:74},{stance:'Orthodox',reach_in:72,height_in:72}]});
 assert.ok(result.styleEvidence.some(x=>x.includes('6-inch listed reach advantage')));
 assert.ok(result.styleEvidence.some(x=>x.includes('Southpaw')));
 assert.equal(result.decision.status,'NO_DATA_LEAN');
});
test('ignores impossible or unverified measurements',()=>{
 const result=describe({}, {},{profiles:[{stance:'Unknown',reach_in:999},{stance:'Orthodox',reach_in:72}]});
 assert.equal(result.styleEvidence.length,0);
});
