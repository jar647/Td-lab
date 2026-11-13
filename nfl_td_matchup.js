/* Position-aware anytime rushing/receiving TD research. Scores are not probabilities. */
(function(root){'use strict';
const VERSION='nfl-td-role-v1';
const number=v=>!['number','string'].includes(typeof v)||(typeof v==='string'&&!v.trim())?null:(Number.isFinite(Number(v))?Number(v):null);
const cap=(v,max)=>Math.max(0,Math.min(1,v/max));
function unavailableReason(r){
 if(!r||!['QB','RB','WR','TE'].includes(r.pos))return 'Position is not supported for offensive anytime TD research.';
 if(r.playerAppearancesVerified===false||!(number(r.games)>=2))return 'At least two verified appearances are required for a TD score.';
 if(['tdallowed','rzallowed','playerRz','rzshare'].some(k=>number(r[k])===null||number(r[k])<0))return 'Player red-zone usage or opponent position TD/red-zone data is missing.';
 return null;
}
function rating(r){
 if(unavailableReason(r))return null;
 const receiving=['WR','TE'].includes(r.pos),factors=[];
 const add=(label,key,weight,max,group,value=number(r[key]))=>{if(value!==null&&value>=0)factors.push({label,key,weight,max,value,group,normalized:cap(value,max)});};
 add('Opponent TDs allowed to '+r.pos,'tdallowed',.65,1.2,'opponent');
 add('Opponent red-zone chances allowed to '+r.pos,'rzallowed',.35,3.5,'opponent');
 add('Rushing + receiving TDs per appearance','playerAnytimeTDs',receiving?.20:.30,1,'performance');
 add('Red-zone rushing + receiving opportunities','playerRz',receiving?.20:.25,2.5,'performance');
 add('Share of team red-zone opportunities','rzshare',receiving?.12:.15,35,'performance');
 add('Inside-five opportunities','goalLine5',.15,.8,'performance');
 const snap=number(r.snapShare),snapPct=snap===null?null:snap<=1?snap*100:snap;
 add('Offensive snap share','snapShare',receiving?.08:.10,85,'performance',snapPct);
 add('Recent rushing + receiving TDs','recent3AnytimeTDs',.05,1,'performance');
 if(receiving){
  add('Red-zone targets','playerRzTargets',.12,1.5,'performance');
  add('Target share','playerTargetShare',.08,r.pos==='TE'?22:30,'performance');
 }
 const component=group=>{const rows=factors.filter(f=>f.group===group),weight=rows.reduce((s,f)=>s+f.weight,0);return Math.round(100*rows.reduce((s,f)=>s+f.weight*f.normalized,0)/weight);};
 const performanceScore=component('performance'),opponentScore=component('opponent');
 const score=Math.round((performanceScore+opponentScore)/2),production=number(r.playerAnytimeTDs),productionAvailable=production!==null&&production>=0;
 for(const group of ['performance','opponent']){const rows=factors.filter(f=>f.group===group),weight=rows.reduce((s,f)=>s+f.weight,0);for(const f of rows)f.points=50*f.weight*f.normalized/weight;}
 return {score,performanceScore,opponentScore,factors,role:receiving?'Receiving':'Rushing / offensive TD',version:VERSION,productionAvailable,
  coverage:productionAvailable?'Uses actual rushing/receiving TD production and role-specific usage.':'Actual rushing/receiving TD production is unavailable; score uses role-specific opportunity data.',
  method:'50% player performance and opportunity; 50% opponent TD/red-zone allowance to the same position. Missing optional metrics are omitted and available weights are renormalized. Passing TDs do not count. Research heuristic, not a calibrated probability.'};
}
function score(r){return rating(r)?.score??null}
function label(r){const value=score(r);return value===null?'UNRATED · DATA INCOMPLETE':value>=80?'STRONG TD MATCHUP':value>=60?'FAVORABLE TD MATCHUP':value>=40?'MIXED TD MATCHUP':'TOUGH TD MATCHUP'}
const api={VERSION,rating,score,label,unavailableReason};
if(typeof module==='object'&&module.exports)module.exports=api;root.PropShopNFLTD=api;
})(typeof globalThis!=='undefined'?globalThis:this);
