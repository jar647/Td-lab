/* Forward-only NBA prop evidence. Related selections are sampled by game. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.PropShopNBAValidation=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const VERSION='nba-prop-validation-v1',UNKNOWN='UNKNOWN';
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const text=value=>typeof value==='string'&&value.trim()?value.trim():null;
const settled=p=>['win','loss'].includes(p.outcome?.status);
const stamp=value=>typeof value==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(value)?Date.parse(value):NaN;
const canonical=market=>({'Points + Rebounds':'pr','Points + Assists':'pa','Rebounds + Assists':'ra',PRA:'pra'}[market]||market);
const markets=new Set(['points','rebounds','assists','threes','pr','pa','ra','pra']);
const mean=values=>values.length?values.reduce((s,x)=>s+x,0)/values.length:null;
function frozenEvidenceKey(p){
 const selection=object(object(p.inputs).selectionEvidence),line=object(selection.line),role=object(selection.role),defense=object(selection.defense);
 // Compare the captured inputs themselves, not just their coarser reporting buckets.
 return JSON.stringify([role.projectedMinutes,role.minutesLow,role.minutesHigh,role.historyGames,role.roleStatus,
  line.policy,line.sampleKind,line.frequency,line.milestone,line.strictOverLine,
  defense.basis,defense.normalizedAllowed,defense.normalizedLeagueAverage,defense.shrinkage]);
}
const random=seed=>{let state=seed>>>0;return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};};
function settings(options={}){return {resamples:Number.isInteger(options.resamples)?Math.max(100,Math.min(2000,options.resamples)):400,seed:Number.isInteger(options.seed)?options.seed>>>0:6472026};}
function lineRange(p,market){
 const raw=p.line;if(!finite(raw)||raw<0)return UNKNOWN;
 const strict=p.side==='at_least'?raw-.5:raw;
 const width=['rebounds','assists'].includes(market)?5:market==='threes'?2:['pr','pa','ra','pra'].includes(market)?15:10;
 const low=Math.max(0,Math.floor(Math.max(0,strict)/width)*width);
 return low+'–<'+(low+width)+(p.side==='under'?' strict-UNDER line':' strict-OVER line');
}
function evidence(p){
 const selection=object(object(p.inputs).selectionEvidence),line=object(selection.line),role=object(selection.role);
 const linePolicy=text(line.policy)||UNKNOWN,sampleKind=text(line.sampleKind)||UNKNOWN;
 const lineComplete=['over','at_least'].includes(p.side)&&finite(line.frequency)&&line.frequency>=0&&line.frequency<=1&&finite(line.milestone)&&line.milestone>0&&
  finite(line.strictOverLine)&&line.strictOverLine>=.5&&Math.abs(line.milestone-line.strictOverLine-.5)<1e-8&&
  Math.abs(p.line-(p.side==='at_least'?line.milestone:line.strictOverLine))<1e-8;
 const validMinutes=finite(role.projectedMinutes)&&role.projectedMinutes>0&&role.projectedMinutes<=60&&
  finite(role.minutesLow)&&finite(role.minutesHigh)&&role.minutesLow>=0&&role.minutesLow<=role.projectedMinutes&&
  role.projectedMinutes<=role.minutesHigh&&role.minutesHigh<=60&&Number.isInteger(role.historyGames)&&role.historyGames>=3;
 const bucket=validMinutes?(role.projectedMinutes<24?'<24':role.projectedMinutes<32?'24–<32':'32+')+' projected min · '+
  (role.minutesHigh-role.minutesLow<=4?'stable':role.minutesHigh-role.minutesLow<=8?'variable':'uncertain'):UNKNOWN;
 return {linePolicy,sampleKind,roleRange:bucket,metadataComplete:linePolicy!==UNKNOWN&&sampleKind!==UNKNOWN&&validMinutes&&lineComplete};
}
function totals(rows){
 const done=rows.filter(settled),wins=done.filter(p=>p.outcome.status==='win').length;
 return {tracked:rows.length,settled:done.length,wins,losses:done.length-wins,hitRate:done.length?wins/done.length:null,
  games:new Set(done.map(p=>p.gameId)).size,playerGames:new Set(done.map(p=>p.gameId+'|'+p.playerId)).size,
  days:new Set(done.map(p=>p.day).filter(Boolean)).size,
  pending:rows.filter(p=>['pending','live'].includes(p.outcome?.status)).length,
  unresolved:rows.filter(p=>!['win','loss','pending','live','void','push','excluded'].includes(p.outcome?.status)).length,
  voids:rows.filter(p=>p.outcome?.status==='void').length,pushes:rows.filter(p=>p.outcome?.status==='push').length};
}
function clusterInterval(rows,options={}){
 const done=rows.filter(settled),clusters=new Map();
 for(const p of done){if(!clusters.has(p.gameId))clusters.set(p.gameId,{wins:0,n:0});const c=clusters.get(p.gameId);c.n++;c.wins+=Number(p.outcome.status==='win');}
 const values=[...clusters.values()],config=settings(options),method='Whole-game percentile bootstrap; all related selections in a sampled game stay together.';
 if(values.length<2)return {interval:null,clusters:values.length,resamples:0,method,reason:'At least two distinct settled games are needed; one game cannot establish independent sampling uncertainty.'};
 if(values.every(c=>c.wins===0)||values.every(c=>c.wins===c.n))return {interval:null,clusters:values.length,resamples:0,method,reason:'No observed wins or no observed losses; resampling cannot estimate unseen outcome risk.'};
 const draw=random(config.seed),rates=[];
 for(let n=0;n<config.resamples;n++){let wins=0,total=0;for(let i=0;i<values.length;i++){const c=values[Math.floor(draw()*values.length)];wins+=c.wins;total+=c.n;}rates.push(wins/total);}
 rates.sort((a,b)=>a-b);const low=rates[Math.floor((rates.length-1)*.025)],high=rates[Math.ceil((rates.length-1)*.975)];
 return {interval:low===high?null:[low,high],clusters:values.length,resamples:config.resamples,method,
  reason:low===high?'Observed game clusters have no resampled variation; no precision claim is supplied.':'Descriptive uncertainty across observed games; not proof of predictive accuracy or profitability.'};
}
const band=score=>score>=95?'95–100':score>=90?'90–94':'85–89';
function summarize(rows,options){return {...totals(rows),clusterUncertainty:clusterInterval(rows,options)};}
function scoreComparison(rows,metadataComplete,options){
 const low=rows.filter(p=>p.score<90),high=rows.filter(p=>p.score>=90),lo=totals(low),hi=totals(high),all=totals(rows);
 const enough=[lo,hi].every(x=>x.settled>=30&&x.games>=30&&x.days>=10);
 let status='INSUFFICIENT_EVIDENCE',reason='Need at least 30 settled selections, 30 distinct games and 10 dates in each score range within a matched market, side, model, line-policy, line-range and role stratum. Correlated picks from one game cannot supply independent game coverage.';
 if(enough&&!metadataComplete){status='INSUFFICIENT_METADATA';reason='Earlier records lack frozen line-policy or role evidence. Missing metadata stays unknown; it is not reconstructed after results.';}
 else if(enough){status='DESCRIPTIVE_COMPARISON_ONLY';reason='Matched descriptive comparison; uncertainty, shared outcomes and observational selection do not establish causation, calibrated probabilities or a betting edge.';}
 const clusters=new Map();
 for(const p of rows.filter(settled)){if(!clusters.has(p.gameId))clusters.set(p.gameId,{lowWins:0,low:0,highWins:0,high:0});const c=clusters.get(p.gameId),prefix=p.score<90?'low':'high';c[prefix]++;c[prefix+'Wins']+=Number(p.outcome.status==='win');}
 const config=settings(options),draw=random(config.seed+17),values=[...clusters.values()],differences=[];
 if(enough&&metadataComplete)for(let n=0;n<config.resamples;n++){let lw=0,ln=0,hw=0,hn=0;for(let i=0;i<values.length;i++){const c=values[Math.floor(draw()*values.length)];lw+=c.lowWins;ln+=c.low;hw+=c.highWins;hn+=c.high;}if(ln&&hn)differences.push(hw/hn-lw/ln);}
 differences.sort((a,b)=>a-b);const l=differences[Math.floor((differences.length-1)*.025)],h=differences[Math.ceil((differences.length-1)*.975)];
 return {status,cutoff:90,low:lo,high:hi,difference:lo.hitRate!==null&&hi.hitRate!==null?hi.hitRate-lo.hitRate:null,
  differenceInterval:differences.length>=100&&l!==h?[l,h]:null,clusters:all.games,reason};
}
function analyze(picks,options={}){
 const input=Array.isArray(picks)?picks:[],counts={nbaRecords:0,eligibleProps:0,outOfScope:0,malformed:0,duplicates:0,conflictingIdentities:0},identities=new Map(),conflicts=new Set();
 const now=finite(options.now)?options.now:Date.now();
 for(const p of input){
  if(!p||p.sport!=='NBA')continue;counts.nbaRecords++;
  const market=canonical(p.market);
  if(!markets.has(market)||!finite(p.score)||p.score<85||p.score>100||!['over','under','at_least'].includes(p.side)){counts.outOfScope++;continue;}
  if(!text(p.board)||!text(p.modelVersion)||!text(p.gameId)||!text(p.playerId)||!finite(p.line)||p.line<0||
   !Number.isFinite(stamp(p.capturedAt))||!Number.isFinite(stamp(p.startsAt))||stamp(p.capturedAt)>=stamp(p.startsAt)||
   stamp(p.capturedAt)>now||settled(p)&&stamp(p.startsAt)>=now) {counts.malformed++;continue;}
  const e=evidence(p),key=JSON.stringify([p.board,p.modelVersion,market,p.side,p.gameId,p.playerId]);
  if(conflicts.has(key)){counts.duplicates++;continue;}
  if(identities.has(key)){
   counts.duplicates++;const old=identities.get(key);
   if(old.line!==p.line||old.score!==p.score||old.outcome?.status!==p.outcome?.status||frozenEvidenceKey(old)!==frozenEvidenceKey(p)){
    identities.delete(key);conflicts.add(key);counts.conflictingIdentities++;
   }
   continue;
  }
  identities.set(key,{...p,market,validationEvidence:e});
 }
 const groups=new Map();
 for(const p of identities.values()){
  counts.eligibleProps++;const e=p.validationEvidence,key=JSON.stringify([p.board,p.modelVersion,p.market,p.side,e.linePolicy]);
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);
 }
 const output=[...groups].sort(([a],[b])=>a.localeCompare(b)).map(([key,rows])=>{
  const first=rows[0],strata=new Map();
  for(const p of rows){const e=p.validationEvidence,range=lineRange(p,p.market),id=JSON.stringify([range,e.roleRange,e.sampleKind]);if(!strata.has(id))strata.set(id,[]);strata.get(id).push(p);}
  return {key,sport:'NBA',board:first.board,modelVersion:first.modelVersion,market:first.market,side:first.side,linePolicy:first.validationEvidence.linePolicy,
   ...summarize(rows,options),metadataComplete:rows.filter(p=>p.validationEvidence.metadataComplete).length,
   bands:['85–89','90–94','95–100'].map(name=>({band:name,...summarize(rows.filter(p=>band(p.score)===name),options)})),
   strata:[...strata].sort(([a],[b])=>a.localeCompare(b)).map(([,xs])=>{const e=xs[0].validationEvidence;return {lineRange:lineRange(xs[0],xs[0].market),roleRange:e.roleRange,sampleKind:e.sampleKind,
    metadataComplete:xs.every(p=>p.validationEvidence.metadataComplete),...summarize(xs,options),
    bands:['85–89','90–94','95–100'].map(name=>({band:name,...summarize(xs.filter(p=>band(p.score)===name),options)})),
    scoreTest:scoreComparison(xs,xs.every(p=>p.validationEvidence.metadataComplete),options)};})};
 });
 return {version:VERSION,scope:'Frozen NBA player props rated 85–100; first-basket estimates and older sub-85 recommendations remain in the ordinary record but are outside this score test.',counts,groups:output,
  limits:['Models, boards, markets, sides and line policies are never pooled for score comparisons.',
   'Score comparisons additionally match captured line ranges, frozen role/minutes ranges and sample kinds. Unknown historical evidence is never backfilled.',
   'Pending, void, push and unresolved records never count as wins or losses. Revisions are not additional trials.',
   'Game-cluster intervals keep related player and combination outcomes together. Few games, degenerate samples and changing roles limit inference.',
   'These results are descriptive. No score weights, eligibility rules or probability calibration change automatically.']};
}
return {VERSION,analyze,clusterInterval};
});
