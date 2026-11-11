/* Score frozen winner probabilities only on eligible historical bouts.
   Scores do not establish calibration or betting edge. */
(function(root,factory){
 const evaluator=typeof module==='object'&&module.exports?require('./ufc_backtest_evaluator.js'):root.UFCBacktestEvaluator;
 const api=factory(evaluator);
 if(typeof module==='object'&&module.exports)module.exports=api;
 root.UFCProbabilityBacktest=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(evaluator){
 'use strict';
 function score(bouts,snapshotsByBout,predictionsByBout){
  const audit=evaluator.evaluate(bouts,snapshotsByBout,predictionsByBout);
  const byId=new Map((Array.isArray(bouts)?bouts:[]).map(b=>[String(b?.bout_id||'').trim(),b]));
  let brierSum=0,logSum=0,scored=0;const brierValues=[],logValues=[];
  const bins=Array.from({length:10},(_,i)=>({lower:i/10,upper:(i+1)/10,count:0,probabilitySum:0,outcomeSum:0}));
  const rows=audit.rows.map(row=>{
   if(!row.eligible)return {...row,probabilityScored:false};
   const prediction=predictionsByBout?.[row.bout_id];
   const p=prediction?.winner_probability;
   if(typeof p!=='number'||!Number.isFinite(p)||p<0||p>1)return {...row,probabilityScored:false,probabilityError:'missing_or_invalid_frozen_probability'};
   const bout=byId.get(row.bout_id);
   const outcome=String(prediction.winner_id)===String(bout.winner)?1:0;
   const brier=(p-outcome)**2;
   const eps=1e-15;
   const logLoss=-(outcome*Math.log(Math.max(eps,p))+(1-outcome)*Math.log(Math.max(eps,1-p)));
   brierSum+=brier;logSum+=logLoss;scored++;brierValues.push(brier);logValues.push(logLoss);
   const bin=bins[Math.min(9,Math.floor(p*10))];bin.count++;bin.probabilitySum+=p;bin.outcomeSum+=outcome;
   return {...row,probabilityScored:true,probability:p,outcome,brier,logLoss};
  });
  // A historical bout with verified pre-fight snapshots but no frozen pick counts as uncovered,
  // not as a scored forecast or an excluded fight.
  const missingPickErrors=new Set(['missing_frozen_prediction_timestamp','invalid_predicted_winner']);
  const coverageEligible=row=>row.eligible||(!row.eligible&&row.errors.length>0&&row.errors.every(error=>missingPickErrors.has(error)));
  const eligibleCount=rows.filter(coverageEligible).length;
  const missingFrozenPrediction=rows.filter(row=>coverageEligible(row)&&!row.eligible).length;
  const invalidFrozenProbability=rows.filter(row=>row.eligible&&!row.probabilityScored).length;
  const excludedByReason={};
  for(const row of rows){if(coverageEligible(row))continue;
   for(const reason of new Set(row.errors.filter(error=>!missingPickErrors.has(error))))excludedByReason[reason]=(excludedByReason[reason]||0)+1;
  }
  // Wilson intervals describe uncertainty in observed bin win rates, not model calibration.
  // Empty bins have no interval; tiny bins must not imply precise reliability.
  const wilson95=(wins,n)=>{
   if(!n)return null;
   const z=1.959963984540054,rate=wins/n,z2=z*z,denom=1+z2/n;
   const center=(rate+z2/(2*n))/denom;
   const margin=z*Math.sqrt(rate*(1-rate)/n+z2/(4*n*n))/denom;
   return [Math.max(0,center-margin),Math.min(1,center+margin)];
  };
  // In-sample reliability diagnostics, not evidence of validated calibration.
  const occupied=bins.filter(bin=>bin.count>0);
  const expectedCalibrationError=scored?occupied.reduce((sum,bin)=>sum+(bin.count/scored)*Math.abs(bin.probabilitySum/bin.count-bin.outcomeSum/bin.count),0):null;
  const maxCalibrationError=scored?Math.max(...occupied.map(bin=>Math.abs(bin.probabilitySum/bin.count-bin.outcomeSum/bin.count))):null;
  // Descriptive normal-approximation intervals are suppressed for tiny samples.
  // These are uncertainty estimates for observed backtest losses, not proof of
  // calibration or forward performance. No resampling randomness is involved.
  const meanInterval95=(values,upperBound=Infinity)=>{
   const n=values.length;if(n<30)return null;
   const avg=values.reduce((a,b)=>a+b,0)/n;
   const variance=values.reduce((a,b)=>a+(b-avg)**2,0)/(n-1);
   const margin=1.959963984540054*Math.sqrt(variance/n);
   return [Math.max(0,avg-margin),Math.min(upperBound,avg+margin)];
  };
  return {totalBouts:audit.total,eligible:eligibleCount,excluded:audit.total-eligibleCount,excludedByReason,scored,missingProbability:eligibleCount-scored,
   probabilityCoverage:eligibleCount?scored/eligibleCount:null,
   missingFrozenPrediction,invalidFrozenProbability,
   expectedCalibrationError,maxCalibrationError,
   brier:scored?brierSum/scored:null,logLoss:scored?logSum/scored:null,
   brierInterval95:meanInterval95(brierValues,1),logLossInterval95:meanInterval95(logValues),
   // A 50/50 benchmark has Brier 0.25 and log loss ln(2) for every decisive bout.
   // Positive skill means improvement over that naive baseline, not betting profit.
   brierSkillVsEven:scored?1-(brierSum/scored)/0.25:null,
   logLossImprovementVsEven:scored?Math.LN2-logSum/scored:null,
   bins:bins.map(({lower,upper,count,probabilitySum,outcomeSum})=>({lower,upper,count,meanProbability:count?probabilitySum/count:null,observedRate:count?outcomeSum/count:null,observedRateInterval95:wilson95(outcomeSum,count)})),
   rows,calibrated:false,bettingEdgeVerified:false};
 }
 return {score};
});