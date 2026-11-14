'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const api=require('./nfl_parlay.js'),goal=require('./nfl_goal1.js'),pricing=require('./market_odds.js');
const now=Date.parse('2026-11-14T18:00:00Z');
function candidate(player,game='AB',market='recYards',score=80,raw=100){
 const home=game.slice(0,1),away=game.slice(1),stats={recYards:90,rushYards:80,passYards:270,receptions:6};
 return {key:game+'|'+player+'|'+market,market,side:'at_least',line:goal.MIN_ALT[market],scenarioRate:.7,researchScore:score,score:raw,
  p:{player_id:player,player:'Player '+player,team:home,opp:away,pos:market==='passYards'?'QB':market==='rushYards'?'RB':'WR',availability:'ROSTER_ACTIVE',injuryReportStatus:'NOT_REPORTED',playerAppearancesVerified:true,last5GamesPlayed:5,last5GameStats:Array.from({length:5},()=>({...stats}))},
  fixture:{game_id:game,home,away,kickoff_at:new Date(now+3600000).toISOString()}};
}
const pool=[candidate('a','AB','recYards',99),candidate('b','AB','recYards',98),candidate('a','AB','receptions',97),candidate('c','AB','rushYards',96),candidate('d','CD','recYards',90),candidate('e','EF','recYards',85),candidate('f','GH','passYards',80)];
const untouched=JSON.stringify(pool);
let result=api.generate(pool,{now});assert.equal(result.requested,3);assert.equal(result.shortfall,0);assert.deepEqual(result.legs.map(c=>c.p.player_id),['a','d','e'],'full pool supplies different games beyond the first three candidates');assert.equal(result.legs[0],pool[0],'draft keeps original candidate objects');assert.equal(JSON.stringify(pool),untouched,'generation never mutates source candidates');
result=api.generate([...pool].reverse(),{now,count:4});assert.deepEqual(result.legs.map(c=>c.p.player_id),['a','d','e','f']);assert.equal(new Set(result.legs.map(c=>c.fixture.game_id)).size,4);
result=api.generate(pool,{now,count:4,mode:'same',gameId:'AB'});assert.equal(result.legs.length,3);assert.equal(result.shortfall,1);assert.match(result.reason,/no filler/i);assert.equal(new Set(result.legs.map(c=>c.p.player_id)).size,3);assert(result.legs.every(c=>c.fixture.game_id==='AB'));
for(const count of [0,1,5,2.5,'3',NaN,Infinity,null])assert.deepEqual(api.generate(pool,{now,count}).legs,[],'invalid count '+count);
for(const options of [{mode:'same'},{mode:'same',gameId:'unknown'},{mode:'other'},{now:NaN}])assert.deepEqual(api.generate(pool,{now,...options}).legs,[]);
assert.deepEqual(api.generate(null,{now}).legs,[]);
const invalid=[
 c=>{c.researchScore=59},c=>{c.researchScore=101},c=>{c.researchScore=NaN},c=>{c.score=Infinity},c=>{c.market='anytime_td'},c=>{c.side='under'},c=>{c.side='over'},
 c=>{c.line=goal.MIN_ALT[c.market]-1},c=>{c.scenarioRate=null},c=>{c.scenarioRate='0.8'},c=>{c.scenarioRate=1.1},c=>{c.p.player_id=''},c=>{c.p.player_id=null},
 c=>{c.p.playerAppearancesVerified=false},c=>{delete c.p.playerAppearancesVerified},c=>{c.p.last5GamesPlayed=2},c=>{c.p.last5GameStats=[{recYards:30},{recYards:40}]},c=>{c.p.last5GameStats=[{recYards:30},{recYards:40},{recYards:null}]},
 c=>{c.p.availability='OUT'},c=>{c.p.availability='QUESTIONABLE'},c=>{c.p.injuryReportStatus='OUT'},c=>{c.p.injuryReportStatus='DOUBTFUL'},c=>{c.p.injuryReportStatus='QUESTIONABLE'},c=>{c.p.injuryReportStatus='Q'},c=>{c.p.injuryReportStatus='IR'},c=>{c.p.injuryPracticeStatus='DNP_PRACTICE'},
 c=>{c.fixture.kickoff_at=new Date(now).toISOString()},c=>{c.fixture.kickoff_at=new Date(now+7*86400000+1).toISOString()},c=>{c.fixture.kickoff_at='2026-11-15'},c=>{c.fixture.game_id=''},c=>{c.p.opp='Z'},c=>{c.fixture.home=c.fixture.away}
];
for(const mutate of invalid){const c=candidate('invalid');mutate(c);assert.deepEqual(api.generate([c],{now,count:2}).legs,[],String(mutate))}
const boundary=candidate('boundary');boundary.researchScore=60;boundary.scenarioRate=0;boundary.fixture.kickoff_at=new Date(now+7*86400000).toISOString();assert.equal(api.generate([boundary],{now,count:2}).legs[0],boundary,'actual zero rate and exact score/date boundaries remain valid');
const duplicatePlayer=candidate('a','IJ','recYards',95);assert.deepEqual(api.generate([...pool,duplicatePlayer],{now,count:4}).legs.map(c=>c.p.player_id),['a','d','e','f'],'one actual player ID cannot appear twice across fixtures');
const tied=[candidate('z','AB','recYards',80,50),candidate('a','CD','recYards',80,50),candidate('x','EF','recYards',81,1),candidate('q','GH','recYards',80,60)];assert.deepEqual(api.generate(tied,{now,count:4}).legs.map(c=>c.p.player_id),['x','q','z','a'],'matchup score ranks first, raw score second, stable key last');assert.deepEqual(api.generate([...tied].reverse(),{now,count:4}).legs.map(c=>c.key),api.generate(tied,{now,count:4}).legs.map(c=>c.key));
const conflict=candidate('conflict');conflict.fixture.kickoff_at=new Date(now+7200000).toISOString();assert.deepEqual(api.generate([pool[0],conflict],{now,count:2}).legs,[],'ambiguous fixture identities fail closed');
function group(gameId,legs=2,win=6000,push=0,count=10000){return {gameId,parlay:{count,legs,allWinCount:win,nonLossCount:win+push,pushOnlyCount:push,lossCount:count-win-push,allWinRate:win/count,nonLossRate:(win+push)/count,pushOnlyRate:push/count,lossRate:(count-win-push)/count}}}
let combined=api.combine([group('AB')],{});assert.equal(combined.status,'ready');assert.equal(combined.allWinRate,.6);assert.equal(combined.pushOnlyRate,0);assert.equal(combined.lossRate,.4);assert.equal(combined.price,null);assert.equal(combined.modelDifference,null);assert.equal(combined.independentGames,false);assert.equal(combined.play,false);assert.equal(combined.verifiedValue,false);
combined=api.combine([group('AB')],{combinedOdds:'+150'});assert.equal(combined.price.american,150);assert(Math.abs(combined.modelDifference-.2)<1e-12);assert.equal(combined.play,false,'favorable simulated price comparison never approves a bet');
combined=api.combine([group('AB',1,8000),group('CD',1,5000)],{combinedOdds:'-110'});assert.equal(combined.allWinRate,.4);assert.equal(combined.independentGames,true);assert.equal(combined.groups.length,2);assert.equal(combined.price.american,-110,'actual quoted combined price is used unchanged');assert(Math.abs(combined.modelDifference-(.4-110/210))<1e-12);
combined=api.combine([group('AB',1,6000,2000),group('CD',1,5000,1000)],{combinedOdds:'+200'});assert.equal(combined.allWinRate,.3);assert(Math.abs(combined.pushOnlyRate-.18)<1e-12);assert(Math.abs(combined.lossRate-.52)<1e-12);assert.equal(combined.modelDifference,null,'push paths suppress price gaps without reduced-ticket payout terms');
combined=api.combine([group('AB',2,0,0)],{combinedOdds:'+100'});assert.equal(combined.status,'ready');assert.equal(combined.allWinRate,0);assert.equal(combined.lossRate,1);assert.equal(combined.modelDifference,-.5);
combined=api.combine([group('AB',2,0,10000)],{combinedOdds:'+100'});assert.equal(combined.pushOnlyRate,1);assert.equal(combined.modelDifference,null);
combined=api.combine([group('AB',1,6000,2000),group('CD',1,0,0)],{combinedOdds:'+100'});assert.equal(combined.pushOnlyRate,0);assert.equal(combined.lossRate,1);assert.equal(combined.modelDifference,-.5,'another always-losing group leaves no surviving reduced-ticket path');
for(const price of [undefined,null,'','   '])assert.equal(api.combine([group('AB')],{combinedOdds:price}).price,null);
for(const price of ['-90','-110.5','Infinity',0,[],{},false])assert.equal(api.combine([group('AB')],{combinedOdds:price}).status,'invalid-odds');
for(const groups of [null,[],[group('AB'),group('AB')],[group('AB',1)],Array.from({length:5},(_,i)=>group(String(i),1))])assert.equal(api.combine(groups,{}).status,'unavailable');
const badGroups=[
 p=>{p.count=999},p=>{p.count='10000'},p=>{p.count=1000.5},p=>{p.legs=0},p=>{p.legs=5},p=>{p.allWinCount=-1},p=>{p.allWinCount=6000.5},p=>{p.nonLossCount=5000},p=>{p.pushOnlyCount=1},p=>{p.lossCount=3999},p=>{p.allWinRate=null},p=>{p.allWinRate='0.6'},p=>{p.allWinRate=.61},p=>{p.nonLossRate=Infinity},p=>{p.nonLossRate=.6-1e-11},p=>{p.pushOnlyRate=NaN},p=>{delete p.lossRate}
];
for(const mutate of badGroups){const g=group('AB');mutate(g.parlay);assert.equal(api.combine([g],{}).status,'unavailable',String(mutate))}
const zeroId=group('');assert.equal(api.combine([zeroId],{}).status,'unavailable');
const inputGroups=[group('AB',1),group('CD',1)],before=JSON.stringify(inputGroups);api.combine(inputGroups,{combinedOdds:'+200'});assert.equal(JSON.stringify(inputGroups),before);
const browser={PropVaultGoal1:goal,CookItUpPricing:pricing};vm.runInNewContext(fs.readFileSync('nfl_parlay.js','utf8'),browser);assert.equal(typeof browser.PropShopNFLParlay.generate,'function');assert.equal(browser.PropShopNFLParlay.combine([group('AB')],{}).status,'ready');
console.log('NFL parlay helper: full-pool distinct drafts, history/injury/PASS safeguards, joint counts, push paths and actual combined prices PASS');
