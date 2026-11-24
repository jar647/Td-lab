/* Optional, post-simulation book comparison.
 * The score histogram is sealed before any sportsbook input is considered.
 * PLAY / LEAN / PASS are descriptive model signals, not validated betting edges.
 */
(function(root,factory){
 'use strict';
 const api=factory(root);
 if(typeof module==='object'&&module.exports)module.exports=api;
 root.CookGameOddsManualReview=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
 'use strict';
 const keys=['homeML','awayML','homeATS','awayATS','over','under'];
 const rank={PLAY:3,LEAN:2,PASS:1};
 function engine(){return root.CookGameOdds||(typeof module==='object'&&module.exports?require('./game_odds_engine.js'):null);}
 function quoteOdds(p){return p&&p.american!==null?p.american:null;}
 function settlement(bins,predicate){
  let win=0,loss=0,push=0;
  for(const [value,frequency] of Object.entries(bins)){
   const result=predicate(Number(value)),n=Number(frequency);
   if(!Number.isSafeInteger(n)||n<0)throw Error('Corrupt simulation score frequency');
   if(result>0)win+=n;else if(result<0)loss+=n;else push+=n;
  }
  return {win,loss,push};
 }
 function health(model,result,now){
  if(!result?.audit?.passed)return 'Simulation integrity has not passed';
  const sample=model?.sample||{};
  if(sample.homeGames<5||sample.awayGames<5||sample.residualGames<(model.sport==='NFL'?100:35))
   return 'Limited team or historical outcome sample';
  if(model.rotationFallback)return 'NBA rotation fallback; player availability unverified';
  if(model.sport==='NFL'){
   if(model.trust?.source_status!=='RECONCILED')return 'NFL data source not reconciled';
   const age=now-Date.parse(model.feedGeneratedAt);
   if(!Number.isFinite(age)||age< -300000||age>24*3600000)return 'NFL data feed is stale';
   if(Object.values(model.trust?.qb_context||{}).some(x=>x.status==='RETURNING_STARTER_SAMPLE_MISMATCH'))
    return 'Returning quarterback scenario is not supported';
  }
  if(model.possessionModel){
   if((model.possessionModel.uncertain||[]).length)return 'Unresolved player availability';
   const m=model.possessionModel.inputTimes||{};
   for(const [key,hours] of [['games',12],['injuries',12],['rosters',72]]){
    const age=now-Date.parse(m[key]);
    if(!Number.isFinite(age)||age< -300000||age>hours*3600000)return 'NBA '+key+' snapshot is stale';
   }
  }
  return null;
 }
 function analyze(model,result,rawMarket={},now=Date.now()){
  if(!result||!result.scoreBins||!result.audit?.passed)throw Error('Run a complete simulation before comparing odds');
  const market=engine().marketInput(rawMarket),total=result.runCount;
  const marginBins=result.scoreBins.margin,totalBins=result.scoreBins.total;
  if(!marginBins||!totalBins||!Number.isInteger(total)||total<1000)throw Error('Simulation frequency data unavailable');
  if(Object.values(marginBins).reduce((a,b)=>a+Number(b),0)!==total||
     Object.values(totalBins).reduce((a,b)=>a+Number(b),0)!==total)throw Error('Simulation score frequencies do not reconcile');
  const mlHome=settlement(marginBins,x=>Math.sign(x));
  const atsHome=market.homeSpread===null?null:settlement(marginBins,x=>Math.sign(x+market.homeSpread));
  const over=market.total===null?null:settlement(totalBins,x=>Math.sign(x-market.total));
  const flip=r=>r?{win:r.loss,loss:r.win,push:r.push}:null;
  const counts={homeML:mlHome,awayML:flip(mlHome),homeATS:atsHome,awayATS:flip(atsHome),over,under:flip(over)};
  const noVig={};
  for(const [a,b] of [['homeML','awayML'],['homeATS','awayATS'],['over','under']]){
   const pa=market.prices[a],pb=market.prices[b];
   if(pa&&pb){const sum=pa.implied+pb.implied;noVig[a]=pa.implied/sum;noVig[b]=pb.implied/sum;}
  }
  const quality=health(model,result,now);
  const hasQuoted=keys.some(k=>market.prices[k]!==null);
  const rows=keys.filter(k=>counts[k]).map(key=>{
   const c=counts[key],p=market.prices[key],win=c.win/total,loss=c.loss/total,push=c.push/total;
   const breakEven=p?p.implied*(1-push):null,modelEdge=p?win-breakEven:null;
   const ev=p?win*(p.decimal-1)-loss:null;
   const fair=win&&loss?(win/(win+loss)<.5?
    Math.round(100*loss/win):Math.round(-100*win/loss)):null;
   const label=key==='homeML'?model.home+' moneyline':key==='awayML'?model.away+' moneyline':
    key==='homeATS'?model.home+' '+(market.homeSpread>0?'+':'')+market.homeSpread:
    key==='awayATS'?model.away+' '+(-market.homeSpread>0?'+':'')+(-market.homeSpread):
    key==='over'?'Over '+market.total:'Under '+market.total;
   let decision='PASS',reason='';
   if(!p)reason='No price entered';
   else if(quality)reason=quality;
   else if(modelEdge>=.05&&ev>=.08){
    decision=key.endsWith('ATS')&&model.atsBacktestVerified!==true?'LEAN':'PLAY';
    reason=decision==='LEAN'?'Strong model discrepancy, but spread outcomes lack a verified ATS benchmark':'Strong positive model discrepancy at your quoted price';
   }else if(modelEdge>=.02&&ev>=.025){
    decision='LEAN';reason='Positive model discrepancy; smaller margin for model error';
   }else reason='No meaningful positive price discrepancy';
   return {key,label,win,loss,push,price:quoteOdds(p),implied:p?p.implied:null,
    breakEven,noVig:noVig[key]??null,modelEdge,ev,fair,signal:p?decision+' · MODEL ESTIMATE':'NO ODDS ENTERED',
    eligible:decision!=='PASS',decision,reason};
  });
  const priced=rows.filter(x=>x.price!==null);
  priced.sort((a,b)=>(rank[b.decision]-rank[a.decision])||(b.ev-a.ev)||(b.modelEdge-a.modelEdge));
  const top=priced.find(x=>x.decision!=='PASS')||null;
  const summary=top?top.decision+' · '+top.label:
   hasQuoted?'PASS · No qualifying model advantage':'NO ODDS ENTERED';
  return {result:{...result,market:{homeSpread:market.homeSpread,total:market.total},
    markets:rows,candidates:rows.filter(x=>x.eligible).map(x=>x.key)},
   status:top?.decision||'PASS',top,summary,rows,reason:quality||(!hasQuoted?'Enter a sportsbook price after simulation':'No quoted market cleared the model thresholds'),
   disclaimer:'Research-only model comparison, not an independently verified betting edge. Lines and odds never change the simulation.'};
 }
 return {analyze,health};
});
