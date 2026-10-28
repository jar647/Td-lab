/* Run: node test_nfl_goal1.js */
'use strict';
const assert=require('node:assert/strict');
const app=require('./nfl_goal1.js');
const candidate=(id,score,team='A',key='recYards')=>({
 p:{player_id:id,player:id,team,opp:team==='A'?'B':'A'},
 d:{key,label:'receiving yards'},score,line:40,scenarioRate:.68,risks:[],reasons:['game script']
});
const pool=[candidate('a',95),candidate('a',90),candidate('b',86),candidate('c',84,'B'),candidate('d',81,'B')];
assert.equal(app.rankPlayers(pool,3).length,3);
assert.deepEqual(app.rankPlayers(pool,3).map(x=>x.p.player_id),['a','b','c']);
for(const n of [2,3,4,5]){
 const slip=app.buildTicket(pool,n);
 assert.equal(slip.length,n);
 assert.equal(new Set(slip.map(x=>app.identity(x))).size,Math.min(n,4),'prefer unique players until the pool is exhausted');
}
assert.equal(app.americanDecimal('+400'),5);
assert.equal(app.americanDecimal('-125'),1.8);
assert.equal(app.americanDecimal('-600'),1+100/600);
assert.equal(app.americanDecimal('garbage'),null);
assert.equal(app.americanDecimal('+80'),null);
assert.equal(app.singlePrice('-125',.66).valid,true);
const gates={bet_recommendations_enabled:false,gates:{model_calibrated:false,odds_fresh:false}};
const audit=app.priceReview('+400','+250',.2,gates,null);
assert(audit.text.includes('NO BET'));
assert(audit.text.includes('20.0%'));
assert(app.priceReview('+400','+250',.2,gates,{type:'TOTAL'}).text.includes('unavailable'));
assert.equal(app.priceReview('+80','',.5,gates,null).ok,false);
assert.equal(app.priceReview('+300','+400',.5,gates,null).ok,false);
const fixture={home:'A',away:'B'};
assert.equal(app.gameMarketDraft('ML','HOME','','-110',fixture).leg.name,'A moneyline');
assert.equal(app.gameMarketDraft('ATS','AWAY',3.5,'+100',fixture).leg.name,'B spread +3.5');
assert.equal(app.gameMarketDraft('TOTAL','OVER',46.5,'-110',fixture).leg.name,'Total Over 46.5');
assert.equal(app.gameMarketDraft('TOTAL','OVER','',null,fixture).ok,false);
assert.equal(app.gameMarketDraft('ATS','HOME',null,'-110',fixture).ok,false);
assert.equal(app.gameMarketDraft('ML','HOME','4',null,fixture).ok,false);
const info=app.script({teams:[
 {team:'A',estimatedPlays:68,estimatedPassAttempts:38,estimatedRushAttempts:30,passingShare:56},
 {team:'B',estimatedPlays:62,estimatedPassAttempts:31,estimatedRushAttempts:31,passingShare:50}
]}, {home:'A',away:'B',projected_home_points:23,projected_away_points:20});
assert(info.lines.join(' ').includes('Projected total 43.0'));
const fallbackInfo=app.script({teams:[
 {team:'A',estimatedPlays:60,estimatedPassAttempts:34,estimatedRushAttempts:26,passingShare:57,
 warning:'QB individual history is insufficient; team pass volume derived from completed PBP. No QB props are projected.'},
 {team:'B',estimatedPlays:62,estimatedPassAttempts:32,estimatedRushAttempts:30,passingShare:52}
]});
assert(fallbackInfo.lines.join(' ').includes('QB individual history is insufficient'),
 'Unverified quarterback fallback must be disclosed');
const sim={markets:[
 {id:'a',market:'recYards',line:30,scenarioRate:.89},
 {id:'a',market:'recYards',line:40,scenarioRate:.68},
 {id:'a',market:'recYards',line:50,scenarioRate:.56},
 {id:'a',market:'recYards',line:80,scenarioRate:.08}
]};
assert.deepEqual(app.alternatives(candidate('a',95),sim).map(x=>x.line),[30,40,50]);
const altRecord={...candidate('a',95),reasons:['Game-first scenario frequency: old','Recent form','Cleared old']};
assert.equal(app.applyAlternative(altRecord,50,sim),true);
assert.equal(altRecord.line,50);
assert.equal(altRecord.scenarioRate,.56);
assert(altRecord.reasons[0].includes('56.0%'));
assert.equal(app.applyAlternative(altRecord,80,sim),false);
console.log('Goal 1 game workflow decision-layer tests passed');
