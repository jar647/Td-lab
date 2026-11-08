const test=require('node:test');
const assert=require('node:assert/strict');
const {describe}=require('../ufc_matchup_research.js');
const stats={slpm:4,sapm:3,strAcc:50,strDef:55,tdAvg:2,tdAcc:40,tdDef:65,subAvg:1};
for(const profiles of [undefined,[],[null],[{id:'a'}]]){
 test('missing profile entries never crash or imply sourced opponent records: '+JSON.stringify(profiles),()=>{
  const result=describe(stats,stats,{names:['A','B'],profiles});
  assert.equal(result.opponentQuality.length,2);
  assert.deepEqual(result.opponentQuality.map(x=>x.verified),[0,0]);
  assert.deepEqual(result.recentEvidence.map(x=>x.sample),[0,0]);
  assert.deepEqual(result.finishRoutes,[]);
  assert.equal(result.decision.calibratedProbability,null);
 });
}
