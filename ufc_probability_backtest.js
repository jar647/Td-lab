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
  const byId=new Map((Array.isArray(bouts)?bouts:[]).map(b=>[String(b?.bout_id||''),b]));
  let brierSum=0,logSum=0,scored=0;
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
   brierSum+=brier;logSum+=logLoss;scored++;
   const bin=bins[Math.min(9,Math.floor(p*10))];bin.count++;bin.probabilitySum+=p;bin.outcomeSum+=outcome;
   return {...row,probabilityScored:true,probability:p,outcome,brier,logLoss};
  });
  // In-sample reliability diagnostics, not evidence of validated calibration.
  const occupied=bins.filter(bin=>bin.count>0);
  const expectedCalibrationError=scored?occupied.reduce((sum,bin)=>sum+(bin.count/scored)*Math.abs(bin.probabilitySum/bin.count-bin.outcomeSum/bin.count),0):null;
  const maxCalibrationError=scored?Math.max(...occupied.map(bin=>Math.abs(bin.probabilitySum/bin.count-bin.outcomeSum/bin.count))):null;
  return {eligible:audit.evaluated,scored,missingProbability:audit.evaluated-scored,
   expectedCalibrationError,maxCalibrationError,
   brier:scored?brierSum/scored:null,logLoss:scored?logSum/scored:null,
   // A 50/50 benchmark has Brier 0.25 and log loss ln(2) for every decisive bout.
   // Positive skill means improvement over that naive baseline, not betting profit.
   brierSkillVsEven:scored?1-(brierSum/scored)/0.25:null,
   logLossImprovementVsEven:scored?Math.LN2-logSum/scored:null,
   bins:bins.map(({lower,upper,count,probabilitySum,outcomeSum})=>({lower,upper,count,meanProbability:count?probabilitySum/count:null,observedRate:count?outcomeSum/count:null})),
   rows,calibrated:false,bettingEdgeVerified:false};
 }
 return {score};
});