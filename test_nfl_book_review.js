'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const review=require('./nfl_book_review.js'),engine=require('./nfl_game_engine.js');
const close=(actual,expected)=>assert(Math.abs(actual-expected)<1e-12,actual+' vs '+expected);
for(const [raw,line]of [[0,0],['0',0],['.5',.5],[' 50.5 ',50.5],['50.0',50],[9999.5,9999.5],[10000,10000]])
 assert.equal(review.parseLine(raw),line);
for(const raw of [null,undefined,'',' ',true,[],{},NaN,Infinity,-.5,10000.5,.25,'1e2','0x40','50x','50.','1,000','+50','-0'])
 assert.equal(review.parseLine(raw),null,'invalid whole/half line '+String(raw));
const settlement={id:'receiver',market:'recYards',count:1000,bins:[[49,200],[50,300],[51,500]]};
const whole=review.evaluate({settlement,line:50,odds:'-110'});
assert.equal(whole.status,'ready');assert.equal(whole.winCount,500);assert.equal(whole.pushCount,300);assert.equal(whole.lossCount,200);
close(whole.winRate,.5);close(whole.pushRate,.3);close(whole.lossRate,.2);close(whole.resolvedWinRate,5/7);
close(whole.implied,110/210);close(whole.requiredWinRate,(110/210)*.7);close(whole.modelDifference,.5-(110/210)*.7);
assert.equal(whole.american,-110);close(whole.decimal,1+100/110);assert.equal(whole.play,false);assert.equal(whole.verifiedValue,false);
const half=review.evaluate({settlement,line:50.5,odds:'+125'});
assert.equal(half.winCount,500);assert.equal(half.pushCount,0);assert.equal(half.lossCount,500);
close(half.requiredWinRate,1/2.25);close(half.resolvedWinRate,.5);assert.equal(half.american,125);
const below=review.evaluate({settlement,line:49.5,odds:-110});
assert.equal(below.winCount,800,'OVER 49.5 includes 50, unlike OVER 50');assert.equal(below.pushCount,0);
const custom=review.evaluate({settlement,line:50.5,odds:-200});
assert.equal(custom.winCount,half.winCount);assert.equal(custom.pushCount,half.pushCount);assert.equal(custom.lossCount,half.lossCount);
assert(custom.modelDifference<0);assert(half.modelDifference>0);assert.equal(custom.play,false,'a price comparison never creates a BET');
const allPush=review.evaluate({settlement:{...settlement,bins:[[0,1000]]},line:0,odds:'+100'});
assert.equal(allPush.status,'ready');assert.equal(allPush.winRate,0);assert.equal(allPush.pushRate,1);assert.equal(allPush.lossRate,0);
assert.equal(allPush.resolvedWinRate,null);assert.equal(allPush.requiredWinRate,0);assert.equal(allPush.modelDifference,0);
const allLoss=review.evaluate({settlement,line:10000,odds:'+100'});
assert.equal(allLoss.winRate,0);assert.equal(allLoss.pushRate,0);assert.equal(allLoss.lossRate,1,'a supported zero is not unavailable');
for(const malformed of [null,{},[],{...settlement,id:''},{...settlement,market:'anytime_td'},
 {...settlement,count:999},{...settlement,count:'1000'},{...settlement,count:1000.5},
 {...settlement,bins:[]},{...settlement,bins:[[49,200],[50,300],[50,500]]},
 {...settlement,bins:[[49.5,1000]]},{...settlement,bins:[[-1,1000]]},{...settlement,bins:[[49,-1],[50,1001]]},
 {...settlement,bins:[[49,'1000']]},{...settlement,bins:[[49,1000.5]]},
 {...settlement,bins:[[49,999]]},{...settlement,bins:[[49,1001]]},
 {...settlement,bins:[[49,1000,'extra']]},{...settlement,bins:['49,1000']}]){
 const output=review.evaluate({settlement:malformed,line:50,odds:-110});
 assert.equal(output.status,'unavailable');assert.equal(output.winRate,undefined,'malformed data cannot become a zero rate');
}
for(const line of ['',null,.25,Infinity,-1])assert.equal(review.evaluate({settlement,line,odds:-110}).status,'invalid-line');
for(const odds of ['',null,0,99,-99,'-110x','-110.5',Infinity,'1e3',100001])
 assert.equal(review.evaluate({settlement,line:50,odds}).status,'invalid-odds');
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
const selected=[{id:'A-wr',market:'recYards',line:52}];
const base=engine.simulate(lineup,1500,12,selected),collected=engine.simulate(lineup,1500,12,selected,{collectSettlements:true});
const {settlements,...unchanged}=collected;
assert.deepEqual(unchanged,base,'collecting settlements never changes seeded outcomes, audits, means or joint frequencies');
assert.deepEqual(engine.simulate(lineup,1500,12,selected,{collectSettlements:false}),base);
assert.deepEqual(engine.simulate(lineup,1500,12,selected,{collectSettlements:'true'}),base,'collection requires explicit boolean true');
assert.equal(base.settlements,undefined);assert(settlements.length>0);
const supported=new Set(base.markets.map(row=>JSON.stringify([row.id,row.market])));
assert.equal(settlements.length,supported.size);assert.equal(new Set(settlements.map(row=>JSON.stringify([row.id,row.market]))).size,settlements.length);
for(const row of settlements){
 assert(supported.has(JSON.stringify([row.id,row.market])));assert.equal(row.count,1500);
 assert.equal(row.bins.reduce((sum,bin)=>sum+bin[1],0),1500);
 assert(row.bins.every(([value,n],i)=>Number.isInteger(value)&&value>=0&&Number.isInteger(n)&&n>0&&(!i||row.bins[i-1][0]<value)));
 const checked=review.evaluate({settlement:row,line:10.5,odds:-110});assert.equal(checked.status,'ready');
 assert.equal(checked.winCount+checked.pushCount+checked.lossCount,1500);
}
assert(!settlements.some(row=>['out','backup','no-targets'].includes(row.id)),'blocked or unsupported players have no fabricated settlement rates');
for(const market of base.markets){
 const row=settlements.find(s=>s.id===market.id&&s.market===market.market);
 const thresholdHits=row.bins.filter(([value])=>value>=market.line).reduce((sum,bin)=>sum+bin[1],0);
 assert.equal(thresholdHits,market.hits,'floored settlement retains exact integer alternate hit counts');
}
const receiver=settlements.find(row=>row.id==='A-wr'&&row.market==='recYards');
const exactCustom=review.evaluate({settlement:receiver,line:51.5,odds:-110});
assert.equal(exactCustom.winCount,collected.joint.hits,'custom line uses actual generated outcomes rather than ladder interpolation');
const missingQB=lineup.filter(p=>p.player_id!=='B-qb').map(p=>({...p,teamPassAttemptsPerGame:33}));
const fallback=engine.simulate(missingQB,1000,12,[],{collectSettlements:true});
assert(!fallback.settlements.some(row=>row.id==='B-qb'||row.market==='anytime_td'));
assert(fallback.settlements.some(row=>row.id==='B-wr'&&row.market==='recYards'),'anonymous team volume supports receivers without inventing a QB prop');
const browser={};vm.runInNewContext(fs.readFileSync('market_odds.js','utf8'),browser);vm.runInNewContext(fs.readFileSync('nfl_book_review.js','utf8'),browser);
assert.equal(browser.PropShopNFLBookReview.evaluate({settlement,line:50,odds:-110}).winCount,500,'browser global matches Node helper');
let loaded,message,posted;
const worker={importScripts:path=>{loaded=path},PropVaultGameEngine:{simulate(...args){message=args;return {settlements:[settlement]}}},postMessage:value=>{posted=value}};
vm.runInNewContext(fs.readFileSync('nfl_game_worker.js','utf8'),{...worker,self:worker});
worker.onmessage({data:{players:lineup,count:10000,seed:982451653,selected:[],requestId:7,options:{collectSettlements:true}}});
assert.equal(loaded,'./nfl_game_engine.js?v=nfl-book-review-v5');assert.equal(message[4].collectSettlements,true);assert.equal(posted.requestId,7);
assert.equal(posted.result.settlements[0],settlement);
console.log('NFL book review: exact OVER settlement, pushes, American odds, malformed-data safeguards and unchanged seeded simulations PASS');
