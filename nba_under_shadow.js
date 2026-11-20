/* NBA UNDER shadow research: never included in live recommendations or Quick Slip. */
(function(root,factory){
 const api=factory(typeof module==='object'&&module.exports?require('./nba_prop_lines'):root.CookNBAPropLines);
 if(typeof module==='object'&&module.exports)module.exports=api;
 root.PropShopNBAUnderShadow=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(lines){
 'use strict';
 const components={points:['points'],rebounds:['rebounds'],assists:['assists'],threes:['threes'],pr:['points','rebounds'],pa:['points','assists'],ra:['rebounds','assists'],pra:['points','rebounds','assists']};
 const boxKeys={points:'PTS',rebounds:'REB',assists:'AST'};
 const clamp=x=>Math.max(0,Math.min(1,x));
 const finite=x=>typeof x==='number'&&Number.isFinite(x);
 const statuses=new Set(['NOT LISTED','ACTIVE','AVAILABLE','PROBABLE']);
 const band=score=>score>=95?'95–100':score>=90?'90–94':score>=85?'85–89':'BELOW';
 function roleSupported(role,row){
  return !!role&&role.eligible===true&&role.roleStatus==='SUPPORTED'&&statuses.has(String(role.status||'').toUpperCase())&&
   String(role.playerId)===String(row.playerId)&&role.team===row.team&&Number.isInteger(role.historyGames)&&role.historyGames>=5&&
   finite(role.projectedMinutes)&&finite(role.minutesLow)&&finite(role.minutesHigh)&&role.minutesLow>=20&&
   role.minutesHigh<=48&&role.minutesHigh-role.minutesLow<=6&&role.projectedMinutes>=role.minutesLow-.01&&
   role.projectedMinutes<=role.minutesHigh+.01&&Array.isArray(role.holdReasons)&&role.holdReasons.length===0;
 }
 function evaluate(analysis,rosters,now=Date.now()){
  if(analysis?.reason||!Array.isArray(analysis?.rows)||!Array.isArray(analysis?.underWeaknesses))return [];
  const result=[],weaknesses=analysis.underWeaknesses.filter(w=>w.side==='under');
  for(const row of analysis.rows){
   if(row.side!=='over'||row.reviewRequired||!row.samples||row.samples.length<1000||!row.samples.every(x=>finite(x)&&x>=0)||!finite(row.forecast)||row.forecast<=0||!finite(row.baseline)||row.baseline<=0||!roleSupported(row.roleEvidence,row))continue;
   if(row.game?.status!=='STATUS_SCHEDULED'||!Number.isFinite(Date.parse(row.game.date))||Date.parse(row.game.date)<=now)continue;
   const market=lines.canonical(row.market),keys=components[market],position=rosters?.players?.[String(row.playerId)]?.position||row.position;
   if(!keys||!['PG','SG','SF','PF','C'].includes(position))continue;
   const opposed=keys.map(key=>weaknesses.find(w=>w.team===row.opponent&&w.attacking===row.team&&w.position===position&&w.market===key&&w.games>=5&&finite(w.excess)&&w.excess>0));
   if(opposed.some(w=>!w))continue;
   const depth=Math.min(row.roleEvidence.historyGames,...opposed.map(w=>w.games));
   const suppression=Math.min(...opposed.map(w=>w.excess));
   const minuteRange=row.roleEvidence.minutesHigh-row.roleEvidence.minutesLow;
   const decline=1-row.forecast/row.baseline;
   const factors=[
    {label:'Opponent suppression by position (shrunk and schedule-adjusted)',points:Math.round(40*clamp(suppression/.30)),max:40},
    {label:'Supported and stable minutes',points:Math.round(25*clamp(1-minuteRange/8)),max:25},
    {label:'Simulated projection below recorded player baseline',points:Math.round(20*clamp(decline/.25)),max:20},
    {label:'Verified player and opponent samples',points:Math.round(15*clamp(depth/10)),max:15}
   ];
   const score=factors.reduce((sum,x)=>sum+x.points,0);
   if(!lines.qualifiesScore(score,market,'under'))continue;
   const target=lines.select({market,side:'under',samples:row.roleEvidence.selectionSamples?.[market],sampleKind:row.roleEvidence.sampleKind||'role_adjusted_history'});
   if(!target.available||!finite(target.line)||target.line<=0||!(row.forecast<=target.line*.9))continue;
   const simulated=lines.evaluateSide(row.samples,target.line,'under');
   if(!simulated.available||simulated.count<1000||simulated.winFrequency<.70)continue;
   if(!row.inputTimes||!['games','injuries','rosters'].every(k=>Number.isFinite(Date.parse(row.inputTimes[k]))))continue;
   result.push({key:row.key+'|under-shadow',gameId:String(row.gameId),game:row.game,startsAt:row.game.date,playerId:String(row.playerId),player:row.name,team:row.team,opponent:row.opponent,position,
    market,side:'under',score,line:target.line,projection:row.forecast,recordedBaseline:row.baseline,simulatedFrequency:simulated.winFrequency,
    simulatedRuns:simulated.count,sourceTimestamps:{...row.inputTimes},sampleDepth:depth,factors,studyOnly:true,priceVerified:false,probabilityCalibrated:false,
    reason:'Suppressed defensive position rate, stable supported role, lower simulated forecast and at least 70% experimental UNDER clears. Sportsbook line unverified.'});
  }
  return result.sort((a,b)=>b.score-a.score||b.simulatedFrequency-a.simulatedFrequency||a.key.localeCompare(b.key));
 }
 function number(raw){if(raw===undefined||raw===null||String(raw).trim()==='')return null;const n=Number(raw);return finite(n)&&n>=0?n:null;}
 function recordedMarket(player,market){
  if(!player||player.didNotPlay)return null;
  const stats=player.stats||{},parts=components[lines.canonical(market)];
  if(!parts)return null;
  let sum=0;
  for(const p of parts){let n;
   if(p==='threes'){const raw=stats['3PM']??stats['3PTM']??stats['3PT'];const m=/^(\d+)-(\d+)$/.exec(String(raw??''));n=m?Number(m[1]):number(raw);}
   else n=number(stats[boxKeys[p]]);
   if(n===null)return null;sum+=n;
  }
  return sum;
 }
 function summarize(picks){
  const graded=picks.filter(p=>['win','loss'].includes(p.result));
  const groups={};
  for(const p of graded){const key=p.market+'|'+band(p.score),g=groups[key]||{market:p.market,band:band(p.score),n:0,wins:0,sumProbability:0,brierSum:0};
   g.n++;g.wins+=p.result==='win'?1:0;g.sumProbability+=p.simulatedFrequency;g.brierSum+=(p.simulatedFrequency-(p.result==='win'?1:0))**2;groups[key]=g;
  }
  const rows=Object.values(groups).map(g=>({market:g.market,band:g.band,n:g.n,observedHitRate:g.wins/g.n,meanSimulatedFrequency:g.sumProbability/g.n,brier:g.brierSum/g.n,statisticallyReviewed:g.n>=30})).sort((a,b)=>a.market.localeCompare(b.market)||a.band.localeCompare(b.band));
  return {captured:picks.length,graded:graded.length,pending:picks.filter(p=>p.result==='pending').length,void:picks.filter(p=>p.result==='void').length,probabilitiesCalibrated:false,betReady:false,groups:rows};
 }
 function update(ledger,analyses,feed,now=Date.now()){
  const picks=Array.isArray(ledger?.picks)?ledger.picks.map(x=>({...x})):[],keys=new Set(picks.map(x=>x.gameId+'|'+x.playerId+'|'+x.market));
  const fixtures=new Map((feed?.games||[]).map(g=>[String(g.id),g]));
  for(const p of picks){if(p.result!=='pending')continue;const game=fixtures.get(p.gameId);if(!game||game.status!=='STATUS_FINAL'||Date.parse(game.date)>now)continue;
   const player=(game.players||[]).find(x=>String(x.id)===p.playerId);
   if(player?.didNotPlay){p.result='void';p.gradedAt=new Date(now).toISOString();continue}
   const actual=recordedMarket(player,p.market);
   if(actual===null)continue;
   p.actual=actual;p.result=actual<p.line?'win':actual>p.line?'loss':'push';p.gradedAt=new Date(now).toISOString();
  }
  for(const analysis of analyses||[])for(const p of evaluate(analysis.analysis,analysis.rosters,now)){
   const key=p.gameId+'|'+p.playerId+'|'+p.market;
   if(keys.has(key)||Date.parse(p.startsAt)<=now)continue;
   keys.add(key);p.capturedAt=new Date(now).toISOString();p.result='pending';p.frozen=true;
   picks.push(p);
  }
  return {version:1,picks,summary:summarize(picks)};
 }
 return {evaluate,recordedMarket,summarize,update};
});
