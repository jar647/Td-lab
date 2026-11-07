/* Offline evaluation of pregame NFL player-market forecasts.
   Inputs must be frozen BEFORE kickoff; results must come from completed games.
   This module does not fetch data or claim predictive validation. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.NFLBacktest=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
function evaluate(rows){
 if(!Array.isArray(rows)||!rows.length)throw Error('At least one settled prediction required');
 const seen=new Set(),group=new Map();
 for(const r of rows){
  if(!r||!r.gameId||!r.playerId||!r.market||!Number.isFinite(r.line)||!Number.isFinite(r.probability)||r.probability<0||r.probability>1||!Number.isFinite(r.actual)||!r.predictionFrozenAt||!r.kickoffAt||!r.resultRecordedAt)throw Error('Invalid or incomplete prediction record');
  const frozen=Date.parse(r.predictionFrozenAt),kickoff=Date.parse(r.kickoffAt),settled=Date.parse(r.resultRecordedAt);
  if(!Number.isFinite(frozen)||!Number.isFinite(kickoff)||!Number.isFinite(settled)||frozen>=kickoff||settled<kickoff)throw Error('Prediction must be frozen before kickoff and settled after kickoff');
  const id=JSON.stringify([r.gameId,r.playerId,r.market,r.line]);
  if(seen.has(id))throw Error('Duplicate prediction market');seen.add(id);
  const key=r.market,actual=r.actual>=r.line?1:0,error=r.probability-actual;
  const g=group.get(key)||{market:key,count:0,brierSum:0,probabilitySum:0,hits:0,absoluteErrorSum:0};
  g.count++;g.brierSum+=error*error;g.probabilitySum+=r.probability;g.hits+=actual;g.absoluteErrorSum+=Math.abs(error);group.set(key,g);
 }
 const summary=g=>({market:g.market,count:g.count,brierScore:g.brierSum/g.count,meanForecast:g.probabilitySum/g.count,observedHitRate:g.hits/g.count,meanAbsoluteProbabilityError:g.absoluteErrorSum/g.count});
 const overall=[...group.values()].reduce((a,g)=>({market:'ALL',count:a.count+g.count,brierSum:a.brierSum+g.brierSum,probabilitySum:a.probabilitySum+g.probabilitySum,hits:a.hits+g.hits,absoluteErrorSum:a.absoluteErrorSum+g.absoluteErrorSum}),{count:0,brierSum:0,probabilitySum:0,hits:0,absoluteErrorSum:0});
 return {status:'HISTORICAL_EVALUATION_ONLY',overall:summary(overall),byMarket:[...group.values()].map(summary).sort((a,b)=>a.market.localeCompare(b.market)),warning:'A passing evaluation does not prove calibration. Requires representative historical out-of-sample pregame snapshots and a benchmark.'};
}
return {evaluate};
});
