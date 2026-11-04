'use strict';const fs=require('fs');
const avg=xs=>xs.length?xs.reduce((s,x)=>s+x,0)/xs.length:null;
function compare(before,after){
 const key=r=>[r.game,r.playerId||r.player,r.market].join('|'),old=new Map(before.observations.filter(r=>r.fold==='validation'&&r.active).map(r=>[key(r),r]));
 const paired=after.observations.filter(r=>r.fold==='validation'&&r.active&&old.has(key(r))),games=[...new Set(paired.map(r=>r.game))];
 const metrics={};for(const market of ['points','rebounds','assists','minutes']){const rows=paired.filter(r=>r.market===market);metrics[market]={n:rows.length,beforeMae:avg(rows.map(r=>Math.abs(old.get(key(r)).prediction-r.actual))),afterMae:avg(rows.map(r=>Math.abs(r.prediction-r.actual))),recentAverageMae:avg(rows.map(r=>Math.abs(r.baseline-r.actual)))};}
 const reb=paired.filter(r=>r.market==='rebounds'),deltas=games.map(game=>{const rows=reb.filter(r=>r.game===game);return avg(rows.map(r=>Math.abs(old.get(key(r)).prediction-r.actual)-Math.abs(r.prediction-r.actual)))}).filter(Number.isFinite);
 let seed=6472026;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296},boot=Array.from({length:10000},()=>avg(deltas.map(()=>deltas[Math.floor(random()*deltas.length)]))).sort((a,b)=>a-b);
 const checks={reboundMaeImproved:metrics.rebounds.afterMae<metrics.rebounds.beforeMae,pointsRegressionWithinPointOne:metrics.points.afterMae<=metrics.points.beforeMae+.1,assistsRegressionWithinPointZeroFive:metrics.assists.afterMae<=metrics.assists.beforeMae+.05,minutesRegressionWithinPointOne:metrics.minutes.afterMae<=metrics.minutes.beforeMae+.1,sufficientMatchedGames:games.length>=10};
 return {beforeModel:before.model,afterModel:after.model,splitDate:after.splitDate,matchedValidationGames:games.length,metrics,reboundGameClusterBootstrap:{resamples:10000,meanGameMaeReduction:avg(deltas),interval95:[boot[250],boot[9749]],note:'Internal retrospective uncertainty only; not evidence of a betting edge.'},gameTotals:{before:before.folds.validation.gameTotals,after:after.folds.validation.gameTotals},checks,passed:Object.values(checks).every(Boolean),engineeringLimits:'Regression tripwires against the prior simulator, not statistical certification or baseline superiority.',limitations:after.limitations};
}
if(require.main===module){const r=compare(...process.argv.slice(2,4).map(p=>JSON.parse(fs.readFileSync(p))));if(process.argv[4])fs.writeFileSync(process.argv[4],JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify(r,null,2));if(!r.passed)process.exitCode=1;}
module.exports={compare};
