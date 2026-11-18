/* Market-specific retrospective evidence. Never promotes prop confidence. */
'use strict';
const fs=require('fs');
const {compare}=require('./compare_nba_projection_audits');
const markets=['points','rebounds','assists','minutes'];
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const avg=rows=>rows.length?rows.reduce((sum,x)=>sum+x,0)/rows.length:null;
function marketSummary(audit,market,fold){
 const rows=(audit.observations||[]).filter(r=>r.market===market&&r.fold===fold&&r.active&&[r.actual,r.prediction,r.baseline].every(finite));
 const errors=rows.map(r=>Math.abs(r.prediction-r.actual)),baselineErrors=rows.map(r=>Math.abs(r.baseline-r.actual));
 const grouped=new Map();
 for(const r of rows){if(!grouped.has(r.game))grouped.set(r.game,[]);grouped.get(r.game).push(Math.abs(r.baseline-r.actual)-Math.abs(r.prediction-r.actual));}
 const deltas=[...grouped.values()].map(avg);
 let state=6472026;
 const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
 const boot=deltas.length?Array.from({length:10000},()=>avg(deltas.map(()=>deltas[Math.floor(random()*deltas.length)]))).sort((a,b)=>a-b):[];
 const mae=avg(errors),baselineMae=avg(baselineErrors);
 return {observations:rows.length,games:grouped.size,playerGames:new Set(rows.map(r=>r.game+'|'+(r.playerId||r.player))).size,
  mae,recentAverageMae:baselineMae,bias:avg(rows.map(r=>r.prediction-r.actual)),maeReductionVersusRecentAverage:mae===null?null:baselineMae-mae,
  gameClusterMeanMaeReduction:avg(deltas),gameClusterInterval95:boot.length?[boot[250],boot[9749]]:[null,null],beatsRecentAverage:mae!==null&&mae<baselineMae,
  evidenceStatus:grouped.size<10?'INSUFFICIENT_MATCHED_GAMES':mae<baselineMae?'RETROSPECTIVE_POINT_ESTIMATE_ONLY':'RECENT_AVERAGE_BASELINE_NOT_BEATEN'};
}
function summarize(current,legacy,options={}){
 const comparison=legacy?compare(legacy,current):null;
 return {status:'UNVALIDATED_NO_CONFIDENCE_PROMOTION',model:current.model,sourceGeneratedAt:current.sourceGeneratedAt,
  splitDate:current.splitDate,runs:current.runs,sourceEvidence:options.sourceEvidence||null,
  markets:Object.fromEntries(markets.map(m=>[m,{development:marketSummary(current,m,'development'),validation:marketSummary(current,m,'validation')}])),
  legacyComparison:comparison?{beforeModel:comparison.beforeModel,afterModel:comparison.afterModel,matchedValidationGames:comparison.matchedValidationGames,
   reboundMaeImproved:comparison.checks.reboundMaeImproved,strictBenchmarkPassed:comparison.passed,metrics:comparison.metrics,gameClusterInterval95:comparison.reboundGameClusterBootstrap.interval95}:null,
  recommendationChangesApproved:false,probabilitiesCalibrated:false,
  method:'Existing walk-forward audit only: each prediction uses earlier box scores with a four-hour completion buffer; fixed chronological development/validation split. Compare each market separately against the earlier five-appearance mean and the unchanged historic simulator benchmark. No weights fitted or selected on the held-out results.',
  limits:['This audits stat forecast errors, not the hit rate of a selected alternate line.',
   'Historical injury announcements, confirmed lineups and true tracking opportunities are unavailable; this does not validate today’s injury-aware forecasts.',
   'Player/game outcomes are related; uncertainty is resampled by game, not by individual market row.',
   'A passing non-regression check for unchanged code is not a passing historic improvement benchmark or a calibrated betting probability.']};
}
if(require.main===module){
 const [currentFile,legacyFile,output,evidenceFile]=process.argv.slice(2);
 const report=summarize(JSON.parse(fs.readFileSync(currentFile)),legacyFile?JSON.parse(fs.readFileSync(legacyFile)):null,
  {sourceEvidence:evidenceFile?JSON.parse(fs.readFileSync(evidenceFile)):null});
 if(output)fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
}
module.exports={summarize,marketSummary};
