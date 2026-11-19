'use strict';
const assert=require('node:assert/strict'),api=require('./nfl_parlay_optimizer');
const now=Date.parse('2026-11-19T16:00:00Z');
function candidate(id,score=80,g='AB'){
 const history=Array.from({length:5},()=>({recYards:80,receptions:5,targets:7}));
 return {key:g+'|'+id+'|recYards',market:'recYards',side:'at_least',line:50,scenarioRate:.7,researchScore:score,score:100,d:{key:'recYards',label:'receiving yards'},
  fixture:{game_id:g,home:g[0],away:g[1],kickoff_at:new Date(now+6*3600000).toISOString()},p:{player_id:id,player:id,team:g[0],opp:g[1],pos:'WR',availability:'ROSTER_ACTIVE',injuryReportStatus:'ACTIVE',playerAppearancesVerified:true,last5GamesPlayed:5,last5GameStats:history,seasonGameStats:history}};
}
const offer=(c,line=49.5,odds='-110')=>({id:c.key+'|'+line,candidateKey:c.key,line,odds});
function simulation(rows,g='AB'){const batch='batch-'+g;return {count:1000,seed:1,modelVersion:'fixture',outcomeSetId:batch,playerOutcomes:rows.map(([c,values])=>({id:c.p.player_id,market:c.market,values,outcomeSetId:batch}))}}
const values=(wins,start=0)=>Array.from({length:1000},(_,i)=>i>=start&&i<start+wins?80:20);
const a=candidate('A',81),b=candidate('B',89),c=candidate('C',84),d=candidate('D',75);
const pool=[a,b,c,d],offers=pool.map(p=>offer(p)),sims=new Map([['AB',simulation([[a,values(510)],[b,values(750)],[c,values(750)],[d,values(750)]])]]);
const before=JSON.stringify([pool,offers,[...sims]]);
const result=api.optimize(pool,offers,sims,{count:3,mode:'same',gameId:'AB',now});
assert(result.available,result.reason);assert.equal(result.legs.length,3);assert(!result.legs.some(p=>p.p.player_id==='A'),'a higher matchup score cannot displace substantially better exact-line support');assert(result.legs.some(p=>p.p.player_id==='D'));
assert.equal(result.jointFrequency,.75);assert(result.legs.every(p=>p.bookLine===49.5&&p.offered&&p.selectionReason.includes('Counted jointly')));assert.equal(result.play,false);assert.equal(result.calibrated,false);
assert.equal(JSON.stringify([pool,offers,[...sims]]),before,'selection must not mutate frozen inputs');
assert.deepEqual(api.optimize(pool,[...offers].reverse(),sims,{count:3,mode:'same',gameId:'AB',now}).legs.map(x=>x.key),result.legs.map(x=>x.key),'input quote ordering cannot change deterministic selection');
const paired=new Map([['AB',simulation([[b,values(800)],[c,values(800,200)]])]]);
const joint=api.optimize([b,c],[offer(b),offer(c)],paired,{count:2,mode:'same',gameId:'AB',now});assert(joint.available);assert.equal(joint.jointFrequency,.6);assert.notEqual(joint.jointFrequency,.8*.8,'same-game frequencies must use aligned outcomes');
const negative=new Map([['AB',simulation([[b,values(500)],[c,values(500,500)]])]]);assert.equal(api.optimize([b,c],[offer(b),offer(c)],negative,{count:2,mode:'same',gameId:'AB',now}).available,false);
const alt=api.optimize([b,c],[offer(b,79.5),offer(b,49.5),offer(c)],paired,{count:2,mode:'same',gameId:'AB',now});assert(alt.available);assert.equal(new Set(alt.legs.map(p=>p.p.player_id)).size,2);
const acrossC=candidate('E',80,'CD'),across=new Map([...paired,['CD',simulation([[acrossC,values(750)]],'CD')]]);
const cross=api.optimize([b,acrossC],[offer(b),offer(acrossC)],across,{count:2,mode:'across',now});assert(cross.available);assert(Math.abs(cross.jointFrequency-.8*.75)<1e-12);assert(cross.independentGames);
assert.equal(api.optimize([b,c],[offer(b),offer(c)],paired,{count:2,mode:'across',now}).available,false,'distinct-games mode cannot fill from a single game');
for(const change of [p=>p.p.availability='OUT',p=>p.p.injuryReportStatus='QUESTIONABLE',p=>p.researchScore=59,p=>p.fixture.kickoff_at=new Date(now).toISOString()]){
 const changed=structuredClone(b);change(changed);assert.equal(api.optimize([changed,c],[offer(changed),offer(c)],paired,{count:2,mode:'same',gameId:'AB',now}).available,false);
}
for(const change of [s=>s.playerOutcomes[0].outcomeSetId='other',s=>s.playerOutcomes[0].values.pop(),s=>delete s.playerOutcomes[0].values[0],s=>s.count=999,s=>s.playerOutcomes.push({...s.playerOutcomes[0]})]){
 const malformed=structuredClone(paired.get('AB'));change(malformed);assert.equal(api.optimize([b,c],[offer(b),offer(c)],new Map([['AB',malformed]]),{count:2,mode:'same',gameId:'AB',now}).available,false);
}
for(const invalid of [offer(b,-1),offer(b,50.1),offer(b,49.5,'-90'),offer(b,0.5)])assert.equal(api.optimize([b,c],[invalid,offer(c)],paired,{count:2,mode:'same',gameId:'AB',now}).available,false);
const pushes=new Map([['AB',simulation([[b,Array(1000).fill(50)],[c,values(800)]])]]);assert.equal(api.optimize([b,c],[offer(b,50),offer(c)],pushes,{count:2,mode:'same',gameId:'AB',now}).available,false,'all pushes cannot masquerade as a supported win leg');
const prices=api.optimize(pool,offers.map(o=>({...o,odds:'+200'})),sims,{count:3,mode:'same',gameId:'AB',now});assert.deepEqual(prices.legs.map(x=>x.key),result.legs.map(x=>x.key));assert.equal(prices.jointFrequency,result.jointFrequency,'prices cannot alter simulation outcomes or matchup scores');
console.log('NFL offered-line optimizer: complete shared-outcome search, alternative lines, distinct players/games, quality balance, exact pushes, source/data guards and price independence PASS');

const tenPool=Array.from({length:10},(_,i)=>candidate("ten"+i,80,"g"+i));
const tenSims=new Map(tenPool.map(p=>[p.fixture.game_id,simulation([[p,values(750)]],p.fixture.game_id)]));
const ten=api.optimize(tenPool,tenPool.map(p=>offer(p)),tenSims,{count:10,mode:"across",now});
assert(ten.available);assert.equal(ten.legs.length,10);assert(Math.abs(ten.jointFrequency-Math.pow(.75,10))<1e-12);
assert.equal(api.optimize(tenPool,tenPool.map(p=>offer(p)),tenSims,{count:11,now}).available,false);
