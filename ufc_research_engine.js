/* UFC research engine: estimates are conditional on verified per-minute fighter statistics.
   No odds are used to generate probabilities. This is an experimental heuristic, NOT calibrated. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.UFCResearch=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const KEYS=['slpm','sapm','strAcc','strDef','tdAvg','tdAcc','tdDef','subAvg'];
const PERCENT=new Set(['strAcc','strDef','tdAcc','tdDef']);
function num(x){if(!['string','number'].includes(typeof x)||String(x).trim()==='')return null;const n=Number(x);return Number.isFinite(n)?n:null;}
function normalize(f){const a={};for(const k of KEYS)a[k]=num(f?.[k]);return a;}
const absent=value=>value===null||value===undefined||typeof value==='string'&&value.trim()==='';
const outOfRange=(key,value)=>value!==null&&(value<0||PERCENT.has(key)&&value>100);
function evaluate(a,b,options={}){
const A=normalize(a),B=normalize(b),stats=[A,B],raw=[a,b],requiredMissing=[],unusedMissing=[],unavailable=[];
for(let side=0;side<2;side++)for(const key of KEYS){
  const value=stats[side][key];
  if(value===null||outOfRange(key,value))unavailable.push({side,key});
  if(value!==null)continue;
  // A known zero takedown rate makes its entire offensive term zero. Missing
  // percentages remain missing; malformed provided values are never exempted.
  const unused=absent(raw[side]?.[key])&&(key==='tdAcc'&&stats[side].tdAvg===0||key==='tdDef'&&stats[1-side].tdAvg===0);
  if(unused)unusedMissing.push({side,key,reason:key==='tdAcc'?'The fighter has a verified zero takedown rate, so this percentage is not used in their takedown term.':'The opponent has a verified zero takedown rate, so this percentage is not used in the opposing takedown term.'});
  else requiredMissing.push({side,key});
}
const dataQuality={limited:unavailable.length>0,unavailable};
if(stats.some(x=>KEYS.some(key=>outOfRange(key,x[key]))))return {status:'invalid_data',unusedMissing,dataQuality,reason:'Fighter statistics outside expected ranges.'};
const missing=KEYS.filter(key=>requiredMissing.some(item=>item.key===key));
if(missing.length)return {status:'insufficient_data',missing,unusedMissing,dataQuality,reason:'Missing or invalid required fighter statistics: '+missing.join(', ')+'. No probability or betting recommendation.'};
const striking=(A.slpm*(A.strAcc/50)*(1-B.strDef/130)-B.slpm*(B.strAcc/50)*(1-A.strDef/130));
const absorption=(B.sapm-A.sapm)*0.45;
const takedownTerm=(fighter,opponent)=>fighter.tdAvg===0&&(fighter.tdAcc===null||opponent.tdDef===null)?0:fighter.tdAvg*(fighter.tdAcc/50)*(1-opponent.tdDef/120);
const grappling=(takedownTerm(A,B)-takedownTerm(B,A));
const submissions=(A.subAvg-B.subAvg);
const score=clamp(0.26*striking+0.18*absorption+0.24*grappling+0.16*submissions,-3,3);
const p=clamp(1/(1+Math.exp(-score)),0.08,0.92);
const seed=(options.seed===undefined?49271:Number(options.seed))>>>0;let state=seed||1;const random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
const draws=clamp(Math.floor(num(options.draws)??10000),100,100000),wins=[0,0];
for(let i=0;i<draws;i++)wins[random()<p?0:1]++;
const estimate=wins[0]/draws;const margin=1.96*Math.sqrt(estimate*(1-estimate)/draws);const simulationInterval=[clamp(estimate-margin,0,1),clamp(estimate+margin,0,1)];
return {status:'experimental',probabilities:[estimate,1-estimate],simulationInterval,modelProbability:p,draws,score,features:{striking,absorption,grappling,submissions},unusedMissing,dataQuality,reason:'Experimental, uncalibrated heuristic using verified fighter striking and grappling rates. The simulation interval describes Monte Carlo sampling error only, not model accuracy or predictive uncertainty. Not a validated betting edge.',recommendation:'PASS_UNVALIDATED'};
}
return {normalize,evaluate};
});
