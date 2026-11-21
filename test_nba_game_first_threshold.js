'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),api=require('./nba_game_first.js');
const row=(id='p',market='rebounds',side='over',score=85,boost=.12)=>({
 key:'g|'+id+'|'+market+'|'+side,gameId:'g',playerId:id,name:'Player '+id,market,side,
 forecast:10,minutes:30,matchupBoost:boost,matchupGames:8,eligible:true,
 matchupRating:{score,side,factors:[]},samples:[4,8,9,10,11,12,13,14],reason:'Observed opponent weakness'
});
test('matchup rating is separate from simulation line frequency',()=>{
 const r=row();const c=api.candidate(r);
 assert.equal(c.score,85);assert.equal(c.matchupQuality,85);assert.equal(c.lineConfidence,Math.round(100*c.probability));
 assert.notEqual(c.score,Math.round(c.probability*100));
});
test('flat 80/100 for all eleven markets on both sides',()=>{
 for(const market of ['points','rebounds','assists','threes','steals','blocks','Steals + Blocks','Points + Rebounds','Points + Assists','Rebounds + Assists','PRA']){
  for(const side of ['over','under']){
   const supported=row(market+'-'+side,market,side,80);
   assert.equal(api.minimumScore(market,side),80);
   assert(api.candidate(supported),market+' '+side+' 80 should qualify');
   for(const bad of [79.99,-1,100.01,NaN,undefined,null,'85']){
    const incorrect={...supported,matchupRating:{...supported.matchupRating,score:bad}};
    assert.equal(api.candidate(incorrect),null,market+' '+side+' '+bad);
    assert.equal(api.build([incorrect],{minScore:0}).bestSingle,null);
   }
  }
 }
});
test('best single, top three and same-game research ticket all use the 80 minimum',()=>{
 const weak=row('weak','rebounds','over',79.99);
 const valid=[row('a'),row('b'),row('c'),row('d'),row('e')];
 const ticket=api.build([weak,...valid]);
 assert.equal(ticket.minScore,80);assert(ticket.picks.length>=1);
 assert(ticket.picks.every(r=>r.score>=80));assert(ticket.topThree.every(r=>r.score>=80));
 assert.equal(api.build([weak]).picks.length,0);
 assert.equal(api.build([row('a')],{minScore:0}).minScore,80);
 assert.equal(api.build([row('a')],{minScore:90}).picks.length,0);
});
test('actual UNDER evidence is required, and supported UNDERs can be recommended',()=>{
 const u=row('under','rebounds','under',85,-.2);
 const candidate=api.candidate(u);
 assert(candidate&&candidate.side==='under');
 assert(api.build([u]).bestSingle?.side==='under');
 assert.equal(api.candidate({...u,matchupRating:{score:100,side:'over'}}),null);
 assert.equal(api.candidate({...u,matchupRating:{score:100}}),null);
 assert.equal(api.candidate({...u,reviewRequired:true}),null);
});
test('OVER and UNDER alternate lines use exact strict directional settlement, including pushes',()=>{
 const under={...row('under','rebounds','under',90,-.2),samples:[9,10,11,12],forecast:10};
 const over={...row('over','rebounds','over',90,.12),samples:[12,11,10,9],forecast:10};
 assert.equal(api.chance(under,10),.25);
 assert.equal(api.chance(over,10),.5);
 const mixed=api.build([under,over],{lines:{[under.key]:10,[over.key]:10}});
 assert.equal(mixed.picks.length,2);
 assert.equal(mixed.jointHitRate,.25);
 assert.equal(api.build([under],{lines:{[under.key]:.5}}).picks.length,0);
});
test('odds and choice of supported line do not change the underlying matchup score',()=>{
 const r=row('player','points','over',85,-.1);
 const a=api.candidate(r),b=api.candidate({...r,samples:[10,10,10,10,20,20,20,20]},[],{[r.key]:12.5});
 assert(a&&b);assert.equal(a.score,b.score);assert.equal(a.matchupBoost,-.1);
 assert.notEqual(a.probability,b.probability);
 assert.equal(api.candidate({...r,matchupBoost:NaN}),null);
});
test('defensive UNDER and 3PM are eligible at 80, invalid draws are not',()=>{
 for(const market of ['threes','steals','blocks','Steals + Blocks']){
  const r={...row('special',market,'under',80,-.1),forecast:3,samples:[0,1,2,3,4,5]};
  assert(api.candidate(r),market+' UNDER rating 80');
  assert.equal(api.candidate(r,[],{[r.key]:2.5}).probability,.5);
  for(const samples of [[],[0,null,3],[0,NaN,3],[0,'3',4]])assert.equal(api.candidate({...r,samples}),null);
 }
});
console.log('NBA uniform 80 OVER/UNDER candidate, alternate lines, defensive markets and shared ticket checks PASS');
