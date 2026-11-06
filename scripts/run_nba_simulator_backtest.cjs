const fs=require('node:fs');
const path=require('node:path');
const engine=require('../game_odds_engine.js');
const feed=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/nba_games.json'),'utf8'));
const report=engine.backtestNBA(feed,{minHistory:40,maxGames:120,draws:1000});
if(report.games<50){console.error(JSON.stringify({error:'Insufficient evaluated games',games:report.games,skipped:report.skipped}));process.exit(1);}

// Strictly chronological calibration: each test game's adjustment is fitted
// using earlier predictions and final results only. No future-game leakage.
function clamp(v,lo,hi){return Math.min(hi,Math.max(lo,v));}
function calibrationFit(rows){
 const n=rows.length;
 const xs=rows.map(r=>r.probability-.5),ys=rows.map(r=>r.outcome-.5);
 const denom=xs.reduce((a,x)=>a+x*x,0);
 // Regularize heavily for small samples and near-coinflip forecasts.
 const slope=denom>0?clamp(xs.reduce((a,x,i)=>a+x*ys[i],0)/(denom+2),0,2):0;
 const intercept=clamp(ys.reduce((a,y)=>a+y,0)/(n+40),-.1,.1);
 return {slope,intercept};
}
const calibrationRows=[];
const minimumTraining=40;
for(let i=minimumTraining;i<report.rows.length;i++){
 const past=report.rows.slice(0,i);
 const fit=calibrationFit(past);
 const game=report.rows[i];
 const adjusted=clamp(.5+fit.intercept+fit.slope*(game.probability-.5),.05,.95);
 calibrationRows.push({date:game.date,raw:game.probability,calibrated:adjusted,outcome:game.outcome,rawBrier:(game.probability-game.outcome)**2,calibratedBrier:(adjusted-game.outcome)**2,coinFlipBrier:.25});
}
const average=(xs)=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
// Strictly out-of-sample scoring benchmarks: each baseline uses earlier
// completed games only, never the result of the game being evaluated.
const scored=report.rows.filter(r=>['actualHome','actualAway','projectedHome','projectedAway'].every(k=>Number.isFinite(r[k])));
const hold=scored.slice(40);
const priorMean=(rows,key)=>rows.reduce((sum,r)=>sum+r[key],0)/rows.length;
const scoredHold=hold.map((r,i)=>{
 const prior=scored.slice(0,i+40);
 const homeBaseline=priorMean(prior,'actualHome'),awayBaseline=priorMean(prior,'actualAway');
 const modelError=(Math.abs(r.actualHome-r.projectedHome)+Math.abs(r.actualAway-r.projectedAway))/2;
 const baselineError=(Math.abs(r.actualHome-homeBaseline)+Math.abs(r.actualAway-awayBaseline))/2;
 return {date:r.date,modelError,baselineError};
});
report.scoreBenchmark={
 method:'Chronological expanding-window prior completed-game home/away scoring averages; 40-game initial history. No future results used.',
 holdoutGames:scoredHold.length,
 modelMAE:average(scoredHold.map(r=>r.modelError)),
 historicalMeanMAE:average(scoredHold.map(r=>r.baselineError)),
 beatsBaseline:scoredHold.length>=30?average(scoredHold.map(r=>r.modelError))<average(scoredHold.map(r=>r.baselineError)):null,
 validatedForBetting:false,
 rows:scoredHold
};
if(scoredHold.length<30)throw Error('Insufficient score benchmark holdout');
// Paired bootstrap uncertainty for the holdout improvement. A green workflow
// means the audit ran, not that an edge was established.
function pairedBootstrap(rows,fieldA,fieldB,reps=3000){
 const differences=rows.map(r=>r[fieldB]-r[fieldA]);
 if(differences.length<30)return {samples:differences.length,ci95:null,statisticallySupported:false};
 let seed=6472026;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
 const means=[];
 for(let j=0;j<reps;j++){let sum=0;for(let i=0;i<differences.length;i++)sum+=differences[Math.floor(random()*differences.length)];means.push(sum/differences.length);}
 means.sort((a,b)=>a-b);
 const ci95=[means[Math.floor(.025*reps)],means[Math.floor(.975*reps)]];
 return {samples:differences.length,improvement:average(differences),ci95,statisticallySupported:ci95[0]>0};
}
report.scoreBenchmark.uncertainty=pairedBootstrap(scoredHold,'modelError','baselineError');
// Evidence inventory: do not confuse final-game box scores with a dated
// pre-tip injury snapshot or an archived sportsbook closing market.
const games=(feed.games||[]).filter(g=>g.status==='STATUS_FINAL');
const isPresent=v=>v!==null&&v!==undefined&&v!==''&&!(Array.isArray(v)&&!v.length);
const hasDatedInjuries=g=>isPresent(g.pretip_injury_snapshot?.captured_at)&&isPresent(g.pretip_injury_snapshot?.players);
const hasClosingMarket=g=>isPresent(g.closing_market?.captured_at)&&Number.isFinite(Number(g.closing_market?.home_spread))&&Number.isFinite(Number(g.closing_market?.total))&&Number.isFinite(Number(g.closing_market?.home_moneyline))&&Number.isFinite(Number(g.closing_market?.away_moneyline));
report.evidenceCoverage={
 completedGames:games.length,
 datedPretipInjurySnapshots:games.filter(hasDatedInjuries).length,
 archivedClosingMarkets:games.filter(hasClosingMarket).length,
 injuryBacktestReady:games.filter(hasDatedInjuries).length>=50,
 marketBacktestReady:games.filter(hasClosingMarket).length>=50,
 definitions:{
  datedPretipInjurySnapshots:'pretip_injury_snapshot with captured_at and players; must be verified to precede game tip',
  archivedClosingMarkets:'closing_market with captured_at, home_spread, total, home_moneyline and away_moneyline; must be verified as pre-tip'
 }
};
report.accuracyGate={
 scoreBenchmarkPassed:report.scoreBenchmark.beatsBaseline,
 scoreImprovementSupported:report.scoreBenchmark.uncertainty.statisticallySupported,
 probabilityBeatsCoinFlip:report.brier<report.benchmarkBrier,
 liveInjuryAdjustedModelBacktested:false,
 historicalInjurySnapshotCoverage:report.evidenceCoverage.datedPretipInjurySnapshots,
 historicalClosingMarketCoverage:report.evidenceCoverage.archivedClosingMarkets,
 sportsbookClosingLineBenchmarkAvailable:false,
 validatedForBetting:false,
 reason:'Historical baseline evaluation does not validate the live injury-adjusted model or betting value; bootstrap uncertainty must also be considered.'
};
report.chronologicalCalibration={
 method:'Expanding-window, regularized linear probability calibration. Fit only to earlier completed predictions; 40-game minimum training. Evaluation is research-only.',
 trainingMinimum:minimumTraining,
 holdoutGames:calibrationRows.length,
 rawBrier:average(calibrationRows.map(r=>r.rawBrier)),
 calibratedBrier:average(calibrationRows.map(r=>r.calibratedBrier)),
 coinFlipBrier:average(calibrationRows.map(r=>r.coinFlipBrier)),
 improved:calibrationRows.length>=30?average(calibrationRows.map(r=>r.calibratedBrier))<average(calibrationRows.map(r=>r.rawBrier)):null,
 validatedForBetting:false,
 rows:calibrationRows
};
if(calibrationRows.length<30)throw Error('Insufficient chronological calibration holdout (need 30 games)');

const out=path.join(__dirname,'../data/nba_simulator_backtest.json');
fs.writeFileSync(out,JSON.stringify({...report,generatedAt:new Date().toISOString()},null,2)+'\n');
console.log(JSON.stringify({games:report.games,brier:report.brier,benchmarkBrier:report.benchmarkBrier,beatsCoinFlip:report.beatsCoinFlip,scoreMAE:report.scoreMAE,scoreBenchmark:{...report.scoreBenchmark,rows:undefined},accuracyGate:report.accuracyGate,evidenceCoverage:report.evidenceCoverage,chronologicalCalibration:{...report.chronologicalCalibration,rows:undefined},skipped:report.skipped,calibration:report.calibration},null,2));
