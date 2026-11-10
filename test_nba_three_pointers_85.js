'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const matchup=require('./nba_matchup_discovery.js'),gameFirst=require('./nba_game_first.js');
test('3PM requires 85 for either side, other OVER stays 75',()=>{
 assert.ok(matchup.markets.includes('threes'));
 assert.equal(matchup.minimumScore('over','threes'),85);
 assert.equal(matchup.minimumScore('under','threes'),85);
 assert.equal(matchup.minimumScore('over','points'),75);
 for(const side of ['over','under'])for(const score of [0,74,75,84])assert.equal(matchup.qualifies({side,market:'threes',researchScore:score}),false);
 assert.equal(matchup.qualifies({side:'over',market:'threes',researchScore:85}),true);
});
test('3PM must come from recorded stats',()=>{
 const player=stats=>({stats:{MIN:'32:00',PTS:21,REB:6,AST:4,...stats}});
 assert.equal(matchup.recorded(player({'3PT':'4-9'})).threes,4);
 assert.equal(matchup.recorded(player({'3PM':3})).threes,3);
 assert.equal(matchup.recorded(player({})),null);
 assert.equal(matchup.recorded(player({'3PT':'unknown'})),null);
});
test('game-first 3PM rating stays 85 regardless of odds',()=>{
 const base={key:'g|p|threes',gameId:'g',playerId:'p',market:'threes',side:'over',eligible:true,matchupRating:{side:'over',score:85},matchupGames:10,matchupBoost:.15,forecast:3.5,minutes:32,samples:[4,4,4,4,4,4,2,2,2,2]};
 assert.equal(gameFirst.candidate({...base,matchupRating:{side:'over',score:84}}),null);
 const a=gameFirst.candidate(base),b=gameFirst.candidate({...base,odds:2000},[],{[base.key]:2.5});
 assert.equal(a.score,85);assert.equal(b.score,85);
});
