'use strict';
const assert=require('node:assert/strict');
const engine=require('./nfl_game_engine.js');
const close=(actual,expected)=>assert(Math.abs(actual-expected)<1e-12,actual+' vs '+expected);
function player(team,id,pos,stats,extra={}){
 const seasonGameStats=Array.from({length:8},(_,i)=>({gameId:team+'-'+i,week:i+1,
  passAttempts:stats.p||0,passYards:stats.py||0,rushAttempts:stats.r||0,rushYards:stats.ry||0,
  targets:stats.t||0,receptions:stats.c||0,recYards:stats.y||0}));
 return {player_id:id,player:id,team,opp:team==='A'?'B':'A',pos,seasonGameStats,
  playerAppearancesVerified:true,availability:'ROSTER_ACTIVE',injuryReportStatus:'NOT_REPORTED',
  defenseOpponentRatio:{PASS:1,REC:1,RUSH:1},...extra};
}
const lineup=['A','B'].flatMap(team=>[
 player(team,team+'-qb','QB',{p:35,py:251,r:4,ry:17}),
 player(team,team+'-rb','RB',{r:15,ry:66,t:4,c:3,y:19}),
 player(team,team+'-wr','WR',{t:10,c:7,y:91}),
 player(team,team+'-te','TE',{t:6,c:4,y:44})]);
lineup.push(player('A','out','WR',{t:12,c:10,y:140},{injuryReportStatus:'OUT'}),
 player('A','backup','QB',{p:40,py:300},{qbRole:'BACKUP'}),player('A','no-targets','WR',{}));
const count=2000,seed=12;
const leg=(id,market,line,side='at_least')=>({id,market,line,side});
const run=(legs,selected=[],extra={})=>engine.simulate(lineup,count,seed,selected,{collectSettlements:true,...extra,parlayLegs:legs});
const selected=[{id:'A-qb',market:'passYards',line:175},{id:'A-wr',market:'recYards',line:50}];
const base=engine.simulate(lineup,count,seed,selected,{collectSettlements:true});
const correlated=run(selected.map(x=>({...x,side:'at_least'})),selected);
const {parlay,...unchanged}=correlated;
assert.deepEqual(unchanged,base,'parlay counting does not change any seeded markets, model means, audits, settlement bins or legacy joint results');
assert.equal(base.parlay,undefined,'the optional result is absent by default');
assert.deepEqual(engine.simulate(lineup,count,seed,selected,{collectSettlements:true,parlayLegs:undefined}),base);
assert.equal(parlay.count,count);assert.equal(parlay.legs,2);
assert.equal(parlay.allWinCount,base.joint.hits,'same-game legs are counted together from generated outcomes');
assert.equal(parlay.nonLossCount,parlay.allWinCount);assert.equal(parlay.pushOnlyCount,0);
const marginals=selected.map(s=>base.markets.find(m=>m.id===s.id&&m.market===s.market&&m.line===s.line));
assert(marginals.every(Boolean));
assert(parlay.allWinCount<=Math.min(...marginals.map(m=>m.hits)));
const independentProduct=marginals.reduce((p,m)=>p*m.hits/count,1);
assert(Math.abs(parlay.allWinRate-independentProduct)>.005,'the same-game correlated result differs materially from multiplying independent marginals');
function partition(result){
 const p=result.parlay;
 assert.equal(p.allWinCount+p.pushOnlyCount+p.lossCount,count);
 assert.equal(p.nonLossCount,p.allWinCount+p.pushOnlyCount);
 close(p.allWinRate,p.allWinCount/count);close(p.nonLossRate,p.nonLossCount/count);
 close(p.pushOnlyRate,p.pushOnlyCount/count);close(p.lossRate,p.lossCount/count);
 close(p.allWinRate+p.pushOnlyRate+p.lossRate,1);
}
partition(correlated);
function bins(id,market){return base.settlements.find(s=>s.id===id&&s.market===market).bins}
function bucket(id,market,predicate){return bins(id,market).reduce((sum,[value,n])=>sum+(predicate(value)?n:0),0)}
// Exact whole-number book lines differ from n+ alternates. Equality pushes
// only the OVER leg; all book outcomes use the same whole-unit convention.
for(const [market,whole]of [['recYards',50],['receptions',4],['rushYards',50]]){
 const id=market==='rushYards'?'A-rb':'A-wr';
 const over=run([leg(id,market,whole,'over')]);
 assert.equal(over.parlay.allWinCount,bucket(id,market,v=>v>whole));
 assert.equal(over.parlay.pushOnlyCount,bucket(id,market,v=>v===whole));
 assert.equal(over.parlay.lossCount,bucket(id,market,v=>v<whole));partition(over);
 assert(over.parlay.pushOnlyCount>0,'whole-number lines retain actual push outcomes');
 const atLeast=run([leg(id,market,whole)]);
 assert.equal(atLeast.parlay.allWinCount,over.parlay.allWinCount+over.parlay.pushOnlyCount);
 assert.equal(atLeast.parlay.pushOnlyCount,0);partition(atLeast);
 const half=run([leg(id,market,String(whole+.5),'over')]);
 assert.equal(half.parlay.allWinCount,over.parlay.allWinCount);
 assert.equal(half.parlay.pushOnlyCount,0);partition(half);
}
// OVER zero catches wins with one or more, pushes at zero and never loses.
const overZero=run([leg('A-te','receptions',0,'over')]);
assert.equal(overZero.parlay.allWinCount,bucket('A-te','receptions',v=>v>0));
assert.equal(overZero.parlay.pushOnlyCount,bucket('A-te','receptions',v=>v===0));
assert.equal(overZero.parlay.lossCount,0);assert(overZero.parlay.pushOnlyCount>0);partition(overZero);
const noWins=run([leg('A-te','receptions',10000,'over')]);
assert.equal(noWins.parlay.allWinCount,0);assert.equal(noWins.parlay.allWinRate,0);
assert.equal(noWins.parlay.nonLossCount,0);assert.equal(noWins.parlay.lossCount,count);partition(noWins);
// With mixed legs, allWin is the same as requiring 5+ catches and 50+ yards;
// nonLoss includes the four-catch pushes when the other player's leg wins.
const mixedLegs=[leg('A-wr','receptions',4,'over'),leg('A-rb','rushYards',50)];
const mixed=run(mixedLegs),allWins=engine.simulate(lineup,count,seed,[
 {id:'A-wr',market:'receptions',line:5},{id:'A-rb',market:'rushYards',line:50}]),nonLoss=engine.simulate(lineup,count,seed,[
 {id:'A-wr',market:'receptions',line:4},{id:'A-rb',market:'rushYards',line:50}]);
assert.equal(mixed.parlay.allWinCount,allWins.joint.hits);assert.equal(mixed.parlay.nonLossCount,nonLoss.joint.hits);
assert(mixed.parlay.pushOnlyCount>0);partition(mixed);
const four=run([leg('A-qb','passYards',150),leg('A-rb','rushYards',25),leg('A-wr','recYards',30),leg('B-wr','receptions',2,'over')]);
assert.equal(four.parlay.legs,4);partition(four);
const valid=leg('A-wr','recYards',50,'over');
for(const malformed of [null,false,'legs',{},[],[valid,valid],Array(1),Array(5).fill(valid),[null],[[]],[false],
 [{...valid,id:null}],[{...valid,id:''}],[{...valid,id:true}],[{...valid,id:{toString(){return 'A-wr'}}}],
 [{...valid,market:'anytime_td'}],[{...valid,market:'moneyline'}],[{...valid,market:'__proto__'}],
 [{...valid,side:'under'}],[{...valid,side:'OVER'}],[{...valid,side:null}],
 ...[null,undefined,'',' ',true,false,{},[],NaN,Infinity,-.5,.25,10000.5,'1e2','0x40','50x','+50','50.'].map(line=>[{...valid,line}]),
 [leg('A-wr','recYards',0)],
 [valid,leg('A-wr','receptions',4)],
 [leg('out','recYards',20)],[leg('backup','passYards',150)],[leg('no-targets','recYards',20)],
 [leg('A-wr','passYards',150)],[leg('missing','rushYards',25)]]){
 assert.throws(()=>run(malformed),/parlay|Parlay|player market/, 'unsupported or malformed parlay is unavailable, not a fabricated zero');
}
console.log('NFL parlay engine: exact correlated outcomes, whole/half lines, pushes, unsupported guards and unchanged seeded simulations PASS');
const tenLineup=['A','B'].flatMap(team=>[player(team,team+'q','QB',{p:35,py:250}),...Array.from({length:4},(_,i)=>player(team,team+i,'WR',{t:6,c:4,y:45}))]);
const tenLegs=tenLineup.map(p=>leg(p.player_id,p.pos==='QB'?'passYards':'recYards',10,'over'));
const tenResult=engine.simulate(tenLineup,count,seed,[],{parlayLegs:tenLegs});
assert.equal(tenResult.parlay.legs,10);partition(tenResult);
assert.throws(()=>engine.simulate(tenLineup,count,seed,[],{parlayLegs:[...tenLegs,tenLegs[0]]}),/Parlay/);
