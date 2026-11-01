'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const engine=require('./game_odds_engine.js');

function captureAndGrade(slate,history,previous,results,now=new Date(),signature='unknown',count=10000){
 const stamp=now.toISOString(),time=now.getTime();
 const records=JSON.parse(JSON.stringify(previous?.records||[]));
 const keys=new Set(records.map(r=>r.key));
 if(keys.size!==records.length)throw Error('Duplicate frozen forecast keys');
 for(const g of slate.games||[]){
  const key=g.model_version+'|'+g.game_id,kickoff=Date.parse(g.kickoff_at);
  if(keys.has(key)||!Number.isFinite(kickoff)||kickoff<=time)continue;
  const generated=Date.parse(slate.generated_at);
  if(!Number.isFinite(generated)||generated>time||time-generated>24*3600000)continue;
  if(g.model_version!=='score-baseline-trust-v3'||g.model_inputs?.trust?.source_status!=='RECONCILED')continue;
  const model=engine.nflGame(g,history,{season:slate.season,week:slate.week,generatedAt:slate.generated_at});
  const sim=engine.simulate(model,{},count,6472026);
  records.push({key,game_id:g.game_id,model_version:g.model_version,model_signature:signature,
   captured_at:stamp,kickoff_at:g.kickoff_at,feed_generated_at:slate.generated_at,
   source_sha256:g.model_inputs.trust.source_sha256,
   home:g.home,away:g.away,projection:sim.projection,
   home_win_probability:sim.simulated.homeWin/(sim.simulated.homeWin+sim.simulated.awayWin),
   probability_definition:'Home win conditional on non-tie; ties excluded from winner grading.',
   draws:count,seed:6472026,qb_context:Object.fromEntries(Object.entries(g.model_inputs.trust.qb_context||{}).map(([t,q])=>[t,{player:q.player||null,status:q.status}])),
   status:'FROZEN_BEFORE_KICKOFF',result:null});
  keys.add(key);
 }
 for(const r of records){
  if(r.result||Date.parse(r.captured_at)>=Date.parse(r.kickoff_at))continue;
  const score=results.games?.[r.game_id];
  if(!score||!Number.isFinite(score.home)||!Number.isFinite(score.away)||Date.parse(r.kickoff_at)>=time)continue;
  const actualMargin=score.home-score.away,actualTotal=score.home+score.away;
  r.result={graded_at:stamp,home:score.home,away:score.away,
   margin_error:r.projection.margin-actualMargin,total_error:r.projection.total-actualTotal,
   brier:actualMargin===0?null:(r.home_win_probability-(actualMargin>0?1:0))**2,
   home_won:actualMargin===0?null:actualMargin>0};
 }
 const graded=records.filter(r=>r.result),winner=graded.filter(r=>r.result.brier!==null);
 const avg=(xs,fn)=>xs.length?xs.reduce((sum,r)=>sum+fn(r),0)/xs.length:null;
 const signatures=[...new Set(records.map(r=>r.model_signature))];
 const bySignature=Object.fromEntries(signatures.map(sig=>{const own=records.filter(r=>r.model_signature===sig),done=own.filter(r=>r.result),wins=done.filter(r=>r.result.brier!==null);return [sig,{frozen:own.length,graded:done.length,margin_mae:avg(done,r=>Math.abs(r.result.margin_error)),total_mae:avg(done,r=>Math.abs(r.result.total_error)),brier:avg(wins,r=>r.result.brier)}]}));
 const bins=Array.from({length:5},(_,i)=>{const rows=winner.filter(r=>Math.min(4,Math.floor(r.home_win_probability*5))===i);return {range:[i/5,(i+1)/5],games:rows.length,mean_forecast:avg(rows,r=>r.home_win_probability),actual_home_win_rate:avg(rows,r=>Number(r.result.home_won))};});
 return {status:'PROSPECTIVE_RESEARCH_NOT_CALIBRATED',updated_at:stamp,
  method:'First audited baseline forecast per game/model frozen before verified scheduled kickoff. Existing predictions are never replaced. Results graded next calendar day from schedule finals; no historical backfill.',
  summary:{frozen:records.length,graded:graded.length,non_tie_winner_games:winner.length,
   margin_mae:avg(graded,r=>Math.abs(r.result.margin_error)),total_mae:avg(graded,r=>Math.abs(r.result.total_error)),
   brier:avg(winner,r=>r.result.brier),calibration:bins,by_model_signature:bySignature,scope:'Aggregate research scorecard; compare per-signature groups when model code changes.'},records};
}
if(require.main===module){
 const read=(p,fallback)=>fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):fallback;
 const signature=crypto.createHash('sha256').update(['game_picks.py','game_context.py','game_trust.py','nfl_weather.py','game_odds_engine.js'].map(p=>fs.readFileSync(p,'utf8')).join('\n')).digest('hex');
 const out=captureAndGrade(read('data/game_picks.json',{}),read('data/game_picks_backtest.json',{}),
  read('data/game_score_forecasts.json',{}),read('data/game_score_results.json',{}),new Date(),signature);
 fs.writeFileSync('data/game_score_forecasts.json.tmp',JSON.stringify(out,null,2));
 fs.renameSync('data/game_score_forecasts.json.tmp','data/game_score_forecasts.json');
 console.log(JSON.stringify(out.summary));
}
module.exports={captureAndGrade};
