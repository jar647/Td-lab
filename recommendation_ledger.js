/* Forward-only public recommendation ledger. No retrospective picks or price inference. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.PropShopResults=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const time=x=>typeof x==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(x)?Date.parse(x):NaN;
const num=x=>typeof x==='number'&&Number.isFinite(x);
const day=x=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(x));
function identity(p){return [p.sport,p.board,p.gameId,p.playerId||'',p.market,p.side||'',p.modelVersion].join('|');}
function valid(p,now){return p&&['NBA','NFL','UFC'].includes(p.sport)&&p.board&&p.gameId&&p.market&&p.modelVersion&&p.label&&num(time(p.capturedAt))&&num(time(p.startsAt))&&time(p.capturedAt)<time(p.startsAt)&&time(p.capturedAt)<=now&&(!['over','under','at_least'].includes(p.side)||num(p.line));}
function capture(ledger,candidates,now=Date.now()){
 const out=JSON.parse(JSON.stringify(ledger||{schema:1,picks:[]})),seen=new Map(out.picks.map(p=>[identity(p),p]));let added=0,rejected=0;
 for(const candidate of candidates){const p={...candidate,capturedAt:new Date(now).toISOString()};if(!valid(p,now)||time(p.startsAt)<=now){rejected++;continue;}
  const id=identity(p),old=seen.get(id);
  if(old){if((old.line!==p.line||old.score!==p.score||old.label!==p.label)&&!(old.revisions||[]).some(r=>r.line===p.line&&r.score===p.score&&r.label===p.label)){old.revisions=old.revisions||[];old.revisions.push({at:p.capturedAt,line:p.line,score:p.score,label:p.label});}continue;}
  const row={...p,id,day:day(p.startsAt),outcome:{status:'pending',reason:'Awaiting official result'}};out.picks.push(row);seen.set(id,row);added++;
 }
 return {ledger:out,added,rejected};
}
function settle(p,actual){if(!num(actual))return {status:'awaiting_result',reason:'Official statistic unavailable'};const won=p.side==='under'?actual<p.line:p.side==='at_least'?actual>=p.line:actual>p.line;return {status:actual===p.line&&p.side!=='at_least'?'push':won?'win':'loss',actual};}
const nbaFields={pr:['PTS','REB'],pa:['PTS','AST'],ra:['REB','AST'],pra:['PTS','REB','AST'],points_rebounds:['PTS','REB'],points_assists:['PTS','AST'],rebounds_assists:['REB','AST'],points:['PTS'],rebounds:['REB'],assists:['AST'],'Points + Rebounds':['PTS','REB'],'Points + Assists':['PTS','AST'],'Rebounds + Assists':['REB','AST'],PRA:['PTS','REB','AST']};
function nbaMadeThrees(stats={}){if(!stats||typeof stats!=='object'||Array.isArray(stats))return null;const values=[];for(const key of ['3PM','3PTM'])if(Object.hasOwn(stats,key)){const raw=stats[key],n=Number(raw);if(!['number','string'].includes(typeof raw)||String(raw).trim()===''||!Number.isInteger(n)||n<0)return null;values.push(n)}if(Object.hasOwn(stats,'3PT')){const pair=/^(\d+)-(\d+)$/.exec(String(stats['3PT']).trim());if(!pair||Number(pair[1])>Number(pair[2]))return null;values.push(Number(pair[1]))}return values.length&&values.every(n=>n===values[0])?values[0]:null;}
function gradeOne(p,data,now){
 if(!valid(p,now))return {status:'excluded',reason:'Invalid or post-start capture'};
 if(now<time(p.startsAt))return {status:'pending',reason:'Awaiting scheduled start'};
 if(p.sport==='NBA'){
  const g=(data.nba?.games||[]).find(g=>String(g.id)===p.gameId);if(!g)return {status:'pending',reason:'Game result not yet published'};
  if(/CANCEL|POSTPON/.test(g.status))return {status:'void',reason:'Game cancelled/postponed'};
  if(g.status!=='STATUS_FINAL')return {status:time(p.startsAt)<=now?'live':'pending',reason:'Not final'};
  const rows=(g.players||[]).filter(r=>String(r.id)===p.playerId&&r.team===p.team);if(rows.length!==1)return {status:'awaiting_result',reason:'Player identity/box score unresolved'};const r=rows[0];
  const raw=r.stats?.MIN,parts=String(raw??'').split(':'),mins=raw===null||raw===undefined||raw===''?NaN:parts.length===2?Number(parts[0])+Number(parts[1])/60:Number(raw);
  if(r.didNotPlay||mins===0)return {status:'void',reason:'DNP (participation required)'};if(!num(mins)||mins<0)return {status:'awaiting_result',reason:'Minutes unverified'};
  if(p.market==='first_basket'){
   if(r.starter===false)return {status:'void',reason:'Did not start (first-basket house rule)'};
   if(r.starter!==true||!g.first_basket?.available||!g.first_basket.first_game?.player_id)return {status:'awaiting_result',reason:'Opening field goal / starter result unavailable'};
   const won=String(g.first_basket.first_game.player_id)===p.playerId&&g.first_basket.first_game.team===p.team;return {status:won?'win':'loss',actual:g.first_basket.first_game.player_id};
  }
  if(p.market==='threes'){const actual=nbaMadeThrees(r.stats);return actual===null?{status:'awaiting_result',reason:'Official made-three statistic missing or conflicting'}:settle(p,actual);}
  const fields=nbaFields[p.market];if(!fields)return {status:'awaiting_result',reason:'Unsupported market'};
  const values=fields.map(k=>r.stats?.[k]);if(values.some(v=>v===null||v===undefined||v===''||(!Number.isFinite(Number(v))||Number(v)<0)))return {status:'awaiting_result',reason:'Official statistic missing'};
  return settle(p,values.reduce((s,v)=>s+Number(v),0));
 }
 if(p.sport==='NFL'){
  const g=(data.nfl?.games||[]).find(g=>g.gameId===p.gameId);if(!g||!g.final)return {status:time(p.startsAt)<=now?'awaiting_result':'pending',reason:'Awaiting official final and participation data'};
  const rows=(g.players||[]).filter(r=>r.playerId===p.playerId&&r.team===p.team);
  if(rows.length!==1||!rows[0].participationVerified)return {status:'awaiting_result',reason:'Snap-verified player result unavailable; no zero inferred'};
  if(rows[0].didNotPlay)return {status:'void',reason:'Verified DNP'};
  if(p.market==='anytime_td'){const td=rows[0].scoredTD;return typeof td==='boolean'?{status:td?'win':'loss',actual:td?1:0}:{status:'awaiting_result',reason:'Rushing/receiving TD result unavailable'};}
  return settle(p,rows[0][p.market]);
 }
 if(p.sport==='UFC'){
  const g=(data.ufc?.bouts||[]).find(g=>String(g.bout_id)===p.gameId);if(!g)return {status:time(p.startsAt)<=now?'awaiting_result':'pending',reason:'Official bout result unavailable'};
  if(/cancel|postpon/i.test(g.status||''))return {status:'void',reason:'Bout cancelled/postponed'};
  if(!/final|complete|post/i.test(g.status||''))return {status:'pending',reason:'Bout not final'};
  if(/draw|no.?contest/i.test(g.method_display||g.method||''))return {status:'void',reason:'Draw/no contest (house rule)'};if(!g.winner)return {status:'awaiting_result',reason:'Official winner missing; no draw inferred'};
  if(p.market==='winner')return {status:String(g.winner)===p.playerId?'win':'loss',actual:g.winner};
  if(p.market==='method'){const m=String(g.method_display||g.method||'');const method=/submission/i.test(m)?'submission':/decision/i.test(m)?'decision':/\bko\b|tko|kotko|knockout/i.test(m)?'ko':null;if(!method)return {status:'awaiting_result',reason:'Finish method unavailable'};return {status:String(g.winner)===p.playerId&&method===p.method?'win':'loss',actual:method};}
  const clock=/^(\d+):(\d{2})$/.exec(String(g.end_clock||''));if(!clock||!Number.isInteger(g.end_round)||g.end_round<1||g.end_round>5||Number(clock[2])>=60||Number(clock[1])*60+Number(clock[2])>300)return {status:'awaiting_result',reason:'Finish round/time unavailable'};
  return settle(p,(g.end_round-1)+(Number(clock[1])*60+Number(clock[2]))/300);
 }
 return {status:'awaiting_result',reason:'Unsupported sport'};
}
function grade(ledger,data,now=Date.now()){return {...ledger,picks:ledger.picks.map(p=>({...p,outcome:{...gradeOne(p,data,now),checkedAt:new Date(now).toISOString()}}))};}
function wilson(w,n){if(!n)return null;const z=1.96,d=1+z*z/n,center=(w/n+z*z/(2*n))/d,half=z*Math.sqrt(w/n*(1-w/n)/n+z*z/(4*n*n))/d;return [Math.max(0,center-half),Math.min(1,center+half)];}
function stats(rows){const wins=rows.filter(r=>r.outcome.status==='win').length,losses=rows.filter(r=>r.outcome.status==='loss').length,n=wins+losses;let units=0,priced=0;
 for(const r of rows){if(!['win','loss'].includes(r.outcome.status)||!num(r.americanOdds)||Math.abs(r.americanOdds)<100||!num(time(r.priceObservedAt))||time(r.priceObservedAt)>time(r.capturedAt)||time(r.priceObservedAt)>=time(r.startsAt))continue;priced++;units+=r.outcome.status==='loss'?-1:r.americanOdds>0?r.americanOdds/100:100/-r.americanOdds;}
 const probabilistic=rows.filter(r=>['win','loss'].includes(r.outcome.status)&&num(r.probability)&&r.probability>0&&r.probability<1);
 return {probabilitySample:probabilistic.length,meanEstimate:probabilistic.length?probabilistic.reduce((s,r)=>s+r.probability,0)/probabilistic.length:null,brier:probabilistic.length?probabilistic.reduce((s,r)=>s+(r.probability-(r.outcome.status==='win'?1:0))**2,0)/probabilistic.length:null,tracked:rows.length,wins,losses,settled:n,hitRate:n?wins/n:null,interval:wilson(wins,n),pending:rows.filter(r=>['pending','live'].includes(r.outcome.status)).length,awaiting:rows.filter(r=>r.outcome.status==='awaiting_result').length,voids:rows.filter(r=>r.outcome.status==='void').length,pushes:rows.filter(r=>r.outcome.status==='push').length,excluded:rows.filter(r=>r.outcome.status==='excluded').length,playerGames:new Set(rows.filter(r=>['win','loss'].includes(r.outcome.status)).map(r=>r.sport+'|'+r.gameId+'|'+r.playerId)).size,games:new Set(rows.filter(r=>['win','loss'].includes(r.outcome.status)).map(r=>r.gameId)).size,days:new Set(rows.filter(r=>['win','loss'].includes(r.outcome.status)).map(r=>r.day)).size,priced,units:priced?units:null,roi:priced?units/priced:null};}
function scoreBand(p){if(!num(p.score)){if(num(p.probability)){const b=Math.min(90,Math.floor(p.probability*10)*10);return b+'–'+(b+10)+'% estimate';}return p.confidence||'Not scored';}if(p.score>100)return '101+';if(p.score>=95)return '95–100';const low=Math.floor(p.score/5)*5;return low+'–'+Math.min(100,low+4);}
function captureCoverage(picks,fixtures,date){
 const all=picks.filter(p=>p.sport==='NBA'),rows=all.filter(p=>p.day===date);
 const start=all.length?all.reduce((s,p)=>time(p.capturedAt)<time(s)?p.capturedAt:s,all[0].capturedAt):null;
 const games=[...new Map((fixtures||[]).filter(g=>Number.isFinite(Date.parse(g.date))&&day(g.date)===date).map(g=>[String(g.id),g])).values()];
 const covered=new Set(rows.map(p=>p.gameId)),boards={};for(const p of rows)boards[p.board]=(boards[p.board]||0)+1;
 const earlier=games.filter(g=>start&&Date.parse(g.date)<=time(start)&&!covered.has(String(g.id)));
 return {sport:'NBA',day:date,fixtures:games.map(g=>({id:String(g.id),date:g.date,home:g.home,away:g.away})),captureStartedAt:start,firstCaptureDay:start?day(start):null,partialFirstDay:!!(start&&day(start)===date&&earlier.length),recorded:rows.length,boards,scheduledGames:games.length,gamesWithPicks:games.filter(g=>covered.has(String(g.id))).length,gamesWithoutPicks:games.filter(g=>!covered.has(String(g.id))).map(g=>({gameId:String(g.id),game:g.away+' @ '+g.home,startsAt:g.date,startedBeforeTracking:!!(start&&Date.parse(g.date)<=time(start))})),earlierStartsWithoutPicks:earlier.length};
}
function summarize(ledger,now=Date.now()){
 const picks=ledger.picks,groups=new Map(),days=new Map();
 for(const p of picks){if(!days.has(p.day))days.set(p.day,[]);days.get(p.day).push(p);const key=[p.sport,p.board,p.modelVersion,p.market,p.side,p.scoreKind||'none'].join('|');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);}
 return {schema:1,generatedAt:new Date(now).toISOString(),startedAt:picks.length?picks.reduce((a,p)=>p.capturedAt<a?p.capturedAt:a,picks[0].capturedAt):null,overall:stats(picks),days:[...days].sort((a,b)=>b[0].localeCompare(a[0])).map(([day,rows])=>({day,...stats(rows)})),groups:[...groups].map(([key,rows])=>{const buckets=new Map();for(const p of rows){const b=scoreBand(p);if(!buckets.has(b))buckets.set(b,[]);buckets.get(b).push(p);}const settled=rows.filter(p=>num(p.score)&&['win','loss'].includes(p.outcome.status));const cutoff=rows[0].scoreKind?.includes('TD opportunity')?60:rows[0].scoreKind?.includes('raw rank')?100:90,high=settled.filter(p=>p.score>=cutoff),low=settled.filter(p=>p.score<cutoff),hs=stats(high),ls=stats(low),enough=hs.settled>=30&&ls.settled>=30&&new Set(settled.map(p=>p.gameId)).size>=30&&new Set(settled.map(p=>p.day)).size>=10;return {key,sport:rows[0].sport,board:rows[0].board,modelVersion:rows[0].modelVersion,market:rows[0].market,side:rows[0].side,scoreKind:rows[0].scoreKind,...stats(rows),bands:[...buckets].sort((a,b)=>a[0].localeCompare(b[0],undefined,{numeric:true})).map(([band,list])=>({band,...stats(list)})),scoreTest:{cutoff,status:!rows.some(p=>num(p.score))?'NOT_NUMERIC_SCORE':enough?'DESCRIPTIVE_ONLY':'INSUFFICIENT_EVIDENCE',high:hs,low:ls,difference:hs.hitRate!==null&&ls.hitRate!==null?hs.hitRate-ls.hitRate:null,reason:!rows.some(p=>num(p.score))?'This board supplies experimental frequencies or evidence categories, not a /100 score. Compare its estimate/evidence bands and observed outcomes instead.':enough?'Compare matched market/side results; shared games and chosen line difficulty still confound score effects. This does not prove causation or profitability.':'Need at least 30 settled picks on each side of '+cutoff+', 30 distinct games and 10 dates within the same market, side and model version. No evidence claim yet.'}};}),picks};
}
return {captureCoverage,capture,grade,gradeOne,valid,identity,settle,stats,wilson,scoreBand,summarize};
});
