/* Issue #130: strict OVER research from existing model outcomes, never book prices. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PropShopAltLines=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const unavailable=reason=>({status:'unavailable',reason,lines:[],priced:false,calibrated:false});
 function overResearch(samples,thresholds,opts={}){
  if(!Array.isArray(samples)||!samples.length)return unavailable('Missing simulation samples');
  for(const value of samples)if(!Number.isFinite(value)||value<0)return unavailable('Invalid simulation samples');
  if(opts.stale||opts.injuryUnresolved)return unavailable(opts.stale?'Stale data':'Unresolved availability');
  const min=opts.minSamples??100;
  if(!Number.isSafeInteger(min)||min<1||samples.length<min||samples.length>100000)return unavailable('Insufficient or excessive simulation samples');
  if(!Array.isArray(thresholds)||!thresholds.length)return unavailable('Missing alternate lines');
  for(const line of thresholds)if(!Number.isFinite(line)||line<.5||line>10000||!Number.isInteger(line*2))return unavailable('Invalid alternate lines');
  if(opts.now!==undefined){if(![opts.sourceUpdatedAt,opts.startsAt].every(s=>typeof s==='string'&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(s)))return unavailable('Timezone-aware source times required');const t=Date.parse(opts.sourceUpdatedAt),tip=Date.parse(opts.startsAt),age=opts.maxAgeMs;
   if(!Number.isFinite(opts.now)||!Number.isFinite(t)||!Number.isFinite(tip)||!Number.isFinite(age)||age<=0||t>opts.now+300000||opts.now-t>age||tip<=opts.now)return unavailable('Stale, expired or unavailable source times');}
  const side=opts.side==='under'?'under':'over';
  const rating=Number.isFinite(opts.rating)&&opts.rating>=0&&opts.rating<=100?opts.rating:null;
  const lines=[...new Set(thresholds)].sort((a,b)=>a-b).map(line=>{let wins=0,pushes=0;for(const value of samples){wins+=Number(side==='under'?value<line:value>line);pushes+=Number(value===line)}return {line,direction:side.toUpperCase(),probability:wins/samples.length,pushProbability:pushes/samples.length,label:'Unpriced research target',expectedValue:null,sportsbookAvailable:null};});
  return {status:'research-only',priced:false,calibrated:false,sampleSize:samples.length,rating,ratingIsProbability:false,confidence:{score:rating,kind:'heuristic_matchup',isProbability:false},sourceUpdatedAt:opts.sourceUpdatedAt||null,startsAt:opts.startsAt||null,lines};
 }
 function fromSettlement(row,thresholds,opts={}){
  if(!Number.isSafeInteger(row?.count)||row.count<1000||row.count>100000||!Array.isArray(row.bins))return unavailable('Settlement outcomes unavailable');
  const samples=[],seen=new Set();for(const bin of row.bins){if(!Array.isArray(bin)||bin.length!==2||!Number.isSafeInteger(bin[0])||bin[0]<0||!Number.isSafeInteger(bin[1])||bin[1]<0||seen.has(bin[0])||samples.length+bin[1]>row.count)return unavailable('Invalid settlement outcomes');seen.add(bin[0]);for(let i=0;i<bin[1];i++)samples.push(bin[0]);}
  if(samples.length!==row.count)return unavailable('Incomplete settlement outcomes');
  return overResearch(samples,thresholds,{minSamples:1000,...opts});
 }
 return {overResearch,fromSettlement};
});
