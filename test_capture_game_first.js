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
 console.log('Immutable game-first research forecast capture tests passed');
}finally{fs.rmSync(dir,{recursive:true,force:true})}
