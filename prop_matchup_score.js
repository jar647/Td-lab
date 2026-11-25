'use strict';

// Research challenger. The score is a rank on matchup evidence.
const WEIGHTS=Object.freeze({opponent:30,ability:25,opportunity:25,recent:10,stability:10});
const clamp=value=>Math.min(1,Math.max(0,value));
const mean=values=>values.reduce((sum,value)=>sum+value,0)/values.length;
const ratio=(value,reference)=>Number.isFinite(value)&&value>=0&&Number.isFinite(reference)&&reference>0?value/reference:null;
function directional(value,side){
 return value===null?null:clamp(.5+(side==='under'?1-value:value-1));
}
function stability(opportunities){
 if(!Array.isArray(opportunities)||opportunities.length<3||opportunities.some(value=>!Number.isFinite(value)||value<0))return null;
 const center=mean(opportunities);
 return center>0?clamp(1-Math.sqrt(mean(opportunities.map(value=>(value-center)**2)))/center):null;
}
function score(inputs){
 if(Object.keys(WEIGHTS).some(key=>!Number.isFinite(inputs?.[key])||inputs[key]<0||inputs[key]>1))return null;
 const factors=Object.entries(WEIGHTS).map(([key,max])=>({key,max,points:inputs[key]*max}));
 return {version:'unified-matchup-research-v1',score:Math.round(factors.reduce((sum,factor)=>sum+factor.points,0)),factors};
}
function nba(row){
 const side=row.side,role=row.roleEvidence,history=role?.observedHistory||[],minutes=history.slice(0,5).map(x=>x.minutes);
 const peerRate=ratio(row.peerAverage,row.peerMinutes),playerRate=ratio(row.playerAverage,row.recentMinutes);
 return score({
  opponent:Number.isFinite(row.weakness?.standardizedAdvantage)?clamp(row.weakness.standardizedAdvantage/1.5):null,
  ability:directional(ratio(playerRate,peerRate),side),
  opportunity:Number.isFinite(row.opportunityRelativeToPeers)?clamp(.5+row.opportunityRelativeToPeers-1):null,
  recent:directional(ratio(mean(row.history.slice(0,3)),mean(row.history.slice(3))),side),
  stability:stability(minutes)
 });
}
function nfl({production,opportunities,opponentAllowance,peerProduction,peerOpportunities,side='over'}){
 const efficiency=ratio(mean(production),mean(opportunities));
 const peerEfficiency=ratio(peerProduction,peerOpportunities);
 return score({
  opponent:directional(ratio(opponentAllowance,peerProduction),side),
  ability:directional(ratio(efficiency,peerEfficiency),side),
  opportunity:directional(ratio(.65*mean(opportunities)+.35*mean(opportunities.slice(-3)),peerOpportunities),side),
  recent:directional(ratio(mean(production.slice(-3)),mean(production.slice(0,-3))),side),
  stability:stability(opportunities.slice(-5))
 });
}
module.exports={WEIGHTS,score,nba,nfl};
