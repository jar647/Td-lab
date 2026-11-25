/* Audit an actual historical matchup without historical injury claims or odds inputs. */
'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),engine=require('../nba_possession_engine.js'),gameEngine=require('../game_odds_engine.js'),review=require('../game_odds_manual_review.js');
const feed=JSON.parse(fs.readFileSync('data/nba_games.json','utf8'));
const games=engine.records(feed,Infinity).slice(0,20);
let chosen;
for(const g of games){
 try{
  const now=Date.parse(g.date)-1,model=gameEngine.nbaGame(g,feed,{injuries:{injuries:[]},rosters:{},now,historical:true,integrateStrength:true});
  const a=model.possessionModel?.strengthAnchor;
  if(a&&Math.abs(a.targetMargin-a.originalMargin)>=2){chosen={g,model,a};break;}
 }catch(e){console.log('Fixture unavailable: '+g.id+' '+e.message);}
}
assert.ok(chosen,'No supported historical matchup with nontrivial adjustment');
const {g,model,a}=chosen;
assert.equal(a.version,'nba-possession-strength-events-v1');
assert.ok(Object.values(a.shotOffsets).every(x=>Math.abs(x)<=.025));
assert.ok(Math.abs(a.targetMargin-a.originalMargin)<=8.000001);
const snapshot=JSON.stringify(model),original={...model,possessionModel:{...model.possessionModel,strengthAnchor:null},strengthRequired:false};
const before=gameEngine.simulate(original,{},10000,6472026);
const small=gameEngine.simulate(model,{},10000,6472026);
const large=gameEngine.simulate(model,{},100000,6472026);
assert.equal(JSON.stringify(model),snapshot,'Simulation inputs mutated');
assert.equal(large.runCount,100000);assert.ok(large.audit.passed&&large.audit.playerScoreConservation&&large.audit.playerMinuteConservation);
assert.equal(large.possession.model,a.version);
const exact=Object.entries(large.scoreBins.margin).reduce((sum,[m,n])=>sum+Number(m)*n,0)/100000;
assert.ok(Math.abs(exact-large.projection.margin)<=.051);
assert.ok(Math.abs(small.projection.margin-large.projection.margin)<=2);
assert.ok(Math.abs(small.simulated.homeWin-large.simulated.homeWin)<=.03);
assert.ok((large.projection.margin-before.projection.margin)*(a.targetMargin-a.originalMargin)>0,'Scoring events did not move in the intended direction');
assert.equal(Object.values(large.scoreBins.margin).reduce((s,n)=>s+n,0),100000);
assert.equal(large.scoreBins.margin['0']||0,0,'NBA game cannot end in a tie');
const frozen=JSON.stringify(large.scoreBins);
const compared=review.analyze(model,large,{homeSpread:-3,homeATS:-110,awayATS:-110,homeML:-110,awayML:-110,total:220,over:-110,under:-110});
assert.equal(compared.rows.find(x=>x.key==='homeML').win,large.simulated.homeWin);
assert.equal(compared.rows.find(x=>x.key==='homeATS').push,(large.scoreBins.margin['3']||0)/100000);
assert.equal(JSON.stringify(large.scoreBins),frozen);
console.log(JSON.stringify({status:'PASS_COHERENT_OUTCOMES_NOT_VALIDATION',game:g.away+' @ '+g.home,original_margin:before.projection.margin,adjusted_margin:large.projection.margin,original_home_win:before.simulated.homeWin,adjusted_home_win:large.simulated.homeWin,draws:large.runCount,anchor:a,audit:large.audit},null,2));
