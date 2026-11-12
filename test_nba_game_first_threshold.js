'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const api=require('./nba_game_first.js');
const row={key:'g|p|points',gameId:'g',playerId:'p',market:'points',eligible:true,matchupRating:{score:85,factors:[]},matchupGames:10,matchupBoost:.12,forecast:20,minutes:32,samples:Array(100).fill(0).map((_,i)=>i<70?22:10)};
test('rank matchup strength separately from line frequency',()=>{
 const c=api.candidate(row);assert.equal(typeof c.matchupQuality,'number');assert.equal(c.lineConfidence,70);assert.equal(c.probability,.7);assert.equal(c.score,c.matchupQuality);assert.ok(c.score>=85);
});
test('only 85+ appears in best single, top three and ticket',()=>{
 const weak={...row,key:'g|weak|points',playerId:'weak',matchupRating:{score:84.99,factors:[]},matchupBoost:.01,matchupGames:3,minutes:20,samples:Array(100).fill(0).map((_,i)=>i<51?22:10)};
 const built=api.build([weak,row]);assert.equal(built.minScore,85);assert.equal(built.bestSingle.playerId,'p');assert.ok(built.topThree.every(x=>x.score>=85));assert.ok(built.picks.every(x=>x.score>=85));assert.equal(api.build([weak]).picks.length,0);
});

test('sportsbook line and modeled hit frequency never change matchup rank',()=>{
 const a=api.candidate(row,[],{});
 const b=api.candidate({...row,samples:Array(100).fill(10).map((x,i)=>i<10?22:x)},[],{[row.key]:20.5});
 assert.equal(a.score,b.score);
 assert.equal(a.matchupQuality,b.matchupQuality);
 assert.notEqual(a.probability,b.probability);
});
test('minimum cannot be lowered and missing ratings fail closed',()=>{
 for(const side of ['over','under']){
  const signed={...row,side,matchupBoost:side==='under'?-.2:.2};
  for(const score of [75,80,84,84.99,100.01,Infinity,NaN,undefined,null,'85']){
   const invalid={...signed,matchupRating:{side,score,factors:[]}};
   assert.equal(api.candidate(invalid),null,side+' score '+score+' must fail closed');
   const built=api.build([invalid],{minScore:0});assert.equal(built.minScore,85);assert.equal(built.bestSingle,null);assert.equal(built.topThree.length,0);assert.equal(built.picks.length,0);
  }
  assert.equal(api.candidate({...signed,matchupRating:null}),null);
  for(const score of [85,85.01,99,100]){
   const valid={...signed,matchupRating:{side,score,factors:[]}};
   for(const minScore of [undefined,0,75,80,84.99,NaN,Infinity]){
    const built=api.build([valid],{minScore});assert.equal(built.minScore,85);assert.equal(built.bestSingle.score,score);assert.equal(built.picks.length,1);
   }
  }
 }
 assert.equal(api.build([row],{minScore:90}).picks.length,0);
});
test('UNDER requires 85 and negative matchup evidence without borrowing OVER ratings',()=>{
 const under={...row,side:'under',matchupBoost:-.2,matchupRating:{side:'under',score:85,factors:[]}};
 for(const score of [75,80,84.99])assert.equal(api.build([{...under,matchupRating:{side:'under',score,factors:[]}}],{minScore:0}).picks.length,0);
 assert.equal(api.build([under]).bestSingle.side,'under');
 assert.equal(api.candidate({...under,matchupBoost:.2}),null);
 assert.equal(api.candidate({...under,matchupRating:{side:'over',score:99}}),null);
 assert.equal(api.build([{...row,matchupRating:{score:84.99}}]).bestSingle,null);
 const changed=api.candidate({...under,odds:900,impliedProbability:.01},[],{[under.key]:20.5});
 assert.equal(changed.score,85);
});
test('UNDER settlement excludes pushes and mixed tickets count aligned side outcomes',()=>{
 const under={...row,key:'under',playerId:'u',side:'under',matchupBoost:-.2,matchupRating:{side:'under',score:85},samples:[9,10,11,12],forecast:10};
 assert.equal(api.chance(under,10),.25);
 const over={...row,key:'over',playerId:'o',samples:[12,11,10,9],forecast:10};
 const built=api.build([under,over],{lines:{under:10,over:10}});
 assert.equal(built.picks.length,2);assert.equal(built.jointHitRate,.25);
 assert.equal(api.build([under],{lines:{under:.5}}).picks.length,0);
});
