'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const api=require('./nba_game_first.js');
const row={key:'g|p|points',gameId:'g',playerId:'p',market:'points',eligible:true,matchupGames:10,matchupBoost:.12,forecast:20,minutes:32,samples:Array(100).fill(0).map((_,i)=>i<70?22:10)};
test('rank matchup strength separately from line frequency',()=>{
 const c=api.candidate(row);assert.equal(typeof c.matchupQuality,'number');assert.equal(c.lineConfidence,70);assert.equal(c.probability,.7);assert.equal(c.score,c.matchupQuality);assert.ok(c.score>=75);
});
test('only 75+ appears in best single, top three and ticket',()=>{
 const weak={...row,key:'g|weak|points',playerId:'weak',matchupBoost:.01,matchupGames:3,minutes:20,samples:Array(100).fill(0).map((_,i)=>i<51?22:10)};
 const built=api.build([weak,row]);assert.equal(built.minScore,75);assert.equal(built.bestSingle.playerId,'p');assert.ok(built.topThree.every(x=>x.score>=75));assert.ok(built.picks.every(x=>x.score>=75));assert.equal(api.build([weak]).picks.length,0);
});

test('sportsbook line and modeled hit frequency never change matchup rank',()=>{
 const a=api.candidate(row,[],{});
 const b=api.candidate({...row,samples:Array(100).fill(10).map((x,i)=>i<10?22:x)},[],{[row.key]:25.5});
 assert.equal(a.score,b.score);
 assert.equal(a.matchupQuality,b.matchupQuality);
 assert.notEqual(a.probability,b.probability);
});
