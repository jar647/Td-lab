'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const lines=require('../nba_prop_lines');
const shadow=require('../nba_under_shadow');
const gameFirst=require('../nba_game_first');
const start=Date.parse('2026-11-20T17:00:00Z');
const game={id:'test-game',date:new Date(start+8*3600000).toISOString(),away:'A',home:'B',status:'STATUS_SCHEDULED'};
const role={playerId:'1',team:'A',eligible:true,roleStatus:'SUPPORTED',status:'ACTIVE',historyGames:12,projectedMinutes:31,minutesLow:30,minutesHigh:31,holdReasons:[],
 sampleKind:'role_adjusted_history',selectionSamples:{points:[...Array(8).fill(8),...Array(2).fill(20)],threes:[...Array(9).fill(1),3]}};
function input(market='points'){
 const sim=market==='threes'?[...Array(900).fill(1),...Array(100).fill(3)]:[...Array(800).fill(8),...Array(200).fill(20)];
 const row={key:'test-game|1|'+market,playerId:'1',gameId:'test-game',game,team:'A',opponent:'B',market,side:'over',forecast:market==='threes'?1:8,baseline:market==='threes'?2:12,
  roleEvidence:role,reviewRequired:false,samples:sim,inputTimes:{games:new Date(start).toISOString(),injuries:new Date(start).toISOString(),rosters:new Date(start).toISOString()}};
 const weakness={side:'under',market,team:'B',attacking:'A',position:'PF',games:10,excess:.45};
 return {analysis:{reason:null,rows:[row],underWeaknesses:[weakness]},rosters:{players:{'1':{position:'PF'}}}};
}
test('OVER thresholds unchanged, UNDER thresholds strict, invalid sides fail closed',()=>{
 for(const m of ['points','rebounds','assists','pr','pa','ra','pra']){assert.equal(lines.minimumScore(m),75);assert.equal(lines.minimumScore(m,'under'),85);assert(lines.qualifiesScore(85,m,'under'));assert(!lines.qualifiesScore(84,m,'under'))}
 assert.equal(lines.minimumScore('threes'),85);assert.equal(lines.minimumScore('threes','under'),90);
 assert(!lines.qualifiesScore(89.99,'threes','under'));assert(lines.qualifiesScore(90,'threes','under'));
 assert.equal(lines.minimumScore('points','sideways'),101);
});
test('strict UNDER settlement, fractional thresholds, and tighter line tie-break',()=>{
 const result=lines.evaluateSide([4,5,6,7],5.5,'under');
 assert.deepEqual([result.wins,result.pushes,result.losses],[2,0,2]);
 assert.equal(lines.evaluate([4,5,6,7],5.5).wins,2);
 assert.equal(lines.evaluateSide([4,5,5,6],5,'under').pushes,2);
 const resultUnder=lines.select({market:'points',side:'under',samples:[...Array(8).fill(8),...Array(2).fill(20)]});
 assert.equal(resultUnder.available,true);assert.equal(resultUnder.line,9.5);assert.equal(resultUnder.settlement,'strict_under');assert.equal(resultUnder.side,'under');assert.equal(resultUnder.calibrated,false);
 assert.equal(lines.select({market:'points',side:'under',samples:[1,2,3,4]}).available,false);
});
test('independently supported UNDERS enter shadow only, never live recommendations',()=>{
 const fixture=input(),out=shadow.evaluate(fixture.analysis,fixture.rosters,start);
 assert.equal(out.length,1);const p=out[0];
 assert.equal(p.side,'under');assert(p.score>=85);assert.equal(p.line,9.5);
 assert.equal(p.simulatedFrequency,.8);assert.equal(p.studyOnly,true);assert.equal(p.priceVerified,false);assert.equal(p.probabilityCalibrated,false);
 assert.equal(gameFirst.candidate({...fixture.analysis.rows[0],side:'under'}),null,'UNDER cannot leak into live OVER selection');
 assert.deepEqual(shadow.evaluate({...fixture.analysis,underWeaknesses:[]},fixture.rosters,start),[]);
 assert.deepEqual(shadow.evaluate({...fixture.analysis,rows:[{...fixture.analysis.rows[0],roleEvidence:{...role,roleStatus:'UNVERIFIED'}}]},fixture.rosters,start),[]);
 assert.deepEqual(shadow.evaluate({...fixture.analysis,rows:[{...fixture.analysis.rows[0],forecast:9}]},fixture.rosters,start),[],'Projected line gap must be meaningful');
});
test('90-rated three-point UNDER needs actual suppression and a valid simulation',()=>{
 const x=input('threes'),under=shadow.evaluate(x.analysis,x.rosters,start);
 assert.equal(under.length,1);assert(under[0].score>=90);assert.equal(under[0].line,1.5);
 const lower={...x.analysis,underWeaknesses:[{...x.analysis.underWeaknesses[0],excess:.05}]};
 assert.equal(shadow.evaluate(lower,x.rosters,start).length,0);
});
test('frozen shadow predictions grade official final results and never overwrite their original line',()=>{
 const x=input(),freeze=shadow.update(null,[x],{games:[game]},start);
 assert.equal(freeze.picks.length,1);const p=freeze.picks[0];
 assert(p.frozen);assert.equal(p.result,'pending');assert.equal(p.line,9.5);
 const moved={...x,analysis:{...x.analysis,rows:[{...x.analysis.rows[0],forecast:7}]}};
 const duplicated=shadow.update(freeze,[moved],{games:[game]},start+1000);
 assert.equal(duplicated.picks.length,1);assert.equal(duplicated.picks[0].line,p.line);
 const final={...game,status:'STATUS_FINAL',players:[{id:'1',team:'A',name:'Player',stats:{PTS:'8',REB:'4',AST:'3','3PT':'1-3'}}]};
 const graded=shadow.update(duplicated,[],{games:[final]},Date.parse(game.date)+1000);
 assert.equal(graded.picks[0].result,'win');assert.equal(graded.picks[0].actual,8);assert.equal(graded.summary.graded,1);assert.equal(graded.summary.groups[0].n,1);assert.equal(graded.summary.groups[0].statisticallyReviewed,false);
 const further=shadow.update(graded,[],{games:[final]},Date.parse(game.date)+3600000);assert.deepEqual(further.picks,graded.picks,'Frozen result cannot be changed after grading');
 assert.equal(shadow.recordedMarket({stats:{'3PT':'2-5'}},'threes'),2);
 assert.equal(shadow.recordedMarket({stats:{'3PT':'bad'}},'threes'),null);
});
