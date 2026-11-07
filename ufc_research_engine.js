/* UFC research engine: estimates are conditional on verified per-minute fighter statistics.
   No odds are used to generate probabilities. This is an experimental heuristic, NOT calibrated. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.UFCResearch=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function num(x){if(x===null||x===undefined||x==='')return null;const n=Number(x);return Number.isFinite(n)?n:null;}
function normalize(f){const a={};for(const k of ['slpm','sapm','strAcc','strDef','tdAvg','tdAcc','tdDef','subAvg'])a[k]=num(f?.[k]);return a;}
function evaluate(a,b,options={}){
const A=normalize(a),B=normalize(b),keys=Object.keys(A),missing=keys.filter(k=>A[k]===null||B[k]===null);
if(missing.length)return {status:'insufficient_data',missing,reason:'Missing verified fighter statistics: '+missing.join(', ')+'. No probability or betting recommendation.'};
for(const x of [A,B]){if(x.slpm<0||x.sapm<0||x.tdAvg<0||x.subAvg<0||[x.strAcc,x.strDef,x.tdAcc,x.tdDef].some(v=>v<0||v>100))return {status:'invalid_data',reason:'Fighter statistics outside expected ranges.'};}
const striking=(A.slpm*(A.strAcc/50)*(1-B.strDef/130)-B.slpm*(B.strAcc/50)*(1-A.strDef/130));
const absorption=(B.sapm-A.sapm)*0.45;
const grappling=(A.tdAvg*(A.tdAcc/50)*(1-B.tdDef/120)-B.tdAvg*(B.tdAcc/50)*(1-A.tdDef/120));
const submissions=(A.subAvg-B.subAvg);
const score=clamp(0.26*striking+0.18*absorption+0.24*grappling+0.16*submissions,-3,3);
const p=clamp(1/(1+Math.exp(-score)),0.08,0.92);
const seed=(options.seed===undefined?49271:Number(options.seed))>>>0;let state=seed||1;const random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
const draws=clamp(Math.floor(num(options.draws)??10000),100,100000),wins=[0,0];
for(let i=0;i<draws;i++)wins[random()<p?0:1]++;
return {status:'experimental',probabilities:[wins[0]/draws,wins[1]/draws],draws,score,features:{striking,absorption,grappling,submissions},reason:'Experimental, uncalibrated heuristic using verified fighter striking and grappling rates. Not a validated betting edge.',recommendation:'PASS_UNVALIDATED'};
}
return {normalize,evaluate};
});