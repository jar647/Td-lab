const test = require('node:test');
const assert = require('node:assert/strict');
const {describe} = require('../ufc_matchup_research.js');
const base = {slpm:4.2,sapm:3.1,strAcc:48,strDef:55,tdAvg:0,tdAcc:null,tdDef:null,subAvg:0.4};
const strong = {...base,slpm:6.5};
const asOf = '2026-06-01T00:00:00Z';
const profiles = [
  {id:'a',stats_as_of:'2026-05-01T00:00:00Z'},
  {id:'b',stats_as_of:'2026-05-02T00:00:00Z'}
];

test('historical zero-rate comparisons use only verified pre-fight snapshots', () => {
  const live = describe(strong,base);
  const earlier = describe(strong,base,{asOf,profiles});
  assert.equal(earlier.modelProbability,live.modelProbability);
  assert.equal(earlier.unusedMissing.length,4);
  assert.equal(earlier.areas.find(x=>x.title==='Takedown matchup').complete,true);
  assert.equal(earlier.dataQuality.limited,true);
  assert.equal(earlier.missing[0].length,2);

  const future = describe(strong,base,{asOf,profiles:[{...profiles[0],stats_as_of:'2026-07-01T00:00:00Z'},profiles[1]]});
  assert.equal(future.status,'incomplete');
  assert.equal(future.modelProbability,null);
  assert.equal(future.leanSide,null);
  assert.equal(future.missing[0].length,8);
  assert.ok(future.areas.every(x=>!x.complete));
  assert.equal(future.unusedMissing.length,2);
  assert.deepEqual(future.unusedMissing.map(({side,key})=>({side,key})),[{side:0,key:'tdDef'},{side:1,key:'tdAcc'}]);
});

test('historical validation retains malformed provided values on admitted snapshots', () => {
  for (const invalid of [true,{},'unknown',101,-1]) {
    const report = describe({...strong,tdAcc:invalid},base,{asOf,profiles});
    assert.equal(report.status,'incomplete');
    assert.equal(report.modelProbability,null);
    assert.equal(report.areas.find(x=>x.title==='Takedown matchup').complete,false);
    assert.ok(report.missing[0].includes('Takedown accuracy'));
    assert.ok(!report.unusedMissing.some(x=>x.side===0&&x.key==='tdAcc'));
  }
});

test('context contract survives conditional zero-rate evaluation', () => {
  const report = describe(strong,base,{asOf,profiles});
  for (const field of ['decision','exploits','recentEvidence','opponentQuality','styleEvidence','contextualFlags','unresolved','finishRoutes']) {
    assert.ok(Object.hasOwn(report,field),field);
  }
});
