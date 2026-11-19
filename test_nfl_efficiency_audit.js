'use strict';
const assert=require('node:assert/strict'),engine=require('./nfl_game_engine'),{audit}=require('./scripts/audit_nfl_receiver_efficiency');
const records=[];for(const [team,opp]of [['A','B'],['B','A']])for(const pos of ['QB','WR','RB','TE'])records.push({player_id:team+pos,player:team+pos,team,opp,pos,market:'ATD',availability:'OUT',injuryReportStatus:'OUT',qbRole:'EXPECTED_STARTER',depthChart:{order:1,unit:'first',position:'QB',sourceStatus:'ok',season:2099,observedAt:'2099-01-01T00:00:00Z',source:'https://example.com/future'},playerAppearancesVerified:true,defenseOpponentRatio:{REC:99},
 seasonGameStats:Array.from({length:6},(_,i)=>({gameId:'2026_0'+(i+1)+'_A_B',week:i+1,position:pos,passAttempts:30,passYards:230,rushAttempts:pos==='RB'?14:2,rushYards:pos==='RB'?55:4,targets:7,receptions:5,recYards:65}))});
const original=engine.simulate;let calls=0;
try{engine.simulate=(players,count,seed,selected,options)=>{calls++;for(const p of players){assert.equal(p.depthChart,null);assert.equal(p.qbRole,undefined);assert.equal(p.injuryReportStatus,'UNVERIFIED');assert.deepEqual(p.defenseOpponentRatio,{});assert.equal(p.teamPassAttemptsPerGame,null);assert(p.seasonGameStats.every(h=>h.week<=5));}return original(players,count,seed,selected,options)};
 const report=audit(records,{runs:1000,validationWeek:5});assert(calls>0);assert.equal(report.status,'PROMOTION_WITHHELD','a tiny synthetic sample cannot pass the promotion gate');assert(report.observations.length>0);assert(report.observations.every(r=>r.week>=4&&r.week<=6));
 const future=structuredClone(records);for(const p of future)p.seasonGameStats[5].recYards=900;
 engine.simulate=original;const changed=audit(future,{runs:1000,validationWeek:5});
 const before=report.observations.filter(r=>r.week<6).map(r=>[r.gameId,r.playerId,r.market,r.line,r.beforeProbability,r.afterProbability]);
 const after=changed.observations.filter(r=>r.week<6).map(r=>[r.gameId,r.playerId,r.market,r.line,r.beforeProbability,r.afterProbability]);assert.deepEqual(after,before,'target/future outcomes cannot change earlier-week forecasts');
}finally{engine.simulate=original}
console.log('NFL receiver audit: prior-only weeks, omitted current injuries/depth/opponent factors, stable earlier predictions and evidence minimums PASS');
