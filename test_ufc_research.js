const assert=require('node:assert/strict');const {evaluate,normalize}=require('./ufc_research_engine.js');
const base={slpm:4.2,sapm:3.1,strAcc:48,strDef:55,tdAvg:1.8,tdAcc:42,tdDef:72,subAvg:0.4};
assert.equal(evaluate({},base).status,'insufficient_data');
assert.equal(evaluate({...base,strAcc:125},base).status,'invalid_data');
const r=evaluate({...base,slpm:5.5},base,{seed:123,draws:10000});
assert.equal(r.status,'experimental');assert.equal(r.recommendation,'PASS_UNVALIDATED');
assert.equal(r.draws,10000);assert.ok(r.simulationInterval[0]<=r.probabilities[0]);assert.ok(r.simulationInterval[1]>=r.probabilities[0]);assert.ok(r.modelProbability>0.5);assert.ok(r.probabilities[0]>0.5);assert.ok(Math.abs(r.probabilities.reduce((a,b)=>a+b,0)-1)<1e-9);
assert.deepEqual(r.probabilities,evaluate({...base,slpm:5.5},base,{seed:123,draws:10000}).probabilities);
assert.equal(evaluate(base,base,{draws:10000}).status,'experimental');
// Preserve the complete-input formula and seeded simulation exactly.
assert.deepEqual({score:r.score,modelProbability:r.modelProbability,features:r.features,probabilities:r.probabilities,simulationInterval:r.simulationInterval},{
 score:0.18719999999999995,modelProbability:0.5466638062791924,
 features:{striking:0.7199999999999998,absorption:0,grappling:0,submissions:0},
 probabilities:[0.5406,0.45940000000000003],simulationInterval:[0.5308323612872711,0.5503676387127289]
});
assert.deepEqual(r.unusedMissing,[]);assert.equal(r.dataQuality.limited,false);
const quantitative=result=>({score:result.score,modelProbability:result.modelProbability,features:result.features,probabilities:result.probabilities,simulationInterval:result.simulationInterval});
const zeroA=Object.freeze({...base,slpm:5.5,tdAvg:0,tdAcc:null,tdDef:null});
const zeroB=Object.freeze({...base,tdAvg:0,tdAcc:null,tdDef:null});
const sparseZero=evaluate(zeroA,zeroB,{seed:123});
assert.equal(sparseZero.status,'experimental');assert.equal(sparseZero.features.grappling,0);
assert.equal(sparseZero.dataQuality.limited,true);
assert.deepEqual(sparseZero.unusedMissing.map(({side,key})=>({side,key})),[
 {side:0,key:'tdAcc'},{side:0,key:'tdDef'},{side:1,key:'tdAcc'},{side:1,key:'tdDef'}
]);
assert.ok(sparseZero.unusedMissing.every(item=>/verified zero takedown rate/.test(item.reason)));
for(const percentages of [[1,99,100,0],[87.4,2.7,1.3,65]]){
 const full=evaluate({...zeroA,tdAcc:percentages[0],tdDef:percentages[1]},{...zeroB,tdAcc:percentages[2],tdDef:percentages[3]},{seed:123});
 assert.deepEqual(quantitative(sparseZero),quantitative(full));
}
// Zero volume is supplied evidence; absent percentages are never fabricated.
assert.equal(zeroA.tdAcc,null);assert.equal(zeroB.tdDef,null);
assert.equal(normalize(zeroA).tdAcc,null);assert.equal(normalize(zeroB).tdDef,null);
// One active takedown offense needs its own accuracy and the other side's defense.
const inactive={...base,tdAvg:0,tdAcc:null};
const active={...base,tdDef:null};
const oneActive=evaluate(inactive,active);
assert.equal(oneActive.status,'experimental');assert.ok(oneActive.features.grappling<0);
assert.deepEqual(oneActive.unusedMissing.map(({side,key})=>({side,key})),[{side:0,key:'tdAcc'},{side:1,key:'tdDef'}]);
assert.deepEqual(quantitative(oneActive),quantitative(evaluate({...inactive,tdAcc:100},{...active,tdDef:1})));
assert.equal(evaluate({...inactive,tdDef:null},active).status,'insufficient_data');
assert.equal(evaluate(inactive,{...active,tdAcc:null}).status,'insufficient_data');
assert.equal(evaluate(active,inactive).status,'experimental');
assert.equal(evaluate({...zeroA,tdAvg:null},zeroB).status,'insufficient_data');
assert.ok(evaluate({...zeroA,tdAvg:null},zeroB).missing.includes('tdAvg'));
// Invalid supplied values must still block evaluation even when their term is zero.
for(const key of ['tdAcc','tdDef']){
 for(const value of [125,-1])assert.equal(evaluate({...zeroA,[key]:value},zeroB).status,'invalid_data');
 for(const value of [true,false,[],{},NaN,Infinity,'unknown'])assert.equal(evaluate({...zeroA,[key]:value},zeroB).status,'insufficient_data');
}
assert.equal(evaluate({...zeroA,tdAvg:-1},zeroB).status,'invalid_data');
assert.equal(evaluate({...zeroA,subAvg:null},zeroB).status,'insufficient_data');
console.log('UFC research engine guardrails, conditional takedown inputs, unchanged probabilities, reproducibility PASS');
