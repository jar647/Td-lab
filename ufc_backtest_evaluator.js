/* Evaluate only frozen pre-fight predictions against decisive final results.
   No model probabilities are generated or calibrated here. */
(function(root,factory){
 const guard=typeof module==='object'&&module.exports?require('./ufc_backtest_guard.js'):root.UFCBacktestGuard;
 const api=factory(guard);
 if(typeof module==='object'&&module.exports)module.exports=api;
 root.UFCBacktestEvaluator=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(guard){
 'use strict';
 const time=v=>{if(typeof v!=='string')return null;const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(v);if(!m)return null;const [year,month,day,hour,minute,second]=m.slice(1,7).map(Number);const leap=year%4===0&&(year%100!==0||year%400===0);const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];if(year<1||month<1||month>12||day<1||day>days[month-1]||hour>23||minute>59||second>59)return null;const zone=m[7];if(zone!=='Z'){const zh=Number(zone.slice(1,3)),zm=Number(zone.slice(4,6));if(zh>14||zm>59||(zh===14&&zm!==0))return null;}const n=Date.parse(v);return Number.isFinite(n)?n:null;}
 function evaluate(bouts,snapshotsByBout,predictionsByBout){
  const rows=[];
  const counts=new Map();
  for(const bout of Array.isArray(bouts)?bouts:[]){const id=String(bout?.bout_id||'').trim();if(id)counts.set(id,(counts.get(id)||0)+1);}
  const seen=new Set();
  for(const bout of Array.isArray(bouts)?bouts:[]){
   const id=String(bout?.bout_id||'').trim();
   const errors=[];
   if(!id||counts.get(id)>1||seen.has(id)){rows.push({bout_id:id,eligible:false,errors:['missing_or_duplicate_bout_id']});continue;}
   seen.add(id);
   const check=guard.inspect(bout,snapshotsByBout?.[id]);
   errors.push(...check.errors);
   const prediction=predictionsByBout?.[id];
   const before=time(prediction?.frozen_at);
   const cutoff=time(bout?.starts_at);
   if(before===null)errors.push('missing_frozen_prediction_timestamp');
   else if(cutoff!==null&&before>=cutoff)errors.push('prediction_not_frozen_before_bout');
   // The frozen prediction must not depend on a snapshot collected later,
   // even when that snapshot predates the actual fight.
   const profiles=snapshotsByBout?.[id];
   if(before!==null&&Array.isArray(profiles)&&profiles.length===2){
    profiles.forEach((profile,i)=>{
     const asOf=time(profile?.stats_as_of);
     const collected=time(profile?.snapshot_at);
     if((asOf!==null&&asOf>before)||(collected!==null&&collected>before))errors.push('fighter_'+i+'_snapshot_after_prediction');
    });
   }
   const a=String(bout?.fighter_a||''),b=String(bout?.fighter_b||'');
   const picked=String(prediction?.winner_id||'');
   if(!a||!b||a===b)errors.push('invalid_competitors');
   if(!picked||![a,b].includes(picked))errors.push('invalid_predicted_winner');
   const status=String(bout?.status||'').toLowerCase();
   const method=String(bout?.method_display||bout?.method||'');
   const winner=String(bout?.winner||'');
   if(status!=='final'||/\b(?:draw|no[\s-]*contest|n\.?c\.?|overturn(?:ed)?)\b/i.test(method)||![a,b].includes(winner))errors.push('no_decisive_final_result');
   const eligible=errors.length===0;
   rows.push({bout_id:id,eligible,errors,correct:eligible?picked===winner:null});
  }
  const eligible=rows.filter(r=>r.eligible);
  const wins=eligible.filter(r=>r.correct).length;
  const excludedByReason={};
  for(const row of rows)if(!row.eligible)for(const reason of new Set(row.errors))excludedByReason[reason]=(excludedByReason[reason]||0)+1;
  // Wilson score interval describes sampling uncertainty, not model calibration.
  const n=eligible.length,p=n?wins/n:null,z=1.959963984540054;
  const denominator=1+z*z/n;
  const center=n?(p+z*z/(2*n))/denominator:null;
  const margin=n?z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/denominator:null;
  const accuracyInterval95=n?[Math.max(0,center-margin),Math.min(1,center+margin)]:null;
  return {total:rows.length,evaluated:n,excluded:rows.length-n,excludedByReason,correct:wins,incorrect:n-wins,accuracy:p,accuracyInterval95,rows,calibrated:false};
 }
 return {evaluate};
});