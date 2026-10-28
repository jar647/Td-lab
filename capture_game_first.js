#!/usr/bin/env node
/* Freeze game-first scenario forecasts before each game's UTC game day.
   Never overwrite a snapshot. This is RESEARCH ONLY, not a live bet feed.
   Comparable thresholds are paired with prior opportunity-model predictions,
   so future games can test the new model against a meaningful baseline.
*/
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const gameEngine=require('./nfl_game_engine.js');
const ROOT=__dirname;
const MODEL_VERSION='game-first-volume-v1';
const CODE_TO_KEY={PASS:'passYards',RUSH:'rushYards',REC:'recYards',CATCH:'receptions'};
const KEY_TO_CODE=Object.fromEntries(Object.entries(CODE_TO_KEY).map(([k,v])=>[v,k]));
const toNumber=x=>Number.isFinite(Number(x))?Number(x):null;
function freezeGame(game,allPlayers,prior,now,outputDir,runSim=gameEngine.simulate){
 const season=Number(game.season),week=Number(game.week),gameId=String(game.game_id);
 const gameday=String(game.gameday||'');
 const day=/^\d{4}-\d{2}-\d{2}$/.test(gameday)?gameday:gameday.slice(0,10);
 const cutoff=new Date(day+'T00:00:00.000Z');
 if(!Number.isFinite(cutoff.getTime())||!(now instanceof Date)||!Number.isFinite(now.getTime()))
  return {status:'INVALID_DATE'};
 if(now>=cutoff)return {status:'TOO_LATE_FOR_PREGAME_SNAPSHOT'};
 const target=path.join(outputDir,season+'-week-'+week+'-game-'+gameId+'.json');
 if(fs.existsSync(target))return {status:'ALREADY_FROZEN'};
 if(!prior||prior.game_id!==gameId||!Array.isArray(prior.predictions)||!prior.predictions.length)
  return {status:'BASELINE_SNAPSHOT_MISSING'};
 const players=allPlayers.filter(p=>
  (p.team===game.home&&p.opp===game.away)||(p.team===game.away&&p.opp===game.home));
 if(!players.length)return {status:'NO_MATCHUP_PLAYERS'};
 let model;
 try{model=runSim(players,10000,season*100+week,[])}
 catch(e){return {status:'SIMULATION_UNAVAILABLE',reason:String(e.message||e)}}
 const base=new Map(prior.predictions.map(p=>[
   String(p.player_id)+'|'+String(p.market)+'|'+String(p.threshold),
   p
 ]));
 const forecasts=[];
 for(const x of model.markets){
  const market=KEY_TO_CODE[x.market],threshold=x.line-.5;
  const b=base.get(x.id+'|'+market+'|'+threshold);
  if(!b||!Number.isFinite(Number(b.model_probability)))continue;
  const probability=x.scenarioRate,baseline=Number(b.model_probability);
  if(!(probability>0&&probability<1&&baseline>0&&baseline<1))continue;
  forecasts.push({
   player_id:x.id,player:x.name,team:x.team,position:x.pos,
   market,threshold,model_probability:probability,
   baseline_probability:baseline,
   scenario_count:model.count,
   model_mean:x.modeledMean,
   availability_at_capture:b.availability_at_capture||'UNVERIFIED',
   injury_report_at_capture:b.injury_report_at_capture||'NOT_REPORTED'
  });
 }
 if(!forecasts.length)return {status:'NO_COMMON_FORECAST_THRESHOLDS'};
 const snapshot={
  model_version:MODEL_VERSION,
  status:'RESEARCH_ONLY_UNCALIBRATED',bet_ready:false,
  season,week,game_id:gameId,home:game.home,away:game.away,
  captured_at_utc:now.toISOString(),
  conservative_game_day_cutoff_utc:cutoff.toISOString(),
  baseline_model_version:String(prior.model_version||'UNKNOWN'),
  threshold_policy:'Historically frozen fixed half-point thresholds; NOT quoted sportsbook lines',
  methodology:'Uncalibrated full-game Monte Carlo versus independently frozen prior opportunity model',
  teams:model.teams,
  predictions:forecasts
 };
 fs.mkdirSync(outputDir,{recursive:true});
 try{
  fs.writeFileSync(target,JSON.stringify(snapshot,null,2)+'\n',{flag:'wx'});
 }catch(e){
  if(e.code==='EEXIST')return {status:'ALREADY_FROZEN'};
  throw e;
 }
 return {status:'FROZEN',predictions:forecasts.length,path:target};
}
function main(){
 const data=path.join(ROOT,'data');
 const status=JSON.parse(fs.readFileSync(path.join(data,'status.json'),'utf8'));
 const games=JSON.parse(fs.readFileSync(path.join(data,'game_picks.json'),'utf8'));
 const players=JSON.parse(fs.readFileSync(path.join(data,'matchups.json'),'utf8'));
 const outputDir=path.join(data,'forward','game_first_snapshots');
 let made=0;
 const results=[];
 for(const fixture of games.games||[]){
  const game={...fixture,season:Number(status.season),week:Number(status.week)};
  const basename=status.season+'-week-'+status.week+'-game-'+fixture.game_id+'.json';
  const priorPath=path.join(data,'forward','prop_snapshots',basename);
  const prior=fs.existsSync(priorPath)?JSON.parse(fs.readFileSync(priorPath,'utf8')):null;
  const result=freezeGame(game,players,prior,new Date(),outputDir);
  results.push({game_id:fixture.game_id,home:fixture.home,away:fixture.away,
                status:result.status,reason:result.reason||null,
                new_forecasts:result.predictions||0});
  console.log(fixture.game_id,result.status,result.predictions||'',result.reason||'');
  if(result.status==='FROZEN')made++;
 }
 fs.mkdirSync(outputDir,{recursive:true});
 const prefix=status.season+'-week-'+status.week+'-game-';
 const frozen=fs.readdirSync(outputDir).filter(name=>name.startsWith(prefix)&&name.endsWith('.json'));
 const summary={status:'RESEARCH_ONLY_UNCALIBRATED',bet_ready:false,
  model_version:MODEL_VERSION,generated_at_utc:new Date().toISOString(),
  season:Number(status.season),week:Number(status.week),fixtures:(games.games||[]).length,
  frozen_game_snapshots:frozen.length,newly_frozen:made,results,
  note:'Pregame Monte Carlo forecasts stored immutably. Success is data capture, not calibrated probability or betting approval.'};
 const reportPath=path.join(data,'forward','game_first_capture_status.json');
 fs.writeFileSync(reportPath,JSON.stringify(summary,null,2)+'\n');
 console.log('Game-first prospective captures:',frozen.length,'of',summary.fixtures,'fixtures');

}
if(require.main===module)main();
module.exports={freezeGame,MODEL_VERSION};
