'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const api=require('./nfl_parlay.js'),top=require('./nfl_top_plays.js'),board=require('./nfl_player_board.js');
const now=Date.parse('2026-11-15T12:00:00Z'),stamp=new Date(now).toISOString();
const fixture={game_id:'AB',home:'A',away:'B',kickoff_at:new Date(now+3600000).toISOString()};
function player(index,extra={}){
 const scale=1-index*.02;
 return {player_id:'td-'+index,player:'TD Player '+index,team:'A',opp:'B',pos:'RB',market:'ATD',games:2,seasonGamesPlayed:2,last5GamesPlayed:2,availability:'ROSTER_ACTIVE',injuryReportStatus:'ACTIVE',playerAppearancesVerified:true,
  tdallowed:1.2*scale,rzallowed:3.5*scale,playerRz:2.5*scale,rzshare:35*scale,goalLine5:.8*scale,snapShare:.85*scale,playerAnytimeTDs:scale,recent3AnytimeTDs:scale,
  last5GameStats:[],...extra};
}
const records=Array.from({length:12},(_,i)=>player(i,i===1?{availability:'QUESTIONABLE',injuryReportStatus:'QUESTIONABLE',injuryPracticeStatus:'DNP_PRACTICE'}:i===2?{playerAnytimeTDs:null,recent3AnytimeTDs:null}:{}));
const built=top.build(records,fixture,null,{now,fixtures:[fixture],feedGeneratedAt:stamp,fixturesGeneratedAt:stamp});
assert.equal(built.ready,true);assert(built.candidates.length>5);
const candidates=built.candidates.map(c=>({...c,fixture})),before=JSON.stringify(candidates),boardTopFive=top.select({candidates},'TD').slice(0,5);
let generated=api.generateAnytime(candidates,{now});assert.equal(generated.requested,5);assert.equal(generated.shortfall,0);assert.deepEqual(generated.legs.map(c=>c.key),boardTopFive.map(c=>c.key),'TD draft is exactly the first five board rankings');
assert(generated.legs.every(c=>c.fixture.game_id==='AB'&&c.p.team==='A'),'no game or team quota replaces highly rated players');assert.equal(new Set(generated.legs.map(c=>c.p.player_id)).size,5);assert(generated.legs.every(c=>candidates.includes(c)),'original candidate references are returned');assert.equal(JSON.stringify(candidates),before);assert.match(generated.reason,/research rankings, not touchdown probabilities/);
const flagged=generated.legs.find(c=>c.p.player_id==='td-1');assert(flagged);assert.equal(flagged.p.availability,'QUESTIONABLE');assert.equal(flagged.p.injuryPracticeStatus,'DNP_PRACTICE','existing board flags stay visible instead of silently excluding a ranked player');
const opportunityOnly=generated.legs.find(c=>c.p.player_id==='td-2');assert(opportunityOnly);assert.equal(opportunityOnly.p.playerAnytimeTDs,null);assert.equal(opportunityOnly.scenarioRate,null);assert.equal(opportunityOnly.sample,0);assert(generated.legs.every(c=>c.line===null&&c.side==='winner'&&c.scenarioRate===null));
const noLogs=generated.legs.map(c=>({...c,p:{...c.p,last5GameStats:undefined,seasonGameStats:undefined,last5GamesPlayed:undefined}}));assert.equal(api.generateAnytime(noLogs,{now}).legs.length,5,'TD research does not require the yardage model’s three-game outcome history');
const captured=new Set(built.visible.map(c=>c.key));assert(generated.legs.every(c=>captured.has(c.key)),'the existing TD capture already contains these public selections');
const four=candidates.slice(0,4);generated=api.generateAnytime(four,{now});assert.equal(generated.legs.length,4);assert.equal(generated.requested,5);assert.equal(generated.shortfall,1);assert.match(generated.reason,/no filler/);assert.deepEqual(generated.legs.map(c=>c.key),top.select({candidates:four},'TD',5).map(c=>c.key));
const base=candidates[0];
const copy=()=>({...base,p:{...base.p},fixture:{...fixture}});
const boundary=copy();boundary.researchScore=60;boundary.score=60;boundary.fixture.kickoff_at=new Date(now+7*86400000).toISOString();assert.equal(api.generateAnytime([boundary],{now}).legs[0],boundary,'score 60 and an exact seven-day kickoff remain valid');
const reserve=copy();reserve.p={...reserve.p,pos:'QB',season:2026,depthChart:{sourceStatus:'ok',unit:'reserve',order:2,position:'QB',season:2026,source:'https://example.com/team-depth',observedAt:stamp}};
assert.equal(board.isReserveQuarterback(reserve.p),true);assert.deepEqual(api.generateAnytime([reserve],{now}).legs,[],'validated reserve quarterbacks are excluded with the exact board guard');
const announced=copy();announced.p={...reserve.p,qbRole:'EXPECTED_STARTER',starterContext:{source:'https://example.com/team-announcement',note:'The team announced this quarterback as the expected starter.'}};
assert.equal(board.isReserveQuarterback(announced.p),false);assert.equal(api.generateAnytime([announced],{now}).legs[0],announced,'the board’s cited expected-starter exception stays eligible');
const uncited=copy();uncited.p={...announced.p,starterContext:{source:'https://example.com/team-announcement',note:''}};assert.equal(board.isReserveQuarterback(uncited.p),true);assert.deepEqual(api.generateAnytime([uncited],{now}).legs,[],'an uncited starter label cannot bypass verified reserve evidence');
const invalid=[
 c=>{c.market='passTDs'},c=>{c.market='recYards'},c=>{c.category='REC'},c=>{c.side='over'},c=>{c.side='at_least'},
 c=>{c.researchScore=59},c=>{c.researchScore=101},c=>{c.researchScore=NaN},c=>{c.score=Infinity},c=>{c.p.player_id=''},c=>{c.p.player_id=null},
 c=>{c.p.playerAppearancesVerified=false},c=>{c.p.seasonGamesPlayed=1},c=>{c.p.pos='K'},c=>{c.p.qbRole='BACKUP'},c=>{c.p.availability='UNVERIFIED'},
 c=>{c.p.availability='OUT'},c=>{c.p.injuryReportStatus='OUT'},c=>{c.p.injuryReportStatus='DOUBTFUL'},c=>{c.p.injuryReportStatus='IR'},c=>{c.p.injuryReportStatus='PUP'},c=>{c.p.injuryReportStatus='INACTIVE'},
 c=>{c.fixture.game_id=''},c=>{c.fixture.home=c.fixture.away},c=>{c.p.opp='Z'},c=>{c.fixture.kickoff_at=new Date(now).toISOString()},c=>{c.fixture.kickoff_at=new Date(now-1).toISOString()},c=>{c.fixture.kickoff_at=new Date(now+7*86400000+1).toISOString()},c=>{c.fixture.kickoff_at='2026-11-16'}
];
for(const mutate of invalid){const c=copy();mutate(c);assert.deepEqual(api.generateAnytime([c],{now}).legs,[],String(mutate))}
for(const input of [null,undefined,{},[]])assert.equal(api.generateAnytime(input,{now}).shortfall,5);assert.deepEqual(api.generateAnytime(candidates,{now:NaN}).legs,[]);
const tied=['Z','a','b','C','d','e'].map(name=>({...copy(),key:'key:'+name,researchScore:80,score:80,p:{...base.p,player_id:name,player:name}}));
assert.deepEqual(api.generateAnytime(tied,{now}).legs.map(c=>c.key),top.select({candidates:tied},'TD',5).map(c=>c.key),'tie ordering uses the exact board comparator');assert.deepEqual(api.generateAnytime([...tied].reverse(),{now}).legs.map(c=>c.key),api.generateAnytime(tied,{now}).legs.map(c=>c.key));
const duplicate={...candidates[0],key:'duplicate-lower',researchScore:60,score:60};const duplicates=[...candidates,duplicate,candidates[0]];assert.deepEqual(api.generateAnytime(duplicates,{now}).legs.map(c=>c.key),boardTopFive.map(c=>c.key),'duplicate player entries cannot fill the ticket');
const conflict=copy();conflict.key='conflicting-fixture';conflict.p={...conflict.p,player_id:'conflict'};conflict.fixture.kickoff_at=new Date(now+7200000).toISOString();assert.deepEqual(api.generateAnytime([base,conflict],{now}).legs,[],'ambiguous fixture identities fail closed');
const other=copy();other.key='CD|other|anytime_td';other.p={...other.p,player_id:'other',player:'Other player',team:'C',opp:'D'};other.fixture={game_id:'CD',home:'C',away:'D',kickoff_at:new Date(now+7200000).toISOString()};other.researchScore=100;other.score=100;const mixed=[...candidates,other];assert.deepEqual(api.generateAnytime(mixed,{now}).legs.map(c=>c.key),top.select({candidates:mixed},'TD',5).map(c=>c.key));
const browser={PropVaultGoal1:require('./nfl_goal1.js'),CookItUpPricing:require('./market_odds.js'),PropShopNFLTopPlays:top,PropShopNFLBoard:board};vm.runInNewContext(fs.readFileSync('nfl_parlay.js','utf8'),browser);assert.equal(browser.PropShopNFLParlay.generateAnytime(candidates,{now}).legs.length,5);
console.log('NFL anytime-TD draft: exact board top five, unchanged flags and history policy, no game quotas, shortfall and fixture safeguards PASS');
