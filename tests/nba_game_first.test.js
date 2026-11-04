const assert=require('node:assert/strict');
const test=require('node:test');
const engine=require('../nba_game_first.js');
const row=(id,market='rebounds',boost=.12)=>({key:id,playerId:id,name:'Player '+id,market,forecast:10,matchupBoost:boost,matchupGames:8,reason:'Opponent allows more production'});
test('odds-free positive OVER matchup generates a candidate',()=>{const r=engine.candidate(row('1'));assert.equal(r.market,'rebounds');assert.ok(r.probability>0&&r.probability<1)});
test('higher alternate line lowers estimated over frequency',()=>{const r=row('1');assert.ok(engine.chance(r,7.5)>engine.chance(r,11.5))});
test('exclude threes, unders, weak evidence and excluded markets',()=>{assert.equal(engine.candidate(row('1','threes')),null);assert.equal(engine.candidate(row('2','points',-.1)),null);assert.equal(engine.candidate(row('3','assists'),['assists']),null)});
test('allow multiple players from same game but only one market per player',()=>{const r=engine.build([row('1'),row('1','points'),row('2'),row('3'),row('4'),row('5')]);assert.equal(r.picks.length,4);assert.equal(new Set(r.picks.map(x=>x.playerId)).size,4)});
test('no data returns PASS rather than invented picks',()=>{assert.equal(engine.build([]).picks.length,0);assert.equal(engine.chance({forecast:10,matchupGames:0,market:'points'},5.5),null)});
