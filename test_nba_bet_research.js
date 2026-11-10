'use strict';
const assert=require('node:assert/strict');
const research=require('./nba_bet_research');
const now=Date.parse('2026-11-09T23:00:00.000Z'),tip='2026-11-10T03:00:00.000Z';
const model={sport:'NBA',date:tip,home:'Home & Team',away:'Away',
 baseline:{home:116,away:106},
 possessionModel:{inputTimes:{games:'2026-11-09T22:00:00Z',injuries:'2026-11-09T22:55:00Z',rosters:'2026-11-09T20:00:00Z'},uncertain:[]}};
const result={possession:{model:'nba-possession-audit-v3'},
 simulated:{home:121,away:108,homeWin:.73,awayWin:.27},audit:{passed:true},
 market:{homeSpread:-5.5,total:218.5},
 markets:[{key:'homeATS',price:-110},{key:'awayATS',price:-105},{key:'over',price:-110},{key:'under',price:-110},{key:'homeML',price:-145},{key:'awayML',price:130}]};
const a=research.analyze(result,model,now);
assert.equal(a.status,'SHORTLIST');
assert.equal(a.candidates.length,3);
assert(a.candidates.some(x=>x.key==='homeATS'));
assert(a.candidates.some(x=>x.key==='over'));
assert(a.candidates.some(x=>x.key==='homeML'));
assert(a.candidates.every(x=>x.price>=-200),'No quote below -200');
assert(!a.candidates.some(x=>x.key==='under'),'Never present an under play');
assert(a.candidates.every(x=>x.status.includes('NOT VERIFIED')));
assert.match(research.html(a),/Home &amp; Team/);
assert.match(research.html(a),/NOT VERIFIED/);
assert.match(research.html(a),/percentage points/);

const blank={...result,markets:[],market:{homeSpread:null,total:null}};
assert.equal(research.analyze(blank,model,now).status,'PASS','No odds means no pretend recommendation');
assert.equal(research.analyze({...result,markets:result.markets.map(x=>x.key==='homeATS'?{...x,price:-250}:x)},model,now).candidates.some(x=>x.key==='homeATS'),false,'Reject worse-than--200 odds');
const tight={...result,market:{homeSpread:-14,total:245}};
assert.equal(research.analyze(tight,model,now).status,'PASS','Both models must clear the entered market line by threshold');
assert.equal(research.analyze({...result,market:{homeSpread:-5.5,total:null},markets:result.markets.filter(x=>x.key==='over'||x.key==='under')},model,now).status,'PASS','No spread or total quote, and no ML pair, means PASS');

const unavailable={...model,possessionModel:{...model.possessionModel,uncertain:['Player Questionable']}};
assert.equal(research.analyze(result,unavailable,now).status,'HOLD');
assert.match(research.analyze(result,unavailable,now).reason,/Player Questionable/);
const stale={...model,possessionModel:{...model.possessionModel,inputTimes:{...model.possessionModel.inputTimes,injuries:'2026-11-08T16:00:00Z'}}};
assert.equal(research.analyze(result,stale,now).status,'HOLD');
assert.equal(research.analyze(result,{...model,rotationFallback:{reason:'unsupported'}},now).status,'HOLD');
assert.equal(research.analyze({...result,audit:{passed:false}},model,now).status,'HOLD','Failed simulation audit cannot produce candidates');
assert.equal(research.analyze(result,{...model,date:'2026-11-09T19:00:00Z'},now).status,'HOLD','After-tipoff leans prohibited');
const near=Date.parse(tip)-45*60000;
assert.equal(research.analyze(result,model,near).status,'HOLD','Near tipoff requires 15-minute injury refresh');
const revisedNear={...model,possessionModel:{...model.possessionModel,inputTimes:{...model.possessionModel.inputTimes,games:new Date(near-600000).toISOString(),injuries:new Date(near-300000).toISOString()}}};
assert.equal(research.analyze(result,revisedNear,near).status,'SHORTLIST');
assert.deepEqual(model.baseline,{home:116,away:106},'No inputs are mutated');
assert.equal(research.analyze(result,{...model,sport:'NFL'},now).status,'HOLD','Only NBA proposals');
console.log('NBA bet research shortlist: cross-model consensus, exact entered quotes, injury freshness, no unders/overpriced legs, no fabricated EV PASS');
