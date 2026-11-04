/* NBA game-first research ticket. No odds required; experimental probabilities, not calibrated betting probabilities. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 root.CookNBAGameFirst=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 const markets=['points','rebounds','assists'];
 const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
 function normalCdf(x){const z=Math.abs(x)/Math.sqrt(2),t=1/(1+.3275911*z);const erf=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*Math.exp(-z*z);return .5*(1+(x<0?-erf:erf))}
 function chance(row,line){
  const mu=Number(row.forecast),n=Number(row.matchupGames);
  if(!Number.isFinite(mu)||mu<=0||!Number.isFinite(line)||line<0||n<3)return null;
  // Variance is a transparent heuristic, NOT a fitted or calibrated distribution.
  const sd=Math.max(1.6,Math.sqrt(mu)*({points:2.1,rebounds:1.45,assists:1.5}[row.market]||2));
  return clamp(1-normalCdf((line+.5-mu)/sd),.001,.999);
 }
 function candidate(row,excluded=[]){
  if(!row||!markets.includes(row.market)||excluded.includes(row.market)||Number(row.matchupGames)<3||Number(row.matchupBoost)<=0||!Number.isFinite(Number(row.forecast))||Number(row.forecast)<=0)return null;
  const forecast=Number(row.forecast);
  const line=Math.max(.5,Math.floor(forecast*.84)+.5);
  const probability=chance(row,line);
  if(probability===null)return null;
  return {...row,line,probability,reason:row.reason||'Positive opponent defensive adjustment',researchOnly:true};
 }
 function build(rows,options={}){
  const excluded=options.excludedMarkets||[],max=clamp(Number(options.maxLegs)||4,1,4);
  const ranked=(rows||[]).map(r=>candidate(r,excluded)).filter(Boolean).sort((a,b)=>b.matchupBoost-a.matchupBoost||b.probability-a.probability);
  const picks=[],seen=new Set();
  for(const r of ranked){
   const id=String(r.playerId||r.name);
   if(seen.has(id))continue;
   seen.add(id);picks.push(r);
   if(picks.length>=max)break;
  }
  return {picks,bestSingle:picks[0]||null,topThree:ranked.filter((r,i,a)=>a.findIndex(x=>String(x.playerId||x.name)===String(r.playerId||r.name))===i).slice(0,3),excludedMarkets:excluded,disclaimer:'Research-only, uncalibrated estimates. Shared game factors make player props correlated; individual percentages cannot be multiplied into an SGP hit rate.'};
 }
 return {chance,candidate,build,markets};
});
