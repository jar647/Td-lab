const fs=require('node:fs');
const assert=require('node:assert/strict');
const engine=require('../nba_possession_engine.js');
const feed=JSON.parse(fs.readFileSync('data/nba_games.json','utf8'));
const games=(feed.games||[]).filter(g=>g.status==='STATUS_FINAL'&&Number(g.season_type)===2).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
let result=null,attempts=0;
for(let i=Math.max(8,games.length-35);i<games.length;i++){
 const game=games[i];attempts++;
 try{
  const model=engine.build(game,{games:games.slice(0,i)},{injuries:[]},{},Date.parse(game.date)-1000,{historical:true});
  const team=game.home,player=model.teams[team].players.find(p=>(model.teams[team].minutes[p.id]||0)>=12);
  if(!player)continue;
  result=engine.injurySensitivity(model,team,player.id,{count:1000,seed:6472026});
  assert.equal(result.historicallyValidated,false);
  assert.ok(Number.isFinite(result.teamPointDelta));
  assert.ok(Number.isFinite(result.opponentPointDelta));
  assert.ok(result.replacementMinutes.length>0);
  const redistributed=result.replacementMinutes.reduce((sum,p)=>sum+p.delta,0);
  assert.ok(Math.abs(redistributed-result.removedMinutes)<0.01,'Missing rotation minutes');
  break;
 }catch(e){if(e.code==='ERR_ASSERTION')throw e;}
}
if(!result)throw Error('No complete historical NBA game supports injury sensitivity test across '+attempts+' attempts');
console.log(JSON.stringify({passed:true,gameCount:games.length,attempts,team:result.team,player:result.player,removedMinutes:result.removedMinutes,teamPointDelta:result.teamPointDelta,replacementCount:result.replacementMinutes.length,validatedForBetting:false}));
