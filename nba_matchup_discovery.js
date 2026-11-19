/* Observed NBA matchups with shared rotation evidence. Prices never enter ratings. */
(function(root,factory){
 const common=typeof module==='object'&&module.exports;
 const api=factory(common?require('./nba_possession_engine'):root.CookNBAPossessions,
  common?require('./nba_prop_evidence'):root.CookNBAPropEvidence,
  common?require('./nba_prop_lines'):root.CookNBAPropLines);
 if(common)module.exports=api;root.CookNBAMatchups=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(boxes,roleAPI,lineAPI){
'use strict';
const positions=['PG','SG','SF','PF','C'];
const components={points:['points'],rebounds:['rebounds'],assists:['assists'],threes:['threes'],pr:['points','rebounds'],pa:['points','assists'],ra:['rebounds','assists'],pra:['points','rebounds','assists']};
const markets=Object.keys(components),labels={points:'points',rebounds:'rebounds',assists:'assists',threes:'three-pointers',pr:'points + rebounds',pa:'points + assists',ra:'rebounds + assists',pra:'points + rebounds + assists'};
const total=(row,market)=>components[market].every(k=>Number.isFinite(row[k]))?components[market].reduce((n,k)=>n+row[k],0):null;
const avg=values=>{const known=values.filter(Number.isFinite);return known.length?known.reduce((s,x)=>s+x,0)/known.length:null};
const norm=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const clamp=(value,low=0,high=1)=>Math.max(low,Math.min(high,value));
const COMPLETION_BUFFER_MS=4*3600000;
function attempts(raw){const match=/^(\d+)-(\d+)$/.exec(String(raw||''));return match&&Number(match[1])<=Number(match[2])?Number(match[2]):null;}
function position(raw){const x=typeof raw==='object'?raw?.abbreviation||raw?.displayName||raw?.name:raw;return {POINTGUARD:'PG',SHOOTINGGUARD:'SG',SMALLFORWARD:'SF',POWERFORWARD:'PF',CENTER:'C',PG:'PG',SG:'SG',SF:'SF',PF:'PF',C:'C'}[String(x||'').toUpperCase().replace(/[^A-Z]/g,'')]||null;}
function minutes(raw){if(raw===null||raw===undefined||raw==='')return null;if(String(raw).includes(':')){const [m,s]=String(raw).split(':').map(Number);return Number.isFinite(m)&&Number.isFinite(s)?m+s/60:null}const n=Number(raw);return Number.isFinite(n)?n:null;}
// Missing made-three evidence stays unknown; a recorded zero is an observation.
function madeThrees(stats={}){if(!stats||typeof stats!=='object'||Array.isArray(stats))return null;const values=[];for(const key of ['3PM','3PTM'])if(Object.hasOwn(stats,key)){const raw=stats[key],n=Number(raw);if(!['number','string'].includes(typeof raw)||String(raw).trim()===''||!Number.isInteger(n)||n<0)return null;values.push(n)}if(Object.hasOwn(stats,'3PT')){const pair=/^(\d+)-(\d+)$/.exec(String(stats['3PT']).trim());if(!pair||Number(pair[1])>Number(pair[2]))return null;values.push(Number(pair[1]))}return values.length&&values.every(n=>n===values[0])?values[0]:null;}
function recorded(p){const min=minutes(p.stats?.MIN);if(p.didNotPlay||!(min>0))return null;const values={minutes:min,threes:madeThrees(p.stats),points:Number(p.stats?.PTS),rebounds:Number(p.stats?.REB),assists:Number(p.stats?.AST),fga:attempts(p.stats?.FG),threeAttempts:attempts(p.stats?.['3PT']),freeThrows:attempts(p.stats?.FT)};return ['points','rebounds','assists'].every(k=>p.stats?.[{points:'PTS',rebounds:'REB',assists:'AST'}[k]]!==undefined&&Number.isFinite(values[k])&&values[k]>=0)?values:null;}
function minimumScore(){return 85;}
function qualifies(row){return !!row&&String(row.side||'over').toLowerCase()==='over'&&Number.isFinite(row.researchScore)&&row.researchScore>=85&&row.researchScore<=100;}
function rate(history,threshold,n,side='over'){const rows=history.slice(0,n),hits=rows.filter(v=>side==='under'?v<threshold:v>=threshold).length;return {hits,games:rows.length,rate:rows.length?hits/rows.length:null};}
function thresholds(history,market){const max=Math.max(...history,1),limit=Math.min({points:70,rebounds:35,assists:25,threes:15,pr:100,pa:95,ra:60,pra:120}[market],Math.ceil(max)+3);return Array.from({length:limit},(_,i)=>i+1);}
// Compatibility for historical cards only. New selections use the common line policy.
function baseline(history,market,side='over'){if(side==='under')return thresholds(history,market).map(n=>n+.5).find(t=>rate(history,t,5,side).rate>=.8&&rate(history,t,10,side).rate>=.7)??null;const steps={points:[5,10,15,20,25,30,35,40,45,50],rebounds:[2,4,6,8,10,12,15,18,20],assists:[2,3,4,5,6,7,8,10,12,15],threes:[1,2,3,4,5,6,7,8],pr:[10,15,20,25,30,35,40,45,50,55,60],pa:[10,15,20,25,30,35,40,45,50,55,60],ra:[5,8,10,12,15,18,20,25,30],pra:[15,20,25,30,35,40,45,50,55,60,65,70]}[market];return steps.filter(t=>rate(history,t,5).rate>=.8&&rate(history,t,10).rate>=.7).at(-1)||null;}

function defensiveEvidence(records,metadata={}){
 const samples=[],coverage={games:0,omittedTeamGames:0};
 const pos=p=>position(p.position)||position(metadata[String(p.id)]?.position);
 // boxes.records parses FG/FT attempt pairs, validates complete boxes, and
 // exposes regulation-length pace. No nonexistent FGA/FTA source fields.
 for(const game of records){
  if(!(Number.isFinite(game.poss)&&game.poss>0))continue;
  for(const attacking of [game.home,game.away]){
   const team=attacking===game.home?game.away:game.home;
   const observed=(game.players||[]).filter(p=>p.team===attacking&&!p.didNotPlay)
    .map(p=>({stats:recorded(p),position:pos(p)})).filter(x=>x.stats);
   const totalMinutes=observed.reduce((s,x)=>s+x.stats.minutes,0);
   const known=observed.filter(x=>x.position).reduce((s,x)=>s+x.stats.minutes,0);
   if(!(totalMinutes>0)||known/totalMinutes<.98){coverage.omittedTeamGames++;continue}
   const values=Object.fromEntries(positions.map(p=>[p,Object.fromEntries(markets.map(k=>[k,0]))]));
   const positionMinutes=Object.fromEntries(positions.map(p=>[p,0]));
   for(const observation of observed){if(!observation.position)continue;positionMinutes[observation.position]+=observation.stats.minutes;
    for(const market of markets){const value=total(observation.stats,market);values[observation.position][market]=value===null||values[observation.position][market]===null?null:values[observation.position][market]+value;}}
   const normalized=Object.fromEntries(positions.map(p=>[p,Object.fromEntries(markets.map(m=>[m,
    positionMinutes[p]>0&&Number.isFinite(values[p][m])?values[p][m]*4800/(positionMinutes[p]*game.poss):null]))]));
   samples.push({game:String(game.id),date:game.date,team,attacking,values,normalized,positionMinutes,pace:game.poss,duration:game.duration});
   coverage.games++;
  }
 }
 samples.sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)||a.game.localeCompare(b.game)||a.team.localeCompare(b.team));
 // Opponent-strength offsets see only observations before each historical tip.
 // A future/target game cannot improve its own opponent's comparison baseline.
 for(const sample of samples){
  sample.scheduleAdjusted={};sample.opponentStrength={};
  // A prior tipoff alone does not prove its box score was available. Use the
  // same conservative completion buffer as the chronological NBA audit.
  const earlier=samples.filter(row=>Date.parse(row.date)+COMPLETION_BUFFER_MS<=Date.parse(sample.date));
  const previous=earlier.filter(row=>row.attacking===sample.attacking).slice(0,10);
  for(const p of positions){sample.scheduleAdjusted[p]={};sample.opponentStrength[p]={};
   for(const market of markets){
    const prior=previous.map(r=>r.normalized[p][market]).filter(Number.isFinite);
    const reference=earlier.map(r=>r.normalized[p][market]).filter(Number.isFinite);
    const available=prior.length>=3&&reference.length>=30;
    const league=available?avg(reference):null,opponent=available?avg(prior):null;
    const reliability=available?prior.length/(prior.length+5):0;
    const adjustment=available&&league>0?clamp(opponent-league,-league*.5,league*.5)*reliability:0;
    const observed=sample.normalized[p][market];
    sample.scheduleAdjusted[p][market]=Number.isFinite(observed)?Math.max(0,observed-adjustment):null;
    sample.opponentStrength[p][market]={available:available&&league>0,priorGames:prior.length,priorLeagueGames:reference.length,opponentRate:opponent,leagueRate:league,adjustment,reliability};
   }
  }
 }
 const defense=new Map();for(const sample of samples){const rows=defense.get(sample.team)||[];if(rows.length<10)rows.push(sample);defense.set(sample.team,rows)}
 return {defense,coverage,samples};
}

function opportunityMetric(role,market){
 if(!role)return null;
 if(market==='points')return Number.isFinite(role.attempts?.fga)&&Number.isFinite(role.attempts?.freeThrows)?role.attempts.fga+.44*role.attempts.freeThrows:null;
 if(market==='threes')return Number.isFinite(role.attempts?.threeAttempts)?role.attempts.threeAttempts:null;
 // Potential assists and rebound chances must not be inferred from boxes.
 // These are explicitly labeled observed production-per-minute role proxies.
 const values=role.selectionSamples?.[market];return Array.isArray(values)?avg(values):null;
}

function analyze(game,feed,rosters,injuries,now=Date.now(),options={}){
 const cutoff=Math.min(Date.parse(game.date),now),year=new Date(game.date).getUTCFullYear()-(new Date(game.date).getUTCMonth()<9),seasonStart=Date.UTC(year,9,1);
 const recent=boxes.records(feed,cutoff).filter(g=>Date.parse(g.date)>=seasonStart),members=rosters?.teams||{},metadata=rosters?.players||{};
 const pos=p=>position(p.position)||position(metadata[String(p.id)]?.position);
 const profiles=new Map(),teamHistory=new Map();
 for(const prior of recent){for(const team of [prior.home,prior.away]){if(!teamHistory.has(team))teamHistory.set(team,[]);teamHistory.get(team).push(prior)}
  for(const p of prior.players||[]){const stats=recorded(p),primary=pos(p);if(!stats||!primary||!Array.isArray(members[p.team])||!members[p.team].map(String).includes(String(p.id)))continue;
   const id=String(p.id);if(!profiles.has(id))profiles.set(id,{id,name:p.name,team:p.team,position:primary,rows:[]});const row=profiles.get(id);if(row.team!==p.team||row.rows.length>=10)continue;row.rows.push({...stats,date:prior.date,home:p.team===prior.home});}}
 const evidence=defensiveEvidence(recent,metadata),{defense,coverage}=evidence;
 const roleEvidence=roleAPI&&typeof roleAPI.analyze==='function'?roleAPI.analyze(game,feed,rosters,injuries,now,options):{ready:false,reason:'Supported rotation evidence is unavailable.',players:{}};
 const roles=roleEvidence.players||{};
 const peerProfiles=[...profiles.values()].filter(p=>p.rows.length>=5&&avg(p.rows.slice(0,5).map(r=>r.minutes))>=20);
 const allDefense=[...defense.values()].flat();
 const weaknesses=[],candidates=[];
 const injuryAt=Date.parse(roleEvidence.inputTimes?.injuries||injuries?.generated_at),rosterAt=Date.parse(rosters?.generated_at),feedAt=Date.parse(feed?.generated_at),pregame=game.status==='STATUS_SCHEDULED'&&Date.parse(game.date)>now;
 const fresh=(stamp,h)=>Number.isFinite(stamp)&&stamp<=now+300000&&now-stamp<=h*3600000;
 const inputsFresh=fresh(feedAt,12)&&fresh(rosterAt,72)&&fresh(injuryAt,Date.parse(game.date)-now<=90*60000?.25:12)&&(roleEvidence.ready===true||Array.isArray(injuries?.injuries)&&(!injuries.status||injuries.status==='ok'));
 for(const attacking of [game.away,game.home]){
  const opponent=attacking===game.home?game.away:game.home,sample=defense.get(opponent)||[];
  if(sample.length<5||coverage.games<30)continue;
  for(const primary of positions)for(const market of markets){
   const marketSample=sample.filter(r=>Number.isFinite(r.scheduleAdjusted[primary][market]));
   const leagueSample=allDefense.filter(r=>Number.isFinite(r.scheduleAdjusted[primary][market]));
   if(marketSample.length<5||leagueSample.length<30)continue;
   const allowed=avg(marketSample.map(r=>r.values[primary][market]));
   const reference=avg(leagueSample.map(r=>r.values[primary][market]));
   const normalizedAllowed=avg(marketSample.map(r=>r.normalized[primary][market]));
   const normalizedReference=avg(leagueSample.map(r=>r.normalized[primary][market]));
   const adjusted=avg(marketSample.map(r=>r.scheduleAdjusted[primary][market]));
   const adjustedReference=avg(leagueSample.map(r=>r.scheduleAdjusted[primary][market]));
   if(!(adjustedReference>0))continue;
   const shrinkage=marketSample.length/(marketSample.length+8);
   const shrunk=adjustedReference+(adjusted-adjustedReference)*shrinkage;
   if(Math.abs(shrunk-adjustedReference)<1e-12)continue;
   const side=shrunk<adjustedReference?'under':'over';
   const strengthRows=marketSample.filter(r=>r.opponentStrength[primary][market].available);
   const weakness={team:opponent,attacking,position:primary,market,allowed,leagueAverage:reference,games:marketSample.length,side,
    normalizedAllowed,normalizedLeagueAverage:normalizedReference,scheduleAdjustedAllowed:adjusted,scheduleAdjustedLeagueAverage:adjustedReference,
    shrunkNormalizedAllowed:shrunk,shrinkage,priorGames:8,allowanceBasis:'per_100_possessions_per_48_position_minutes',
    opponentStrengthAdjustedGames:strengthRows.length,opponentStrengthAdjustment:normalizedAllowed-adjusted,
    opponentStrengthMethod:'Earlier offensive position rates only with a four-hour completion buffer; at least three prior games and thirty earlier league samples. Missing schedule evidence applies no guessed correction.',
    excess:Math.abs(shrunk/adjustedReference-1)};
   weaknesses.push(weakness);if(side!=='over'||!pregame||!inputsFresh||roleEvidence.ready!==true)continue;
   const marketRows=p=>p.rows.filter(r=>total(r,market)!==null);
   const peers=peerProfiles.filter(p=>p.position===primary&&marketRows(p).length>=5);
   const peerAverage=avg(peers.map(p=>avg(marketRows(p).slice(0,5).map(r=>total(r,market)))));
   if(peers.length<3||!(peerAverage>0))continue;
   // Compare current supported opportunity to observed position-peer volumes,
   // never invent a present-day rotation for players in other fixtures.
   const observedMetric=(row,component)=>component==='points'?Number.isFinite(row.fga)&&Number.isFinite(row.freeThrows)?row.fga+.44*row.freeThrows:null:component==='threes'?row.threeAttempts:total(row,component);
   const peerMetrics=Object.fromEntries(components[market].map(k=>[k,avg(peers.map(p=>avg(p.rows.slice(0,5).map(row=>observedMetric(row,k)))))]));
   for(const player of peerProfiles.filter(p=>p.team===attacking&&p.position===primary)){
    const observedRows=marketRows(player),role=roles[player.id];
    if(observedRows.length<5||observedRows[0].minutes<15||role?.eligible!==true||!Number.isFinite(role.projectedMinutes)||role.projectedMinutes<20)continue;
    const history=observedRows.map(r=>total(r,market)),playerAverage=avg(history.slice(0,5)),recentMinutes=avg(observedRows.slice(0,5).map(r=>r.minutes));
    const injury=(injuries?.injuries||[]).find(p=>String(p.player_id||p.id||'')===player.id||norm(p.player||p.name)===norm(player.name));
    const status=String(role.status||injury?.status||'NOT LISTED').toUpperCase();if(!['NOT LISTED','ACTIVE','AVAILABLE','PROBABLE'].includes(status))continue;
    const samples=role.selectionSamples?.[market];
    const selected=lineAPI?.select?.({market,samples,sampleKind:role.sampleKind||'role_adjusted_history'});
    if(!selected?.available||!Number.isFinite(selected.milestone)||!Number.isFinite(selected.line))continue;
    const ratios=components[market].map(k=>{const value=opportunityMetric(role,k),peer=peerMetrics[k];return Number.isFinite(value)&&peer>0?value/peer:null});
    if(ratios.some(x=>x===null))continue;
    const opportunityRatio=avg(ratios);
    const ownHistory=teamHistory.get(attacking)||[],opponentHistory=teamHistory.get(opponent)||[],lastTeam=ownHistory[0];
    const restDays=lastTeam?Math.max(0,Math.round((Date.parse(game.date)-Date.parse(lastTeam.date))/86400000)-1):null,backToBack=restDays===0;
    const venueRows=observedRows.filter(r=>r.home===(attacking===game.home)),venueAverage=venueRows.length>=3?avg(venueRows.map(r=>total(r,market))):null;
    const paceValues=[...ownHistory.slice(0,5),...opponentHistory.slice(0,5)].map(g=>g.poss).filter(x=>Number.isFinite(x)&&x>70&&x<140);
    const paceEstimate=paceValues.length>=6?Math.round(avg(paceValues)*10)/10:null;
    const minutesHistory=observedRows.slice(0,5).map(r=>r.minutes),minutesSpread=Math.max(...minutesHistory)-Math.min(...minutesHistory);
    const scenarioSpread=Number.isFinite(role.minutesLow)&&Number.isFinite(role.minutesHigh)?Math.max(0,role.minutesHigh-role.minutesLow):0;
    const earlierAverage=avg(history.slice(5)),recentForm=earlierAverage>0?clamp((playerAverage/earlierAverage)/1.2):.5;
    const factors=[
     {label:'Normalized opponent weakness at position',points:Math.round(30*clamp(weakness.excess/.3)),max:30},
     {label:'Supported role / observed opportunity proxy',points:Math.round(20*clamp((opportunityRatio-1)/.5)),max:20},
     {label:'Recent performance',points:Math.round(15*recentForm),max:15},
     {label:'Minutes and stability',points:Math.round(20*clamp(role.projectedMinutes/32)*clamp(1-Math.max(minutesSpread,scenarioSpread)/30)),max:20},
     {label:'Available with supported samples',points:Math.round(15*Math.min(observedRows.length,marketSample.length,10)/10*(status==='PROBABLE'?.8:1)),max:15}
    ];
    const researchScore=factors.reduce((s,f)=>s+f.points,0),matchupRating={side,score:researchScore,factors};
    const threshold=selected.milestone;
    candidates.push({side,key:[game.id,player.id,market].join('|'),game,playerId:player.id,name:player.name,team:attacking,opponent,position:primary,market,
     history,playerAverage,peerAverage,peerPlayers:peers.length,recentMinutes,projectedMinutes:role.projectedMinutes,restDays,backToBack,venueAverage,venueGames:venueRows.length,paceEstimate,
     researchScore,matchupRating,status,baseline:threshold,recommendedOverLine:selected.line,linePolicy:selected.policy,selectedLineEvidence:selected,roleEvidence:role,
     opportunityRelativeToPeers:opportunityRatio,opportunityBasis:'Observed attempts for shooting; minutes-adjusted recorded assists/rebounds are role proxies, not official tracking chances.',
     last5:rate(history,threshold,5),last10:rate(history,threshold,10),thresholds:[...new Set([...thresholds(history,market),threshold])].sort((a,b)=>a-b),
     weakness,priority:weakness.excess*opportunityRatio,eligible:true});
   }
  }
 }
 candidates.sort((a,b)=>b.researchScore-a.researchScore||b.priority-a.priority||b.last5.rate-a.last5.rate||a.key.localeCompare(b.key));
 const seen=new Set(),topThree=candidates.filter(p=>qualifies(p)&&!seen.has(p.playerId)&&seen.add(p.playerId)).slice(0,3);
 const ready=pregame&&inputsFresh&&roleEvidence.ready===true;
 const reason=!pregame?'Historical view: recommendations close at tipoff.':!inputsFresh?'Fresh game, injury and roster data are required for player recommendations.':roleEvidence.ready!==true?roleEvidence.reason||'Supported rotation and opportunity evidence is unavailable; player picks are withheld.':!weaknesses.length?'Position-level samples are incomplete or no above-average allowances qualify yet.':!topThree.length?'PASS · No supported matchup meets 85/100.':null;
 return {game,weaknesses:weaknesses.sort((a,b)=>b.excess-a.excess),candidates:candidates.filter(qualifies),topThree,bestSingle:topThree[0]||null,coverage,ready,reason,
  roleSummary:{ready:roleEvidence.ready===true,reason:roleEvidence.reason||null,heldPlayers:Object.values(roles).filter(r=>r.eligible!==true).length},roleEvidence,
  method:'ESPN primary positions with verified box-score possessions and positional minutes. Defensive rates are normalized per 100 possessions and 48 positional minutes, adjusted for supported earlier opponent production and shrunk toward league average. Raw per-game totals remain descriptive. Shared rotation evidence supplies minutes and observed opportunity proxies; unknown official tracking is not invented. Recorded hit rates are historical; role-adjusted line samples are not observed hits or calibrated probabilities.'};
}
return {minimumScore,qualifies,analyze,position,recorded,madeThrees,rate,baseline,thresholds,positions,markets,labels,defensiveEvidence};
});
