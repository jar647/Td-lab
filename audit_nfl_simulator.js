/* Evaluate the current production NFL bootstrap, using its real pool builder. */
'use strict';
const fs=require('node:fs'),engine=require('./game_odds_engine.js');
function probabilities(model,homeSpread,total){
 const rows=model.residuals.map(e=>{
  const h=Math.max(0,Math.round(model.projectedHome+e.homeError));
  const a=Math.max(0,Math.round(model.projectedAway+e.awayError));
  return {margin:h-a,total:h+a};
 });
 const probability=(key,line)=>{
  if(line===null||line===undefined)return null;
  const wins=rows.filter(r=>r[key]>line).length,losses=rows.filter(r=>r[key]<line).length;
  return {conditionalWin:wins+losses?wins/(wins+losses):.5,push:1-(wins+losses)/rows.length};
 };
 return {home_win:probability('margin',0),home_cover:probability('margin',homeSpread===null?null:-homeSpread),over:probability('total',total)};
}
function audit(history,marketRows){
 const markets=new Map(marketRows.map(r=>[r.game_id,r])),graded=[];
 for(const r of history.records||[]){
  if(r.season<2025)continue;
  // Recorded kickoff weather is realized, not a historical forecast; exclude it.
  const context={home_rest:r.home_rest,away_rest:r.away_rest,travel_miles:r.travel_miles};
  let model;
  try{model=engine.nflGame({game_id:r.game_id,home:r.home,away:r.away,
   projected_home_points:r.baseline_home,projected_away_points:r.baseline_away,
   model_inputs:{home:{games:5},away:{games:5},trust:{projection_basis:'SCORING_BASELINE'},residual_context:context}},history,{season:r.season,week:r.week});}
  catch(e){continue;}
  const market=markets.get(r.game_id),margin=market?.market_margin??null,total=market?.market_total??null;
  const p=probabilities(model,margin===null?null:-margin,total);
  const actualMargin=r.actual_home-r.actual_away,actualTotal=r.actual_home+r.actual_away;
  const outcomes={home_win:actualMargin,home_cover:margin===null?null:actualMargin-margin,over:total===null?null:actualTotal-total};
  const entry={game_id:r.game_id,residualGames:model.residuals.length,contextUsed:model.sample.residualContextUsed,markets:{}};
  for(const key of Object.keys(p))if(p[key]&&outcomes[key]!==null&&outcomes[key]!==0)
   entry.markets[key]={p:p[key].conditionalWin,y:outcomes[key]>0?1:0,push:p[key].push};
  graded.push(entry);
 }
 const results={};
 for(const key of ['home_win','home_cover','over']){
  const pairs=graded.flatMap(r=>r.markets[key]?[r.markets[key]]:[]);
  results[key]={games:pairs.length,brier:pairs.length?pairs.reduce((s,r)=>s+(r.p-r.y)**2,0)/pairs.length:null,bins:[]};
  for(let lo=0;lo<1;lo+=.1){const bucket=pairs.filter(r=>r.p>=lo&&r.p<lo+.10000001);
   if(bucket.length)results[key].bins.push({low:Math.round(lo*100),games:bucket.length,predicted:bucket.reduce((s,r)=>s+r.p,0)/bucket.length,observed:bucket.reduce((s,r)=>s+r.y,0)/bucket.length});}
 }
 return {status:'CURRENT_BOOTSTRAP_AUDIT_NOT_CALIBRATED',method:'Exact enumeration of centered, paired, rounded/clipped historical score residuals from CookGameOdds.nflGame; strict earlier-week filtering. Target rest/travel context only. Realized target weather excluded.',
  games:graded.length,contextMatchedGames:graded.filter(r=>r.contextUsed).length,results,
  limits:['Retrospective audit, not independent prospective validation.','Historical forecast-weather snapshots unavailable; production weather conditioning is not evaluated.','Historical lines are closing proxies, not verified execution prices.','Binary Brier scores exclude actual pushes and condition simulation probability on no push.'],records:graded};
}
if(require.main===module){
 const history=JSON.parse(fs.readFileSync('data/game_picks_backtest.json'));
 const comparison=JSON.parse(fs.readFileSync('data/nfl_score_model_audit.json'));
 const out=audit(history,comparison.records);
 fs.writeFileSync('data/game_picks_simulator_audit.json',JSON.stringify(out,null,2)+'\n');
 console.log(JSON.stringify({...out,records:undefined},null,2));
}
module.exports={probabilities,audit};
