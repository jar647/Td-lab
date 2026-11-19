'use strict';
const fs=require('fs');
const avg=xs=>xs.length?xs.reduce((sum,x)=>sum+x,0)/xs.length:null;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const markets=['points','rebounds','assists','minutes'];

function compare(before,after,options={}){
 const mode=options.mode||'historical_improvement';
 if(!['historical_improvement','non_regression'].includes(mode))throw Error('Unknown NBA audit comparison mode');
 const key=r=>[r.game,r.playerId||r.player,r.market].join('|');
 const old=new Map(),seen=new Set();let duplicates=0,invalid=0,mismatched=0;
 for(const r of before.observations||[]){
  if(r.fold!=='validation'||!r.active)continue;
  if(old.has(key(r)))duplicates++;
  old.set(key(r),r);
 }
 const paired=[];
 for(const r of after.observations||[]){
  if(r.fold!=='validation'||!r.active||!old.has(key(r)))continue;
  if(seen.has(key(r))){duplicates++;continue}seen.add(key(r));
  const prior=old.get(key(r));
  if(![r.prediction,r.actual,r.baseline,prior.prediction,prior.actual].every(finite)){invalid++;continue}
  if(r.actual!==prior.actual){mismatched++;continue}
  paired.push(r);
 }
 const games=[...new Set(paired.map(r=>r.game))],metrics={};
 for(const market of markets){
  const rows=paired.filter(r=>r.market===market);
  metrics[market]={n:rows.length,games:new Set(rows.map(r=>r.game)).size,beforeMae:avg(rows.map(r=>Math.abs(old.get(key(r)).prediction-r.actual))),
   afterMae:avg(rows.map(r=>Math.abs(r.prediction-r.actual))),recentAverageMae:avg(rows.map(r=>Math.abs(r.baseline-r.actual)))};
 }
 const reb=paired.filter(r=>r.market==='rebounds');
 const deltas=games.map(game=>{
  const rows=reb.filter(r=>r.game===game);
  return avg(rows.map(r=>Math.abs(old.get(key(r)).prediction-r.actual)-Math.abs(r.prediction-r.actual)));
 }).filter(finite);
 let seed=6472026;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
 const boot=deltas.length?Array.from({length:10000},()=>avg(deltas.map(()=>deltas[Math.floor(random()*deltas.length)]))).sort((a,b)=>a-b):[];
 const checks={sufficientMatchedGames:games.length>=10,
  sufficientGamesPerMarket:markets.every(m=>metrics[m].games>=10),
  completeFiniteMarkets:markets.every(m=>metrics[m].n>0&&[metrics[m].beforeMae,metrics[m].afterMae,metrics[m].recentAverageMae].every(finite)),
  coherentMatchedObservations:duplicates===0&&invalid===0&&mismatched===0&&before.splitDate===after.splitDate&&before.runs===after.runs&&before.sourceGeneratedAt===after.sourceGeneratedAt};
 if(mode==='non_regression'){
  // An unchanged model may be identical. No market may get worse.
  const currentKeys=new Set((after.observations||[]).filter(r=>r.fold==='validation'&&r.active).map(key));
  checks.activeValidationCoverageMatches=currentKeys.size===old.size&&[...old.keys()].every(id=>currentKeys.has(id));
  for(const market of markets)checks[market+'MaeDidNotWorsen']=finite(metrics[market].afterMae)&&finite(metrics[market].beforeMae)&&metrics[market].afterMae<=metrics[market].beforeMae;
 }else{
  // Preserve the original improvement/regression tripwires for model changes.
  Object.assign(checks,{
   reboundMaeImproved:finite(metrics.rebounds.afterMae)&&finite(metrics.rebounds.beforeMae)&&metrics.rebounds.afterMae<metrics.rebounds.beforeMae,
   pointsRegressionWithinPointOne:finite(metrics.points.afterMae)&&finite(metrics.points.beforeMae)&&metrics.points.afterMae<=metrics.points.beforeMae+.1,
   assistsRegressionWithinPointZeroFive:finite(metrics.assists.afterMae)&&finite(metrics.assists.beforeMae)&&metrics.assists.afterMae<=metrics.assists.beforeMae+.05,
   minutesRegressionWithinPointOne:finite(metrics.minutes.afterMae)&&finite(metrics.minutes.beforeMae)&&metrics.minutes.afterMae<=metrics.minutes.beforeMae+.1});
 }
 return {comparisonMode:mode,beforeModel:before.model,afterModel:after.model,splitDate:after.splitDate,
  matchedValidationGames:games.length,metrics,observationChecks:{duplicateRows:duplicates,invalidRows:invalid,actualMismatches:mismatched},
  reboundGameClusterBootstrap:{resamples:10000,meanGameMaeReduction:avg(deltas),interval95:boot.length?[boot[250],boot[9749]]:[null,null],note:'Internal retrospective uncertainty only; not evidence of a betting edge.'},
  gameTotals:{before:before.folds?.validation?.gameTotals||null,after:after.folds?.validation?.gameTotals||null},
  checks,passed:Object.values(checks).every(Boolean),promotionEligible:false,
  engineeringLimits:mode==='non_regression'?'Zero-tolerance paired error regression check against the actual PR base; equality does not establish historical superiority or calibration.':'Original improvement tripwires against the older simulator; not statistical certification or baseline superiority.',
  limitations:after.limitations};
}
if(require.main===module){
 const [beforeFile,afterFile,output,mode]=process.argv.slice(2);
 const report=compare(JSON.parse(fs.readFileSync(beforeFile)),JSON.parse(fs.readFileSync(afterFile)),{mode});
 if(output)fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
 if(!report.passed)process.exitCode=1;
}
module.exports={compare};
