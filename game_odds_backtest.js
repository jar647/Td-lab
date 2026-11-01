/* Exact production-engine walk-forward probability audit. No fitted parameters. */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const engine=require('./game_odds_engine.js');

function assess(rows,key){
 const available=rows.filter(r=>r.markets[key]);
 const settled=available.filter(r=>r.markets[key].outcome!=='push');
 const scored=settled.map(r=>{
  const m=r.markets[key],den=m.win+m.loss;
  return {...m,p:den?m.win/den:.5,y:m.outcome==='win'?1:0};
 });
 const average=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
 const bins=[];
 for(let lo=0;lo<10;lo++){
  const group=scored.filter(m=>Math.min(9,Math.floor(m.p*10))===lo);
  if(!group.length)continue;
  const n=group.length,actual=average(group.map(m=>m.y)),z=1.96,den=1+z*z/n;
  const mid=(actual+z*z/(2*n))/den,err=z*Math.sqrt(actual*(1-actual)/n+z*z/(4*n*n))/den;
  bins.push({range:`${lo*10}-${(lo+1)*10}%`,n,predicted:average(group.map(m=>m.p)),actual,
   observed95:[Math.max(0,mid-err),Math.min(1,mid+err)]});
 }
 const quoted=scored.filter(m=>m.noVig!==null);
 const selections=available.map(r=>r.markets[key]).filter(m=>m.price!==null&&m.price>=-200&&m.ev>=.05&&m.modelEdge>=.025);
 const profit=selections.reduce((sum,m)=>sum+(m.outcome==='push'?0:m.outcome==='loss'?-1:m.price>0?m.price/100:100/-m.price),0);
 const score=(m,p)=>Math.pow(p-m.y,2);
 return {games:available.length,settledGames:scored.length,pushes:available.length-settled.length,
  brier:average(scored.map(m=>score(m,m.p))),
  logLoss:average(scored.map(m=>-Math.log(Math.max(1e-12,m.y?m.p:1-m.p)))),
  accuracy:average(scored.map(m=>Number((m.p>=.5)===Boolean(m.y)))),
  threeOutcomeBrier:average(available.map(r=>{
   const m=r.markets[key];return ['win','loss','push'].reduce((s,k)=>s+Math.pow(m[k]-Number(m.outcome===k),2),0);
  })),
  marketComparison:{games:quoted.length,modelBrier:average(quoted.map(m=>score(m,m.p))),
   noVigMarketBrier:average(quoted.map(m=>score(m,m.noVig)))},
  hypotheticalClosingPriceSelections:{bets:selections.length,netUnits:profit,roi:selections.length?profit/selections.length:null},bins};
}

function audit(backtest,marketReport,{count=100000,seed=6472026,holdoutStart=2025}={}){
 if(backtest.model_version!==engine.NFL_MODEL_VERSION||marketReport.model_version!==engine.NFL_MODEL_VERSION)
  throw Error('Regenerate scoring and market reports with the current model before auditing');
 const ids=new Set();
 const input=[...backtest.records].sort((a,b)=>a.season-b.season||a.week-b.week||String(a.game_id).localeCompare(String(b.game_id)));
 const marketById=new Map(marketReport.records.map(r=>[r.game_id,r]));
 const records=[],skipped=[];
 for(const r of input){
  if(ids.has(r.game_id))throw Error('Duplicate game id: '+r.game_id);
  ids.add(r.game_id);
  if(require.main===module&&ids.size%50===0)console.error('Auditing game '+ids.size+' / '+input.length);
  for(const k of ['season','week','actual_home','actual_away'])
   if(typeof r[k]!=='number'||!Number.isFinite(r[k]))throw Error('Invalid '+k+' for '+r.game_id);
  const source=marketById.get(r.game_id)||{};
  const game={game_id:r.game_id,model_version:r.model_version,home:r.home,away:r.away,gameday:r.gameday,
   projected_home_points:r.projected_home,projected_away_points:r.projected_away,
   model_inputs:{home:{games:r.home_games},away:{games:r.away_games},
    // Observed target weather/roof is not an archived pregame forecast.
    residual_context:{home_rest:r.home_rest,away_rest:r.away_rest,travel_miles:r.travel_miles}}};
  let model;
  try{model=engine.nflGame(game,backtest,{season:r.season,week:r.week});}
  catch(error){
   if(!/Insufficient earlier/.test(error.message))throw error;
   skipped.push({game_id:r.game_id,reason:error.message});continue;
  }
  const market={homeSpread:source.market_home_spread,total:source.market_total,
   homeML:source.home_moneyline,awayML:source.away_moneyline,
   homeATS:source.market_home_spread==null?null:source.home_spread_odds,
   awayATS:source.market_home_spread==null?null:source.away_spread_odds,
   over:source.market_total==null?null:source.over_odds,under:source.market_total==null?null:source.under_odds};
  const result=engine.simulate(model,market,count,seed);
  const margin=r.actual_home-r.actual_away,total=r.actual_home+r.actual_away;
  const outcomes={homeML:margin,awayML:-margin,homeATS:margin+market.homeSpread,
   awayATS:-margin-market.homeSpread,over:total-market.total,under:market.total-total};
  records.push({game_id:r.game_id,season:r.season,week:r.week,model_version:r.model_version,
   sample:result.sample,projection:result.projection,marketSource:source.market_source||null,
   actualMargin:margin,actualTotal:total,
   markets:Object.fromEntries(result.markets.map(m=>[m.key,{win:m.win,loss:m.loss,push:m.push,price:m.price,
    noVig:m.noVig,ev:m.ev,modelEdge:m.modelEdge,
    outcome:outcomes[m.key]===0?'push':outcomes[m.key]>0?'win':'loss'}]))});
 }
 const summarize=rows=>({games:rows.length,
  marginMAE:rows.length?rows.reduce((s,r)=>s+Math.abs(r.projection.margin-r.actualMargin),0)/rows.length:null,
  totalMAE:rows.length?rows.reduce((s,r)=>s+Math.abs(r.projection.total-r.actualTotal),0)/rows.length:null,
  markets:Object.fromEntries(['homeML','homeATS','over'].map(k=>[k,assess(rows,k)]))});
 return {status:'EXACT_ENGINE_WALK_FORWARD_UNCALIBRATED',model_version:engine.NFL_MODEL_VERSION,
  simulation:{count,seed},holdoutStart,
  method:'Production nflGame() and simulate(); each target uses only earlier seasons/weeks of paired errors. No fitted parameters or calibration.',
  limits:['Historical schedule prices are closing proxies, not executable pregame quotes.',
   'Archived historical pregame weather forecasts are unavailable; target weather/roof matching is disabled.',
   'Binary metrics condition on no push; three-outcome Brier includes pushes. Market Brier uses identical quoted settled games.',
   'Historical inputs may be revised. Walk-forward reuse is not an untouched holdout after model development.',
   'Research price selection uses EV >=5%, probability difference >=2.5 points and odds >=-200. No recommendation gate is enabled.'],
  overall:summarize(records),holdout:summarize(records.filter(r=>r.season>=holdoutStart)),
  bySeason:Object.fromEntries([...new Set(records.map(r=>r.season))].map(s=>[s,summarize(records.filter(r=>r.season===s))])),
  skipped,records};
}

if(require.main===module){
 const report=audit(JSON.parse(fs.readFileSync(process.argv[2]||'data/game_picks_backtest.json','utf8')),
  JSON.parse(fs.readFileSync(process.argv[3]||'data/game_picks_market_comparison.json','utf8')));
 const output=process.argv[4]||'data/game_picks_simulator_audit.json';
 fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
 const {status,model_version,holdoutStart,holdout,simulation,limits}=report;
 fs.writeFileSync(path.join(path.dirname(output),'game_picks_validation_summary.json'),
  JSON.stringify({status,model_version,holdoutStart,holdout,simulation,limits},null,2)+'\n');
 console.log(JSON.stringify({status:report.status,model_version:report.model_version,holdout:report.holdout,skipped:report.skipped.length},null,2));
}
module.exports={audit,assess};
