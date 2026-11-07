const assert = require('node:assert/strict');
const {describe,normalize} = require('./ufc_matchup_research.js');
const base = {slpm:4.2,sapm:3.1,strAcc:48,strDef:55,tdAvg:1.8,tdAcc:42,tdDef:72,subAvg:0.4};
const names = ['Alpha','Bravo'];
const equal = describe(base,base,{names});
assert.equal(equal.status,'balanced');
assert.equal(equal.leanSide,null);
assert.equal(equal.modelProbability,0.5);
assert.ok(equal.areas.every(x=>x.side===null));
const strong = {...base,slpm:6.5,sapm:4.5,strAcc:55,strDef:45};
const tradeoff = describe(strong,base,{names});
assert.equal(tradeoff.status,'experimental');
assert.equal(tradeoff.leanSide,0);
assert.equal(tradeoff.areas.find(x=>x.title==='Striking attack').side,0);
assert.equal(tradeoff.areas.find(x=>x.title==='Defense and damage absorbed').side,1);
assert.equal(tradeoff.counterargument.side,1);
assert.match(tradeoff.counterargument.summary,/4.5 significant strikes absorbed\/min/);
assert.match(tradeoff.areas.find(x=>x.title==='Takedown matchup').summary,/takedowns\/15 min/);
assert.ok(tradeoff.paths.every(x=>x.summary.includes('inference')));
const mirrored = describe(base,strong,{names:['Bravo','Alpha']});
assert.equal(mirrored.leanSide,1);
assert.ok(Math.abs(mirrored.modelProbability-(1-tradeoff.modelProbability))<1e-12);
assert.equal(mirrored.counterargument.side,0);
// Prices cannot enter the independent description, even if supplied in options.
assert.deepEqual(describe(strong,base,{names,odds:[-1000,900]}),describe(strong,base,{names,odds:[900,-1000]}));
// A missing metric on one side leaves valid comparisons visible, with no forced winner.
const partial = describe(base,{...base,subAvg:null},{names});
assert.equal(partial.status,'incomplete');assert.equal(partial.leanSide,null);
assert.deepEqual(partial.missing,[[],['Submission attempts per 15 minutes']]);
assert.equal(partial.areas.find(x=>x.title==='Striking attack').complete,true);
assert.equal(partial.areas.find(x=>x.title==='Submission activity').complete,false);
assert.match(partial.areas.find(x=>x.title==='Submission activity').summary,/Alpha: 0.4 submission attempts\/15 min/);
for(const value of [true,false,' ',[],{},NaN,Infinity,-1]){
 const result = describe({...base,slpm:value},base,{names});
 assert.equal(result.status,'incomplete');
 assert.ok(result.missing[0].includes('Significant strikes landed per minute'));
}
assert.equal(describe({...base,strDef:101},base).status,'incomplete');
const zero = {...base,tdAvg:0,tdAcc:0,subAvg:0};
assert.equal(describe(zero,zero).status,'balanced');
assert.equal(normalize({tdAvg:0}).tdAvg,0);
assert.match(describe(zero,zero).areas.find(x=>x.title==='Submission activity').summary,/0 submission attempts\/15 min/);
const noData = describe({},base,{names});
assert.equal(noData.missing[0].length,8);assert.equal(noData.missing[1].length,0);
assert.equal(noData.leanSide,null);
assert.ok(noData.areas.every(x=>x.complete===false));
assert.ok(!JSON.stringify(noData).includes('NaN'));
console.log('UFC independent breakdown: odds independence, tradeoffs, partial data, zero rates, mirrored and balanced leans PASS');
