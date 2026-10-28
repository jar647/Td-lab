/* CoOk It Up: American-odds market math only. No invented model probabilities. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 root.CookItUpPricing=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function american(raw){
  if(raw===null||raw===undefined||String(raw).trim()==='')return null;
  const v=String(raw).trim();
  if(!/^[+-]?\d+$/.test(v))return null;
  const n=Number(v);
  return Number.isSafeInteger(n)&&Math.abs(n)>=100&&Math.abs(n)<=100000?n:null;
 }
 function quote(raw){
  const n=american(raw);
  if(n===null)return null;
  const decimal=n>0?1+n/100:1+100/(-n);
  return {american:n,decimal,implied:1/decimal};
 }
 function compare({line,projection,overOdds,underOdds,side=null}={}){
  const over=quote(overOdds),under=quote(underOdds);
  const entered=raw=>raw!==null&&raw!==undefined&&String(raw).trim()!=='';
  const invalid=(entered(overOdds)&&!over)||(entered(underOdds)&&!under);
  const bookSum=over&&under?over.implied+under.implied:null;
  const noVigOver=bookSum?over.implied/bookSum:null;
  const noVigUnder=bookSum?under.implied/bookSum:null;
  const posted=Number(line),forecast=Number(projection);
  const validLine=line!==''&&line!==null&&line!==undefined&&Number.isFinite(posted)&&posted>0;
  const validProjection=projection!==''&&projection!==null&&projection!==undefined&&Number.isFinite(forecast)&&forecast>=0;
  const direction=side==='OVER'||side==='UNDER'?side:null;
  const selected=direction==='OVER'?over:direction==='UNDER'?under:null;
  let status,reason;
  if(!validLine){status='ENTER VEGAS LINE';reason='Enter the exact posted player-prop line before reviewing a market price.'}
  else if(invalid){status='CHECK VEGAS ODDS';reason='American odds must be +100 or higher, or -100 or lower. Clear a field if that side is unavailable.'}
  else if(!validProjection){status='PASS · PROJECTION UNAVAILABLE';reason='No valid independent projection to assess this line.'}
  else if(!direction){status='PASS · NO SUPPORTED SIDE';reason='The model has not identified a supported Over or Under from this projection.'}
  else if(!selected){status='RESEARCH LEAN · PRICE MISSING';reason='Enter the actual '+direction+' price to assess the cost of this side.'}
  else if(selected.american< -200){status='PASS · PRICE WORSE THAN -200';reason='This quoted '+direction+' is shorter than the chosen -200 price ceiling. Do not substitute the opposite side as a pick.'}
  else{status='RESEARCH '+direction+' LEAN · PRICE REVIEWED';reason='Quoted break-even is '+(selected.implied*100).toFixed(1)+'%. A projection difference is NOT a calibrated win probability; no positive expected value has been demonstrated.'}
  return {over,under,invalid,noVigOver,noVigUnder,selected,direction,
   projectionDifference:validLine&&validProjection?forecast-posted:null,
   status,reason,verifiedValue:false,play:false};
 }
 return {american,quote,compare};
});
