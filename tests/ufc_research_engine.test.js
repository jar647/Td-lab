'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {evaluate} = require('../ufc_research_engine.js');

const a = {slpm:5.2,sapm:3.1,strAcc:49,strDef:61,tdAvg:2.4,tdAcc:42,tdDef:74,subAvg:0.8};
const b = {slpm:3.7,sapm:4.0,strAcc:43,strDef:55,tdAvg:1.2,tdAcc:35,tdDef:62,subAvg:0.3};

test('never recommends a bet from an uncalibrated model',()=>{
  const r=evaluate(a,b,{seed:17,draws:1000});
  assert.equal(r.status,'experimental');
  assert.equal(r.recommendation,'PASS_UNVALIDATED');
  assert.ok(r.probabilities.every(x=>x>=0&&x<=1));
  assert.ok(Math.abs(r.probabilities[0]+r.probabilities[1]-1)<1e-12);
  assert.match(r.reason,/uncalibrated/i);
});
test('missing or malformed inputs do not yield predictions',()=>{
  for(const value of [null,undefined,'',NaN,Infinity]) {
    const r=evaluate({...a,slpm:value},b);
    assert.equal(r.status,'insufficient_data');
    assert.equal(r.probabilities,undefined);
  }
});
test('impossible negative rates and percentages fail closed',()=>{
  for(const [key,value] of [['slpm',-1],['tdAvg',-1],['strAcc',101],['tdDef',-1]]) {
    const r=evaluate({...a,[key]:value},b);
    assert.equal(r.status,'invalid_data');
    assert.equal(r.probabilities,undefined);
  }
});
test('fixed seed and draw count produce reproducible simulations',()=>{
  const first=evaluate(a,b,{seed:712,draws:1200});
  const second=evaluate(a,b,{seed:712,draws:1200});
  assert.deepEqual(first,second);
});
test('swapping fighters reverses model probability and score',()=>{
  const ab=evaluate(a,b,{draws:1000}),ba=evaluate(b,a,{draws:1000});
  assert.ok(Math.abs(ab.modelProbability+ba.modelProbability-1)<1e-12);
  assert.ok(Math.abs(ab.score+ba.score)<1e-12);
});
test('Monte Carlo interval is sampling uncertainty, not calibration',()=>{
  const r=evaluate(a,b,{draws:2000});
  assert.ok(r.simulationInterval[0]<=r.probabilities[0]);
  assert.ok(r.simulationInterval[1]>=r.probabilities[0]);
  assert.match(r.reason,/sampling error only/i);
});
