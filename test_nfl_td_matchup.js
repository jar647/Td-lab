/* Run: node test_nfl_td_matchup.js. Role-aware scores are research ratings, not TD probabilities. */
'use strict';
const assert=require('node:assert/strict');
const td=require('./nfl_td_matchup.js');

const runner={player:'Rush-first back',pos:'RB',games:8,playerAppearancesVerified:true,
 tdallowed:1.2,rzallowed:3.5,playerRz:2.5,rzshare:35,goalLine5:.8,snapShare:.85,
 playerAnytimeTDs:1,recent3AnytimeTDs:1,playerTargets:0,playerTargetShare:0,playerRzTargets:0};
assert.equal(td.VERSION,'nfl-td-role-v1');
const high=td.rating(runner);
assert.equal(high.score,100,'a fully supported rush-first RB can earn full credit without receiving volume');
assert.equal(high.performanceScore,100);assert.equal(high.opponentScore,100);
assert.equal(high.productionAvailable,true);
assert.match(high.coverage,/actual rushing\/receiving TD production/);
assert.match(high.method,/Passing TDs do not count/);
assert(!high.factors.some(f=>['playerTargets','playerTargetShare','playerRzTargets','defRecYardsAllowed','defRzTargetsAllowed'].includes(f.key)),
 'rushing roles must not receive receiving-only score factors');

for(const pos of ['RB','QB']){
 const original=td.rating({...runner,pos});
 const receivingNoise=td.rating({...runner,pos,playerTargets:99,playerTargetShare:100,playerRzTargets:20,defRecYardsAllowed:999,defRzTargetsAllowed:99});
 assert.deepEqual(original,receivingNoise,pos+' scores must be independent of receiving-only inputs');
 assert.equal(original.role,'Rushing / offensive TD');
}
for(const pos of ['WR','TE']){
 const low=td.rating({...runner,pos,playerTargetShare:0,playerRzTargets:0});
 const stronger=td.rating({...runner,pos,playerTargetShare:pos==='TE'?22:30,playerRzTargets:1.5});
 assert(stronger.performanceScore>low.performanceScore,'target and red-zone receiving role matter for '+pos);
 assert(stronger.score>low.score);
 assert.equal(stronger.opponentScore,low.opponentScore,'player usage must not alter the opponent component');
 assert.equal(stronger.score,100);
 assert.equal(stronger.role,'Receiving');
 assert(stronger.factors.some(f=>f.key==='playerTargetShare'));
 assert(stronger.factors.some(f=>f.key==='playerRzTargets'));
}

const half={...runner,tdallowed:.6,rzallowed:1.75,playerAnytimeTDs:.5,recent3AnytimeTDs:.5,
 playerRz:1.25,rzshare:17.5,goalLine5:.4,snapShare:.425};
const balanced=td.rating(half);
assert.equal(balanced.performanceScore,50);assert.equal(balanced.opponentScore,50);assert.equal(balanced.score,50);
const strongPlayer=td.rating({...runner,tdallowed:.6,rzallowed:1.75});
assert.equal(strongPlayer.performanceScore,100);assert.equal(strongPlayer.opponentScore,50);assert.equal(strongPlayer.score,75);
const strongOpponent=td.rating({...half,tdallowed:1.2,rzallowed:3.5});
assert.equal(strongOpponent.performanceScore,50);assert.equal(strongOpponent.opponentScore,100);assert.equal(strongOpponent.score,75,
 'player and opponent components each contribute exactly half of the total');
for(const result of [balanced,strongPlayer,strongOpponent,high]){
 assert.equal(result.score,Math.round((result.performanceScore+result.opponentScore)/2));
 assert(Math.abs(result.factors.reduce((sum,f)=>sum+f.points,0)-result.score)<=1,'factor points explain the rating within rounding');
}

const noProduction={...runner};delete noProduction.playerAnytimeTDs;delete noProduction.recent3AnytimeTDs;
const unknown=td.rating(noProduction),observedZero=td.rating({...noProduction,playerAnytimeTDs:0,recent3AnytimeTDs:0});
assert.equal(unknown.productionAvailable,false);assert.match(unknown.coverage,/unavailable/);
assert(!unknown.factors.some(f=>f.key==='playerAnytimeTDs'));
assert.equal(unknown.score,100,'missing optional production is omitted and remaining supported factors renormalized');
assert.equal(observedZero.productionAvailable,true);
assert(observedZero.score<unknown.score,'an observed zero is a real observation, not missing production');
assert.equal(observedZero.factors.find(f=>f.key==='playerAnytimeTDs').value,0);
assert(td.score({...noProduction,playerAnytimeTDs:1,recent3AnytimeTDs:1})>observedZero.score);
const zero={...runner,tdallowed:0,rzallowed:0,playerRz:0,rzshare:0,goalLine5:0,snapShare:0,playerAnytimeTDs:0,recent3AnytimeTDs:0};
assert.equal(td.score(zero),0,'complete verified zero inputs remain a valid zero rating');

for(const key of ['tdallowed','rzallowed','playerRz','rzshare']){
 for(const value of [null,undefined,'',NaN,Infinity,-1,true,[1],{}]){
  assert.equal(td.rating({...runner,[key]:value}),null,'invalid required '+key+' must be unrated: '+String(value));
 }
}
for(const games of [0,1,1.99,null,undefined,NaN,Infinity])assert.equal(td.rating({...runner,games}),null);
assert(td.rating({...runner,games:2}),'two verified appearances satisfy the descriptive TD rating sample requirement');
assert.equal(td.rating({...runner,playerAppearancesVerified:false}),null);
assert.equal(td.rating(null),null);assert.equal(td.rating({...runner,pos:'K'}),null);
assert.equal(td.score({...runner,tdallowed:null}),null);
assert.match(td.label({...runner,tdallowed:null}),/UNRATED/);
assert.match(td.unavailableReason({...runner,games:1}),/two verified/);
assert.match(td.unavailableReason({...runner,playerRz:null}),/missing/);
assert.equal(td.unavailableReason(runner),null);
assert.equal(td.rating({...runner,playerAnytimeTDs:-1}).productionAvailable,false,
 'invalid negative production must not be presented as observed TD production');

for(const [field,low,raised] of [['playerAnytimeTDs',0,.5],['recent3AnytimeTDs',0,.5],['playerRz',0,1],
 ['rzshare',0,15],['goalLine5',0,.4],['snapShare',0,.5],['tdallowed',0,.6],['rzallowed',0,1.75]]){
 assert(td.score({...runner,[field]:raised})>td.score({...runner,[field]:low}),field+' improvement must improve the rating with other inputs fixed');
}
for(const pos of ['QB','RB','WR','TE']){
 const result=td.rating({...runner,pos,tdallowed:100,rzallowed:100,playerAnytimeTDs:100,recent3AnytimeTDs:100,
  playerRz:100,rzshare:100,goalLine5:100,snapShare:100,playerTargetShare:100,playerRzTargets:100});
 for(const key of ['score','performanceScore','opponentScore'])assert(Number.isFinite(result[key])&&result[key]>=0&&result[key]<=100);
}
assert.equal(td.score({...runner,snapShare:85}),td.score({...runner,snapShare:.85}),'fraction and percent snap inputs agree');
assert.equal(td.score({...half,odds:-110,scenarioRate:.99,playerPassTDs:10}),td.score({...half,odds:500,scenarioRate:.01,playerPassTDs:0}),
 'sportsbook prices, simulated hit frequencies, and passing TDs cannot change an anytime-TD score');
const before=JSON.stringify(runner);td.rating(runner);assert.equal(JSON.stringify(runner),before,'rating never mutates sourced inputs');
console.log('NFL TD role scoring, 50/50 components, observed-zero/missing coverage, data gates and score independence passed');
