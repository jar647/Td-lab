'use strict';
const assert=require('node:assert/strict'),engine=require('./nfl_game_engine');
function fixture(n=5){const rows=[];for(const [team,opp]of [['A','B'],['B','A']])for(const [pos,id]of [['QB','QB'],['WR','WR'],['TE','TE'],['RB','RB']]){
 const history=Array.from({length:n},(_,i)=>({gameId:team+'g'+i,passAttempts:30,passYards:240,rushAttempts:pos==='RB'?15:2,rushYards:pos==='RB'?60:8,targets:8,receptions:6,recYards:90}));
 rows.push({team,opp,pos,player_id:team+id,player:team+id,seasonGameStats:history,playerAppearancesVerified:true,availability:'ROSTER_ACTIVE',injuryReportStatus:'ACTIVE'});
}return rows}
const rows=fixture(),plain=engine.simulate(rows,1000,647),collected=engine.simulate(rows,1000,647,[],{collectPlayerOutcomes:[{id:'AWR',market:'recYards'},{id:'AQB',market:'passYards'}],collectSettlements:true});
assert.deepEqual(collected.markets,plain.markets,'collecting aligned outcomes must not change seeded model draws');assert.equal(collected.playerOutcomes.length,2);
for(const row of collected.playerOutcomes){assert.equal(row.values.length,1000);assert(row.values.every(Number.isSafeInteger));assert.equal(row.outcomeSetId,collected.outcomeSetId);for(const market of collected.markets.filter(m=>m.id===row.id&&m.market===row.market))assert.equal(row.values.filter(v=>v>=market.line).length,market.hits)}
const legacy=engine.build(rows,{efficiencyProfile:'legacy'}).players.find(p=>p.id==='AWR'),corrected=engine.build(rows,{efficiencyProfile:'sample_counts'}).players.find(p=>p.id==='AWR');
assert.equal(legacy.catchRate,9/14);assert.equal(corrected.catchRate,33/46);assert.equal(corrected.ypc,(450+35)/(30+3));
const longer=engine.build(fixture(15),{efficiencyProfile:'sample_counts'}).players.find(p=>p.id==='AWR');assert(Math.abs(longer.catchRate-.75)<Math.abs(corrected.catchRate-.75),'prior weight must weaken as verified target evidence increases');
assert.equal(corrected.catchRateEvidence.targets,40);assert.equal(corrected.catchRateEvidence.catches,30);
assert.throws(()=>engine.build(rows,{efficiencyProfile:'unknown'}),/profile/);assert.throws(()=>engine.simulate(rows,1000,1,[],{collectPlayerOutcomes:[{id:'missing',market:'recYards'}]}),/unsupported/);
const modified=rows.map(p=>({...p,odds:-999,prob:.99}));assert.deepEqual(engine.simulate(rows,1000,647,[],{efficiencyProfile:'sample_counts'}).markets,engine.simulate(modified,1000,647,[],{efficiencyProfile:'sample_counts'}).markets);
const out=engine.simulate(rows,1000,647,[],{efficiencyProfile:'sample_counts'});assert.equal(out.modelVersion,'game-first-volume-v5-counts-catch');assert.equal(out.efficiencyProfile,'sample_counts');
console.log('NFL receiver efficiency: sample-count priors, diminishing weight, preserved price independence and aligned collection without draw changes PASS');
