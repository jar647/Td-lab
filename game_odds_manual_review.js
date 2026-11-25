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
 const rank={PLAY:3,LEAN:2,PASS:1,HOLD:0};
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
 // Only accept complete, reconciled scenario histograms from the sealed draw set.
 function verifiedScenarios(model,result){
  const data=result.possession?.availabilityScenarios;
  if(!result.possession?.strengthAnchor||data?.version!=='balanced-availability-v1')return null;
  const players=Object.values(model.possessionModel?.teams||{}).flatMap(t=>t.players||[]).filter(p=>p.pending).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  if(!players.length||players.length>5||!Array.isArray(data.players)||!Array.isArray(data.rows)||data.players.length!==players.length||data.rows.length!==2**players.length)return null;
  if(players.some((p,i)=>String(p.id)!==data.players[i].id||p.name!==data.players[i].name||p.team!==data.players[i].team||p.status!==data.players[i].status))return null;
  const sums={margin:{},total:{}},masks=new Set();let n=0;
  for(const r of data.rows){
   if(!Number.isInteger(r.mask)||r.mask<0||r.mask>=data.rows.length||masks.has(r.mask)||!Number.isSafeInteger(r.count)||r.count<1000||Math.abs(r.count-result.runCount/data.rows.length)>1)return null;
   masks.add(r.mask);n+=r.count;
   const expected=players.filter((p,i)=>r.mask&(1<<i)).map(p=>String(p.id)),inactive=players.filter((p,i)=>!(r.mask&(1<<i))).map(p=>String(p.id));
   if(JSON.stringify(expected)!==JSON.stringify(r.active)||JSON.stringify(inactive)!==JSON.stringify(r.inactive))return null;
   for(const k of ['margin','total']){
    if(!r.scoreBins?.[k])return null;
    let sum=0;for(const [v,c] of Object.entries(r.scoreBins[k])){
     if(!Number.isInteger(Number(v))||!Number.isSafeInteger(c)||c<0)return null;
     sum+=c;sums[k][v]=(sums[k][v]||0)+c;
    }if(sum!==r.count)return null;
   }
  }
  if(n!==result.runCount)return null;
  for(const k of ['margin','total'])for(const v of new Set([...Object.keys(sums[k]),...Object.keys(result.scoreBins[k])]))if((sums[k][v]||0)!==(result.scoreBins[k][v]||0))return null;
  return data;
 }
 function tier(edge,ev){return edge>=.05&&ev>=.08?'PLAY':edge>=.02&&ev>=.025?'LEAN':'PASS';}
 function scenarioPrices(data,key,market,p){
  if(!data||!p)return null;
  const k=key==='over'||key==='under'?'total':'margin',sign=['awayML','awayATS','under'].includes(key)?-1:1,shift=key.endsWith('ATS')?market.homeSpread:k==='total'?-market.total:0;
  return data.rows.map(r=>{
   const c=settlement(r.scoreBins[k],x=>sign*(x+shift)),win=c.win/r.count,loss=c.loss/r.count,push=c.push/r.count;
   const edge=win-p.implied*(1-push),ev=win*(p.decimal-1)-loss;
   const names=ids=>ids.map(id=>{const player=data.players.find(p=>p.id===id);return player.name+' ('+player.team+')';});
   return {active:names(r.active),inactive:names(r.inactive),count:r.count,win,loss,push,edge,ev,decision:tier(edge,ev)};
  });
 }
 function health(model,result,now,scenarios=verifiedScenarios(model,result)){
  if(!result?.audit?.passed)return 'Simulation integrity has not passed';
  const sample=model?.sample||{};
  if(sample.homeGames<5||sample.awayGames<5||sample.residualGames<(model.sport==='NFL'?100:35))
   return 'Limited team or historical outcome sample';
  if(model.strengthRequired&&!result.possession?.strengthAnchor)return 'Opponent-adjusted scoring model unavailable: '+(model.strengthError||'rotation data missing');
  if(model.rotationFallback)return 'NBA rotation fallback; player availability unverified';
  if(model.sport==='NFL'){
   if(model.trust?.source_status!=='RECONCILED')return 'NFL data source not reconciled';
   const age=now-Date.parse(model.feedGeneratedAt);
   if(!Number.isFinite(age)||age< -300000||age>24*3600000)return 'NFL data feed is stale';
   if(Object.values(model.trust?.qb_context||{}).some(x=>x.status==='RETURNING_STARTER_SAMPLE_MISMATCH'))
    return 'Returning quarterback scenario is not supported';
  }
  if(model.possessionModel){
   if(!scenarios&&((model.possessionModel.uncertain||[]).length||model.strengthRequired&&Object.values(model.possessionModel.teams||{}).some(t=>(t.players||[]).some(p=>p.pending)))){
    const names=[...new Set([...(model.possessionModel.uncertain||[]),...Object.values(model.possessionModel.teams||{}).flatMap(t=>(t.players||[]).filter(p=>p.pending).map(p=>p.name))])];
    const players=Object.values(model.possessionModel.teams||{}).flatMap(t=>t.players||[]);
    return 'Unresolved player availability: '+names.map(name=>{const p=players.find(x=>x.name===name);return p?name+' ('+p.status+', '+p.team+')':name;}).join('; ');
   }
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
  const scenarios=verifiedScenarios(model,result),quality=health(model,result,now,scenarios);
  const strengthAPI=model.sport==='NBA'?(root.CookNBASpreadStrength||(typeof module==='object'&&module.exports?require('./nba_spread_strength.js'):null)):null;
  const integrated=!!result.possession?.strengthAnchor;
  const strength=integrated?null:strengthAPI?.distribution(model.spreadStrength,result)||null;
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
   const ats=key.endsWith('ATS');
   const alternative=ats&&strength?strengthAPI.cover(strength,market.homeSpread,key==='homeATS'):null;
   const strengthCover=alternative&&p?{...alternative,breakEven:p.implied*(1-alternative.push),modelEdge:alternative.win-p.implied*(1-alternative.push),ev:alternative.win*(p.decimal-1)-alternative.loss}:null;
   // Freeze probabilities first; only the quoted line/price changes the model signal.
   // For NBA ATS, use the lower of both estimates rather than promoting a disputed signal.
   const availability=scenarioPrices(scenarios,key,market,p);
   const decisionEdge=availability?Math.min(...availability.map(r=>r.edge)):strengthCover?Math.min(modelEdge,strengthCover.modelEdge):modelEdge;
   const decisionEV=availability?Math.min(...availability.map(r=>r.ev)):strengthCover?Math.min(ev,strengthCover.ev):ev;
   let decision='PASS',reason='';
   if(!p)reason='No price entered';
   else if(quality){decision='HOLD';reason=quality;}
   else if(availability){
    const supported=availability.filter(r=>r.decision!=='PASS').length;
    if(supported===availability.length){decision=tier(decisionEdge,decisionEV);reason='Value survives every modeled availability scenario; conservative price signal, experimental';}
    else if(!supported){decision='PASS';reason='No qualifying value in any modeled availability scenario';}
    else{decision='HOLD';reason='Player availability materially changes this market’s value; rerun when status is confirmed';}
   }
   else if(model.sport==='NBA'&&ats&&!integrated&&!strengthCover)reason='Opponent-adjusted spread comparison unavailable (experimental candidate supports half-point lines only)';
   else if(decisionEdge>=.05&&decisionEV>=.08){
    decision='PLAY';reason='Strong model-estimated value at your quoted price; experimental, not a verified betting edge';
   }else if(decisionEdge>=.02&&decisionEV>=.025){
    decision='LEAN';reason='Positive model-estimated value at your quoted price; smaller margin for model error';
   }else if(strengthCover&&(modelEdge>=.02&&ev>=.025||strengthCover.modelEdge>=.02&&strengthCover.ev>=.025))reason='Both spread estimates must support value; agreement insufficient';
   else reason='No meaningful positive price discrepancy';
   return {key,label,win,loss,push,price:quoteOdds(p),implied:p?p.implied:null,
    breakEven,noVig:noVig[key]??null,modelEdge,ev,fair,signal:p?decision+' · EXPERIMENTAL MODEL ESTIMATE':'NO ODDS ENTERED',
    strengthCover,availability,decisionEdge,decisionEV,eligible:decision==='PLAY'||decision==='LEAN',decision,reason};
  });
  const priced=rows.filter(x=>x.price!==null);
  priced.sort((a,b)=>(rank[b.decision]-rank[a.decision])||(b.decisionEV-a.decisionEV)||(b.decisionEdge-a.decisionEdge));
  const top=priced.find(x=>x.eligible)||null;
  const hasHold=priced.some(x=>x.decision==='HOLD');
  const summary=top?top.decision+' · '+top.label:
   hasQuoted?(quality?'HOLD · Data or availability hold':hasHold?'HOLD · Availability-sensitive markets':'PASS · No qualifying model advantage'):'NO ODDS ENTERED';
  return {result:{...result,market:{homeSpread:market.homeSpread,total:market.total},
    markets:rows,candidates:rows.filter(x=>x.eligible).map(x=>x.key)},
   status:top?.decision||(hasQuoted&&(quality||hasHold)?'HOLD':'PASS'),top,summary,rows,reason:quality||(!hasQuoted?'Enter a sportsbook price after simulation':hasHold?'Availability changes the price decision for at least one market':'No quoted market cleared the model thresholds'),
   disclaimer:'Research-only model comparison, not an independently verified betting edge. Lines and odds never change the simulation.'};
 }
 return {analyze,health};
});
