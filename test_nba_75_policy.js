'use strict';
const assert=require('node:assert/strict');
const lines=require('./nba_prop_lines'),gf=require('./nba_game_first'),auto=require('./nba_auto_alt_ui');
const parlay=require('./nba_parlay'),ledger=require('./recommendation_ledger'),validation=require('./nba_prop_validation');
const now=Date.parse('2026-11-20T12:00:00Z'),stamp=new Date(now).toISOString(),tip='2026-11-21T01:00:00Z';
const markets=['points','rebounds','assists','threes','steals','blocks','stocks','pr','pa','ra','pra'];
function row(market='points',score=80,side='over'){
 return {key:'g|p|'+market+'|'+side,playerId:'p',name:'Player',gameId:'g',
 game:{id:'g',home:'B',away:'A',date:tip,status:'STATUS_SCHEDULED'},team:'A',opponent:'B',market,side,
 score,matchupRating:{score,side,factors:[]},eligible:true,forecast:20,matchupBoost:.1,matchupGames:8,
 line:market==='threes'?2.5:19.5,
 samples:Array.from({length:1000},(_,i)=>i<700?(market==='threes'?4:20):0),
 inputTimes:{games:stamp,rosters:stamp,injuries:stamp},outcomeSetId:'batch',
 roleEvidence:{playerId:'p',team:'A',eligible:true,roleStatus:'SUPPORTED',status:'ACTIVE',
 projectedMinutes:32,minutesLow:31,minutesHigh:33,historyGames:8,holdReasons:[]}};
}
for(const market of [...markets,'Points + Assists','PRA','Steals + Blocks']){
 for(const side of ['over','under']){
  assert.equal(lines.minimumScore(market,side),80,market+' '+side+' minimum must be 80');
  assert(lines.qualifiesScore(80,market,side));
  assert(!lines.qualifiesScore(79.99,market,side));
 }
 assert(lines.canonical(market),'Unsupported required player prop '+market);
 assert(gf.candidate(row(market,80)),'A supported 80+ OVER is eligible '+market);
 assert(gf.candidate(row(market,80,'under')),'A supported 80+ UNDER is eligible '+market);
 assert.equal(gf.candidate(row(market,79.99)),null);
 assert.equal(gf.candidate(row(market,79.99,'under')),null);
}
assert.equal(auto.shortlist([row('steals',80,'under')]).length,1);
assert.equal(auto.shortlist([row('blocks',79.99)]).length,0);
assert.equal(parlay.evaluateResearch([row('points',80)],{now}).available,true);
assert.equal(parlay.evaluateResearch([row('points',80,'under')],{now}).available,true);
assert.equal(parlay.evaluateResearch([row('threes',79.99)],{now}).available,false);
assert.equal(parlay.evaluateResearch([row('threes',80)],{now}).available,true);
const over={sport:'NBA',board:'Game-first recommendations',gameId:'g',playerId:'p',player:'Player',
 market:'points',side:'over',line:19.5,score:80,modelVersion:'unified80',label:'Player OVER 19.5',startsAt:tip,
 inputs:{recommendationMinimum:80,recommendationScope:'game-first-visible'}};
const original=ledger.capture(null,[over],now).ledger;
assert.equal(validation.analyze(original.picks,{now}).counts.eligibleProps,1);
assert(validation.analyze(original.picks,{now}).groups[0].bands.some(b=>b.band==='80–84'));
assert.equal(validation.analyze(original.picks.map(p=>({...p,score:79.99})),{now}).counts.eligibleProps,0);
const frozen=JSON.stringify(original.picks[0]),captured=ledger.capture(original,[{...over,score:95}],now+1000);
assert.equal(captured.ledger.picks[0].score,80);
assert.equal(JSON.stringify(captured.ledger.picks[0]),frozen,'Frozen default recommendation does not change');
const under={...over,market:'stocks',side:'under',line:2.5,label:'Player UNDER 2.5 stocks',score:80,playerId:'another'};
assert.equal(ledger.capture(original,[under],now+1000).added,1,'Track the exact recommended UNDER for defensive stocks');
assert.equal(require('./nfl_goal1').MIN_SCORE,60,'NFL requirements must not change');
console.log('NBA eleven stat markets, universal 80/100 OVER + UNDER, frozen lines and unchanged NFL 60 PASS');
