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
// Chronological score-accuracy benchmark against a fixed league-average
// forecast. Unlike a 50/50 winner benchmark, this tests the point forecasts.
const scored=report.rows.filter(r=>Number.isFinite(r.homeActual)&&Number.isFinite(r.awayActual)&&Number.isFinite(r.homeProjected)&&Number.isFinite(r.awayProjected));
if(scored.length){
 const first=40,hold=scored.slice(first);
 const mae=(rows,fn)=>rows.length?rows.reduce((sum,r)=>sum+fn(r),0)/(2*rows.length):null;
 report.scoreBenchmark={holdoutGames:hold.length,modelMAE:mae(hold,r=>Math.abs(r.homeActual-r.homeProjected)+Math.abs(r.awayActual-r.awayProjected)),leagueMeanMAE:mae(hold,r=>Math.abs(r.homeActual-112)+Math.abs(r.awayActual-112)),benchmark:'Fixed 112 points per team; diagnostic only',validatedForBetting:false};
}
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
console.log(JSON.stringify({games:report.games,brier:report.brier,benchmarkBrier:report.benchmarkBrier,beatsCoinFlip:report.beatsCoinFlip,scoreMAE:report.scoreMAE,chronologicalCalibration:{...report.chronologicalCalibration,rows:undefined},skipped:report.skipped,calibration:report.calibration},null,2));
