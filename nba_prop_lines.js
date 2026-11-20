/* One NBA alternate-line policy. Sample frequencies are not calibrated odds. */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 root.CookNBAPropLines=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const POLICY='nba-balanced-alt-v1',MIN_SAMPLES=5,TARGET=.75;
 const GRIDS={
  points:[10,15,20,25,30,35,40,45,50,55,60,65,70,75,80],
  rebounds:[4,5,6,8,10,12,15,18,20,25,30],
  assists:[3,4,5,6,8,10,12,15,18,20],
  threes:[1,2,3,4,5,6,7,8,10,12],
  pr:[10,15,20,25,30,35,40,45,50,55,60,65,70,80,90,100],
  pa:[10,15,20,25,30,35,40,45,50,55,60,65,70,80,90,100],
  ra:[5,8,10,12,15,18,20,25,30,35,40,45,50],
  pra:[15,20,25,30,35,40,45,50,55,60,65,70,75,80,90,100,110,120]
 };
 const finite=value=>typeof value==='number'&&Number.isFinite(value);
 function validNumbers(values,min,max){
  if(!Array.isArray(values))return false;
  // Iteration visits sparse slots as undefined; Array.some/every skip them.
  for(const value of values)if(!finite(value)||value<min||value>max)return false;
  return true;
 }
 function canonical(market){
  const key=String(market??'').toLowerCase().replace(/[^a-z]/g,'');
  return ({points:'points',rebounds:'rebounds',assists:'assists',threes:'threes',threepointers:'threes',
   pr:'pr',pointsrebounds:'pr',pa:'pa',pointsassists:'pa',ra:'ra',reboundsassists:'ra',
   pra:'pra',pointsreboundsassists:'pra'})[key]||null;
 }
 function evaluate(samples,line){
  const empty=reason=>({available:false,reason,count:0,wins:0,pushes:0,losses:0,winFrequency:null,pushFrequency:null,lossFrequency:null});
  if(!validNumbers(samples,0,Infinity)||!samples.length)return empty('A complete finite, nonnegative outcome sample is required.');
  if(!finite(line)||line<.5||line>400)return empty('Enter a valid strict OVER line from 0.5 to 400.');
  let wins=0,pushes=0;for(const value of samples){if(value>line)wins++;else if(value===line)pushes++;}
  const count=samples.length,losses=count-wins-pushes;
  return {available:true,reason:null,count,wins,pushes,losses,winFrequency:wins/count,pushFrequency:pushes/count,lossFrequency:losses/count};
 }
 function ladder({market,samples,offeredLines,sampleKind='role_adjusted_history'}={}){
  const key=canonical(market);
  if(!key||!validNumbers(samples,0,Infinity)||samples.length<MIN_SAMPLES)return [];
  const offered=offeredLines!==undefined;
  if(offered&&!validNumbers(offeredLines,.5,400))return [];
  const lines=[...new Set(offered?offeredLines:GRIDS[key].map(value=>value-.5))].sort((a,b)=>a-b);
  return lines.map(line=>{
   const result=evaluate(samples,line),milestone=Number.isInteger(line+.5)?line+.5:null;
   return {available:true,reason:null,market:key,milestone,line,frequency:result.winFrequency,
    pushFrequency:result.pushFrequency,lossFrequency:result.lossFrequency,
    sampleCount:result.count,targetFrequency:TARGET,policy:POLICY,sampleKind,offered,
    settlement:'strict_over',calibrated:false};
  });
 }
 function select(options={}){
  const key=canonical(options.market),offered=options.offeredLines!==undefined;
  const empty=reason=>({available:false,reason,market:key,milestone:null,line:null,frequency:null,
   policy:POLICY,sampleKind:options.sampleKind||'role_adjusted_history',offered,targetFrequency:TARGET,calibrated:false});
  if(!key)return empty('Unsupported NBA player-prop market.');
  const rows=ladder(options);
  if(!rows.length)return empty(offered?'No supported actual book lines and complete outcome sample were supplied.':'At least five complete supported outcomes are required for a research alternate line.');
  // A caller can inspect an exact harder book line using evaluate(). The
  // default recommendation never goes below the conventional market floor
  // merely to manufacture a high frequency.
  const supported=rows.filter(row=>row.frequency>=.5);
  if(!supported.length)return empty('No supported line reaches the minimum research frequency without lowering the market floor.');
  supported.sort((a,b)=>{const gap=Math.abs(a.frequency-TARGET)-Math.abs(b.frequency-TARGET);return Math.abs(gap)>1e-12?gap:b.line-a.line});
  return {...supported[0],reason:offered?'Closest supported supplied book line to the 75% planning target.':'Closest conventional research line to the 75% planning target; book availability is unverified.'};
 }
 function minimumScore(market){return canonical(market)==='threes'?85:75;}
 function qualifiesScore(score,market){return Number.isFinite(score)&&score>=minimumScore(market)&&score<=100;}
 function minimum(market){const key=canonical(market);return key?GRIDS[key][0]:null;}
 return {minimumScore,qualifiesScore,POLICY,MIN_SAMPLES,TARGET,canonical,minimum,select,ladder,evaluate};
});
