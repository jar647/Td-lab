const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {estimate}=require('../first_td_probability.js');

const positions=['RB','WR','TE','QB'];
function fixture(){
 const league=[];
 for(let i=0;i<8;i++)for(const pos of positions)league.push({player:'League '+i+' '+pos,player_id:'L'+i+pos,team:'OFF'+i,opp:'DEF'+i,pos,market:'ATD',availability:'ROSTER_ACTIVE',games:6,playerRz:1,rzshare:25,tdallowed:.8,rzallowed:4});
 const game=[];
 for(const team of ['A','B'])for(let i=0;i<5;i++){
  const pos=positions[i%4],opp=team==='A'?'DEF-B':'DEF-A';
  game.push({player:team+' player '+i,player_id:team+i,team,opp,pos,market:'ATD',availability:'ROSTER_ACTIVE',playerAppearancesVerified:true,games:6,playerRz:i===0?2:1,rzshare:20,tdallowed:.8,rzallowed:4,goalLine5:.3,recentRz2:1,recentRz2Games:2});
 }
 return {game,all:[...league,...game]};
}

const {game,all}=fixture();
const result=estimate(game,all);
assert.equal(result.status,'uncalibrated');
assert.equal(result.players.length,10);
assert.equal(result.players[0].record.team,'A');
assert.ok(result.players[0].probability>result.players.at(-1).probability);
assert.ok(result.players.reduce((sum,p)=>sum+p.probability,0)<=1);
assert.match(result.reason,/not passed independent holdout calibration/);
const playerRows=game.map(r=>({...r}));
const baselineProbability=estimate(playerRows,all).players.find(p=>p.record.player_id==='A0').probability;
playerRows.find(r=>r.player_id==='A0').playerRz=3;
const increasedUseProbability=estimate(playerRows,all).players.find(p=>p.record.player_id==='A0').probability;
assert.ok(increasedUseProbability>baselineProbability,'higher red-zone workload should raise this player estimate');

const incomplete=game.map(r=>({...r}));
for(const r of incomplete.filter(x=>x.team==='B'))r.rzshare=8;
const insufficient=estimate(incomplete,all);
assert.equal(insufficient.status,'insufficient_data');
assert.match(insufficient.reason,/coverage is only/);

const injured=game.map(r=>({...r,availability:'OUT'}));
assert.equal(estimate(injured,all).status,'insufficient_data');

const ui=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
assert.match(ui,/<script src=\"\.\/first_td_probability\.js\"><\/script>/);
assert.match(ui,/FirstTDProbability\.estimate\(firstTdGameRecords,autoRecords\)/);
assert.match(ui,/BEST UNCALIBRATED ESTIMATE/);
assert.match(ui,/probabilities are uncalibrated and conditional on the listed players being available/);
console.log('First-TD probability model and NFL UI tests passed.');
