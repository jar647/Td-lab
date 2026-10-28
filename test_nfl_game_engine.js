/* Run: node test_nfl_game_engine.js */
'use strict';
const assert=require('node:assert/strict');
const engine=require('./nfl_game_engine.js');
function player(team,id,pos,stats,extra={}){
 const history=Array.from({length:8},(_,i)=>({
  week:i+1,passAttempts:stats.p??0,rushAttempts:stats.r??0,
  targets:stats.t??0,receptions:stats.c??0,recYards:stats.y??0,
  rushYards:stats.ry??0,passYards:stats.py??0
 }));
 return {player_id:id,player:id,team,opp:team==='A'?'B':'A',pos,
  playerAppearancesVerified:true,seasonGameStats:history,
  last5GameStats:history.slice(-5),availability:'ROSTER_ACTIVE',
  injuryReportStatus:'NOT_REPORTED',defenseOpponentRatio:{PASS:1,REC:1,RUSH:1},
  ...extra};
}
const lineup=[
 player('A','a-qb','QB',{p:35,r:4,ry:17,py:251}),
 player('A','a-rb','RB',{r:15,ry:66,t:4,c:3,y:19}),
 player('A','a-wr','WR',{t:10,c:7,y:91}),
 player('A','a-te','TE',{t:6,c:4,y:44}),
 player('B','b-qb','QB',{p:32,r:3,ry:12,py:229}),
 player('B','b-rb','RB',{r:18,ry:77,t:3,c:2,y:14}),
 player('B','b-wr','WR',{t:10,c:6,y:80}),
 player('B','b-te','TE',{t:6,c:4,y:48}),
 player('A','a-out','WR',{t:12,c:10,y:140},{injuryReportStatus:'OUT'})
];
function run(){
 const legs=[{id:'a-wr',market:'receptions',line:3},{id:'a-qb',market:'passYards',line:200}];
 const result=engine.simulate(lineup,1500,12,legs);
 assert.equal(result.status,'RESEARCH_ONLY_UNCALIBRATED');
 assert.equal(result.teams.length,2);
 assert.equal(result.joint.legs,2);
 assert(!result.markets.some(m=>m.id==='a-out'),'OUT player must be excluded');
 const rec=result.markets.find(m=>m.id==='a-wr'&&m.market==='receptions'&&m.line===3);
 const qb=result.markets.find(m=>m.id==='a-qb'&&m.market==='passYards'&&m.line===200);
 assert(rec&&qb);
 assert(result.joint.scenarioRate<=rec.scenarioRate+0.0001);
 assert(result.joint.scenarioRate<=qb.scenarioRate+0.0001);
 assert(result.markets.every(m=>m.scenarioRate>=0&&m.scenarioRate<=1));
 assert(result.teams.every(t=>t.scenarioAvgPasses+t.scenarioAvgRushes>=35));
 assert.deepEqual(result,engine.simulate(lineup,1500,12,legs),'seeded runs must be reproducible');
 assert.notDeepEqual(result,engine.simulate(lineup,1500,13,legs),'different seeds must vary');
 assert.throws(()=>engine.simulate(lineup,100,1),/Simulation count/);
 assert.throws(()=>engine.simulate(lineup.filter(x=>x.team==='A'),1500,1),/two teams/);

 const anonymous=lineup.filter(p=>p.player_id!=='b-qb');
 // Never invent a quarterback or allow a guessed QB passing-yards prop.
 const unverified=anonymous.map(p=>({...p,teamPassAttemptsPerGame:33}));
 const recovered=engine.simulate(unverified,1500,12,[{id:'b-wr',market:'recYards',line:40}]);
 const b=recovered.teams.find(t=>t.team==='B');
 assert.equal(b.passVolumeSource,'VERIFIED_TEAM_PBP_NO_QB_PROPS');
 assert.equal(b.quarterbackPlayerPropsAvailable,false);
 assert(recovered.markets.some(m=>m.id==='b-wr'&&m.market==='recYards'),
   'Receiver forecast must still be available without verified QB');
 assert(!recovered.markets.some(m=>m.team==='B'&&m.market==='passYards'),
   'No named passing-yard prop without a verified QB');
 assert.throws(()=>engine.simulate(anonymous,1500,12),
   /no verified quarterback or historical team passing volume/);
 console.log('NFL game-first simulator tests passed');
}
run();
