/* Run: node test_capture_game_first.js */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {freezeGame,MODEL_VERSION}=require('./capture_game_first.js');
const now=new Date('2026-10-28T11:00:00Z');
const game={season:2026,week:8,game_id:'game8',home:'A',away:'B',gameday:'2026-10-29'};
const players=[{player_id:'id1',player:'Example',team:'A',opp:'B',pos:'RB'}];
const baseline={game_id:'game8',model_version:'opportunity-2024-trained-eligible-fullseason-v2',
 predictions:[{player_id:'id1',market:'RUSH',threshold:49.5,model_probability:.62}]};
const fake=()=>({count:10000,teams:[{team:'A'},{team:'B'}],
 markets:[{id:'id1',name:'Example',team:'A',pos:'RB',market:'rushYards',line:50,scenarioRate:.7,modeledMean:61}]});
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pv-game-'));
try{
 const first=freezeGame(game,players,baseline,now,dir,fake);
 assert.equal(first.status,'FROZEN');
 const doc=JSON.parse(fs.readFileSync(first.path,'utf8'));
 assert.equal(doc.model_version,MODEL_VERSION);
 assert.equal(doc.predictions[0].baseline_probability,.62);
 assert.equal(doc.predictions[0].model_probability,.7);
 assert.equal(doc.predictions[0].threshold,49.5);
 assert.equal(doc.bet_ready,false);
 const before=fs.readFileSync(first.path,'utf8');
 assert.equal(freezeGame(game,players,baseline,now,dir,fake).status,'ALREADY_FROZEN');
 assert.equal(fs.readFileSync(first.path,'utf8'),before);
 assert.equal(freezeGame({...game,game_id:'late'},players,baseline,new Date('2026-10-29T01:00:00Z'),dir,fake).status,'TOO_LATE_FOR_PREGAME_SNAPSHOT');
 assert.equal(freezeGame({...game,game_id:'missing'},players,null,now,dir,fake).status,'BASELINE_SNAPSHOT_MISSING');

 // With no named QB for team A, an independently observed team pass volume
 // permits skill-position forecasts but not fictitious QB props.
 const {simulate}=require('./nfl_game_engine.js');
 const mk=(team,id,pos,stats)=>{
  const hist=Array.from({length:7},(_,i)=>({week:i+1,passAttempts:stats.pass||0,
   rushAttempts:stats.rush||0,targets:stats.targets||0,receptions:stats.catch||0,
   recYards:stats.recYards||0,rushYards:stats.rushYards||0,passYards:stats.passYards||0}));
  return {player_id:id,player:id,team,opp:team==='A'?'B':'A',pos,seasonGameStats:hist,
   last5GameStats:hist.slice(-5),playerAppearancesVerified:true,
   teamPassAttemptsPerGame:32,availability:'ROSTER_ACTIVE'};
 };
 const roster=[mk('A','a-rb','RB',{rush:16,rushYards:65,targets:2,catch:1,recYards:10}),
  mk('A','a-wr','WR',{targets:9,catch:6,recYards:75}),mk('A','a-te','TE',{targets:5,catch:3,recYards:37}),
  mk('A','a-wr2','WR',{targets:4,catch:2,recYards:26}),
  mk('B','b-qb','QB',{pass:34,passYards:245}),mk('B','b-rb','RB',{rush:17,rushYards:80}),
  mk('B','b-wr','WR',{targets:10,catch:7,recYards:90}),mk('B','b-te','TE',{targets:6,catch:4,recYards:48})];
 const sim=simulate(roster,1000,7);
 assert.equal(sim.teams.find(t=>t.team==='A').passVolumeSource,'VERIFIED_TEAM_PBP_NO_QB_PROPS');
 assert(!sim.markets.some(m=>m.team==='A'&&m.market==='passYards'));
 console.log('Immutable game-first research forecast capture tests passed');
}finally{fs.rmSync(dir,{recursive:true,force:true})}
