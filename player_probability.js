/* CoOk It Up: experimental player-prop probability and price decision engine.
 * Historical player games -> forecast distribution -> two-sided price audit.
 * MODEL NOT CALIBRATED. No executable odds, verified EV, or BET approval.
 */
(function(root,factory){
 'use strict';
 const pricing=typeof module==='object'&&module.exports?require('./market_odds.js'):root.CookItUpPricing;
 const api=factory(pricing);
 if(typeof module==='object'&&module.exports)module.exports=api;
 root.CookItUpProbability=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(pricing){
 'use strict';
 const FIELDS={PTD:'passTDs',PASS:'passYards',RUSH:'rushYards',REC:'recYards',CATCH:'receptions'};
 const FLOORS={PTD:1,PASS:45,RUSH:22,REC:24,CATCH:1.8,points:6,rebounds:2.8,assists:2.1,threes:1.5,'Points + Rebounds':7.3,'Points + Assists':7,'Rebounds + Assists':3.4,PRA:8};
 const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
 const finite=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x))?Number(x):null;
 const hasValue=x=>x!==null&&x!==undefined&&String(x).trim()!=='';
 // Standard normal CDF (absolute approximation error < 8e-8).
 function normalCDF(x){
  const a=Math.abs(x),t=1/(1+.2316419*a);
  const tail=Math.exp(-a*a/2)/Math.sqrt(2*Math.PI)*t*(.319381530+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
  const c=1-tail;
  return clamp(x>=0?c:1-c,0,1);
 }
 // Only explicitly reported, observed game stats count. Do not infer missed-game zeros.
 function nflHistory(player,market){
  if(!player||player.playerAppearancesVerified===false||!FIELDS[market])return [];
  const rows=Array.isArray(player.seasonGameStats)&&player.seasonGameStats.length
   ?player.seasonGameStats:Array.isArray(player.last5GameStats)?player.last5GameStats:[];
  const field=FIELDS[market];
  return rows.filter(r=>r&&r.didNotPlay!==true&&r.played!==false)
   .map(r=>{
    const aliases=field==='passTDs'?['passTDs','passTouchdowns','passingTDs']: [field];
    const name=aliases.find(k=>Object.prototype.hasOwnProperty.call(r,k)&&hasValue(r[k]));
    return name?finite(r[name]):null;
   }).filter(v=>v!==null&&v>=0).slice(-20);
 }
 function estimate({history,market,projection,line,context={}}={}){
  const posted=finite(line),forecast=finite(projection);
  if(posted===null||posted<0||forecast===null||forecast<0)return {valid:false,reason:'A positive sportsbook line and an independent player projection are required.',sample:0};
  const values=(Array.isArray(history)?history:[]).map(finite).filter(v=>v!==null&&v>=0).slice(-20);
  const n=values.length;
  if(n<5)return {valid:false,sample:n,reason:'At least 5 recorded player-game outcomes are required for an experimental probability estimate. No missing games are filled with zeros.'};
  const average=values.reduce((a,b)=>a+b,0)/n;
  const variance=values.reduce((a,v)=>a+(v-average)**2,0)/Math.max(1,n-1);
  const observedSD=Math.sqrt(variance);
  // Explicit uncertainty floor is a conservative modeling assumption, never fabricated game data.
  const floor=FLOORS[market]??Math.max(2,average*.2);
  const sd=Math.max(observedSD,floor)*Math.sqrt(1+1/n);
  // Build the forecast from independent inputs. Missing matchup or workload data
  // remain neutral and lower the evidence grade; they are never guessed.
  const season=finite(context.seasonAverage),recent=finite(context.recentAverage);
  const contextualMean=season!==null&&recent!==null ? .7*season+.3*recent : forecast;
  const base=.75*forecast+.25*contextualMean;
  const seasonUsage=finite(context.seasonUsage),recentUsage=finite(context.recentUsage);
  const usageRatio=seasonUsage>0&&recentUsage!==null?clamp(recentUsage/seasonUsage,.75,1.25):null;
  const usageEffect=usageRatio===null?1:1+.15*(usageRatio-1);
  const defenseRatio=finite(context.opponentRatio);
  const defenseEffect=defenseRatio===null?1:1+.15*clamp(defenseRatio-1,-.25,.25);
  const injuryFactor=finite(context.injuryFactor);
  const injuryEffect=injuryFactor===null?1:clamp(injuryFactor,.8,1.05);
  const contextual=base*usageEffect*defenseEffect*injuryEffect;
  // Keep a small anchor to the observed mean so a single projected input
  // cannot overwhelm the player's game-level record.
  const center=.75*contextual+.25*average;
  // Player stats are integer outcomes. Whole-number lines can push; half lines cannot.
  const whole=Number.isInteger(posted);
  const highBound=Math.floor(posted)+.5;
  const lowBound=whole?posted-.5:highBound;
  const normalOver=clamp(1-normalCDF((highBound-center)/sd),0,1);
  const normalUnder=clamp(normalCDF((lowBound-center)/sd),0,1);
  const normalPush=clamp(1-normalOver-normalUnder,0,1);
  // Preserve the player's observed game-to-game shape, shift it by the
  // matchup-conditioned center, then use a small smooth prior for sparse logs.
  const scale=average>0?center/average:1;
  let observedOver=0,observedUnder=0,observedPush=0;
  for(const value of values){
   let scenario=Math.max(0,value*scale);
   if(whole)scenario=Math.round(scenario);
   if(scenario>posted)observedOver++;
   else if(scenario<posted)observedUnder++;
   else observedPush++;
  }
  const priorWeight=Math.min(3,Math.max(1,8/n)),denominator=n+priorWeight;
  const over=(observedOver+priorWeight*normalOver)/denominator;
  const under=(observedUnder+priorWeight*normalUnder)/denominator;
  const push=(observedPush+priorWeight*normalPush)/denominator;
  // Sensitivity to estimated mean error; NOT a validated frequentist confidence interval.
  const centerError=1.28*Math.max(observedSD,floor)/Math.sqrt(n);
  const overLower=clamp(1-normalCDF((highBound-(center-centerError))/sd),0,1);
  const underLower=clamp(normalCDF((lowBound-(center+centerError))/sd),0,1);
  const overConditional=over/Math.max(.00001,1-push);
  const underConditional=under/Math.max(.00001,1-push);
  const overLowerConditional=overLower/Math.max(.00001,overLower+normalCDF((lowBound-(center-centerError))/sd));
  const underLowerConditional=underLower/Math.max(.00001,underLower+1-normalCDF((highBound-(center+centerError))/sd));
  const status=String(context.injuryStatus||'').toUpperCase();
  const evidence={usage:usageRatio!==null,matchup:defenseRatio!==null,injury:!!status&&!/UNVERIFIED|NOT_REPORTED|NOT LISTED/.test(status),
   recent:recent!==null,season:season!==null};
  return {valid:true,sample:n,average,center,sd,over,under,push,overConditional,underConditional,
   overLower:clamp(overLowerConditional,0,1),underLower:clamp(underLowerConditional,0,1),
   diverges:average>0&&(center>average*2||center<average*.5),usageRatio,defenseRatio,
   injuryStatus:status||'UNVERIFIED',evidence,evidenceCount:Object.values(evidence).filter(Boolean).length,
   matchupEffect:Math.round((defenseEffect-1)*1000)/10,usageEffect:Math.round((usageEffect-1)*1000)/10,
   injuryEffect:Math.round((injuryEffect-1)*1000)/10,
   distribution:'matchup-shifted empirical outcomes with a small normal-distribution prior',
   method:'Observed player-game outcome shape, shifted using recent production, workload, opponent allowance and documented availability inputs where available; small normal prior shrinks sparse histories. Uncalibrated.'};
 }
 function calibrationReady(c,market){
  const rows=finite(c?.gradedRows),marketRows=finite(c?.marketRows?.[market]);
  const brier=finite(c?.brier),baseline=finite(c?.baselineBrier),error=finite(c?.maxCalibrationError);
  return c?.validated===true&&c.liveModelVersion===c.modelVersion&&finite(c.holdoutWeeks)>=8&&
   rows>=500&&marketRows>=40&&brier!==null&&baseline!==null&&brier<baseline&&error!==null&&error<=.05;
 }
 function review({history,market,projection,line,overOdds,underOdds,context={},eligible=true,blockReason='',calibration={},availableGames=8}={}){
  const model=estimate({history,market,projection,line,context});
  const available=finite(availableGames);
  const requiredSample=available===null?8:Math.max(5,Math.min(8,Math.floor(available)));
  const overQuote=pricing.quote(overOdds),underQuote=pricing.quote(underOdds);
  const invalid=(hasValue(overOdds)&&!overQuote)||(hasValue(underOdds)&&!underQuote);
  const sum=overQuote&&underQuote?overQuote.implied+underQuote.implied:null;
  const noVigOver=sum?overQuote.implied/sum:null;
  const noVigUnder=sum?underQuote.implied/sum:null;
  const side=(name,q)=>{
   if(!q||!model.valid)return null;
   const prob=name==='OVER'?model.over:model.under;
   const conditional=name==='OVER'?model.overConditional:model.underConditional;
   const conservative=name==='OVER'?model.overLower:model.underLower;
   const lose=name==='OVER'?model.under:model.over;
   const ev=prob*(q.decimal-1)-lose;
   return {name,odds:q.american,implied:q.implied,probability:prob,conditional,
    conservative,edge:conditional-q.implied,ev,priceAllowed:q.american>=-200};
  };
  const over=side('OVER',overQuote),under=side('UNDER',underQuote);
  const ranked=[over,under].filter(Boolean).sort((a,b)=>b.ev-a.ev);
  const strong=ranked.filter(x=>x.priceAllowed&&x.edge>=.05&&x.ev>=.04&&x.conservative>=x.implied);
  const best=strong[0]||null;
  const calibrated=calibrationReady(calibration,market);
  let status,reason,decision='PASS';
  if(!model.valid){status='PASS · PROBABILITY UNAVAILABLE';reason=model.reason}
  else if(invalid){status='PASS · INVALID ODDS';reason='Enter valid American odds (+100 or greater, -100 or less); do not interpret malformed prices.'}
  else if(!overQuote&&!underQuote){status='ENTER VEGAS ODDS';reason='Enter the offered price for either side to compare a modeled hit rate against its break-even point.'}
  else if(!eligible){status='PASS · PLAYER OR GAME STATUS UNVERIFIED';reason=blockReason||'Player status or pregame data are not verified.'}
  else if(model.sample<requiredSample){status='PASS · LIMITED VERIFIED HISTORY';reason='Experimental probability calculated from '+model.sample+' recorded player games, but '+requiredSample+' are required. The evidence minimum is capped at 8 or the number of team games available so far, whichever is lower.'}
  else if(!model.evidence.usage||!model.evidence.matchup){status='PASS · MATCHUP DATA INCOMPLETE';reason='A recent workload measure and opponent-specific allowance are both required before the model can issue a lean. Missing inputs are not treated as neutral evidence.'}
  else if(model.diverges){status='PASS · PROJECTION/HISTORY CONFLICT';reason='The model forecast differs substantially from observed game production; do not elevate an unstable estimate.'}
  else if(best&&calibrated){status='PLAY '+best.name+' · CALIBRATION GATE PASSED';decision='PLAY';reason='The '+best.name+' probability clears the price and uncertainty checks, and this market’s matching model version beat its holdout baseline with adequate calibration evidence.'}
  else if(best){status='LEAN '+best.name+' · UNCALIBRATED';decision='LEAN';reason='The experimental '+best.name+' probability clears the price and sensitivity checks, but live-model holdout calibration is not approved. Treat this as a research lean, not a betting edge.'}
  else if(ranked.length&&ranked[0].odds< -200){status='PASS · PRICE TOO SHORT OR NO ROBUST EDGE';reason='Avoid prices worse than -200. No other quoted side clears both the experimental margin and uncertainty checks.'}
  else{status='PASS · NO ROBUST VALUE SIGNAL';reason='No offered side clears the modeled probability, +5 percentage-point edge, +4% hypothetical ROI, and conservative sensitivity checks together.'}
  return {...model,overQuote,underQuote,noVigOver,noVigUnder,overSide:over,underSide:under,
   invalid,status,decision,reason,candidate:best&&decision!=='PASS'?best.name:null,
   estimatedEdge:best?.edge??null,expectedValue:best?.ev??null,
   betReady:decision==='PLAY',verifiedValue:false,play:decision==='PLAY',
   modelCalibrated:calibrated,requiredSample,availableGames:available===null?null:Math.floor(available)};
 }
 function format(r){
  const percent=n=>(100*n).toFixed(1)+'%';
  const side=(name,quote,value)=>{
   if(!quote)return name+': quote missing';
   const sign=quote.american>0?'+':'';
   if(!value)return name+': '+sign+quote.american+' · break-even '+percent(quote.implied);
   return name+': '+sign+quote.american+' · break-even '+percent(value.implied)+
    ' · estimated edge '+(value.edge>=0?'+':'')+percent(value.edge)+
    ' · hypothetical ROI '+(value.ev>=0?'+':'')+percent(value.ev);
  };
  const noVig=r.noVigOver===null?'':' No-vig market: Over '+percent(r.noVigOver)+', Under '+percent(r.noVigUnder)+'.';
  const context=r.valid?' Inputs: workload '+(r.usageRatio===null?'missing':(r.usageRatio*100).toFixed(0)+'% of baseline')+
   '; opponent adjustment '+(r.defenseRatio===null?'missing':(r.matchupEffect>=0?'+':'')+r.matchupEffect.toFixed(1)+'%')+
   '; availability '+(r.injuryStatus||'UNVERIFIED')+'. ' :'';
  const sampleGate=r.requiredSample?'; evidence minimum '+r.requiredSample+'/8'+(r.availableGames!==null&&r.availableGames<8?' based on '+r.availableGames+' available team games'):'');
  const model=r.valid?'UNCALIBRATED model Over '+percent(r.over)+', Under '+percent(r.under)+
   (r.push>.001?', Push '+percent(r.push):'')+' ('+r.sample+' recorded games'+sampleGate+'). ':
   'Model probability unavailable ('+r.sample+' recorded games). ';
  return model+context+side('Over',r.overQuote,r.overSide)+'. '+side('Under',r.underQuote,r.underSide)+'.'+noVig+
   ' '+r.status+'. '+r.reason+(r.modelCalibrated?'':' Estimated edge/EV are experimental because this live model has no approved holdout calibration. NO VERIFIED PLAY.');
 }
 return {normalCDF,nflHistory,estimate,review,format};
});
