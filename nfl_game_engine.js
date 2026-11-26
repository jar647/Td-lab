/* THE PROP VAULT game-first research simulator.
   Generative team plays -> pass/rush attempts -> allocated targets/carries ->
   catches, receiving/pass/rush yards. Never a calibrated sportsbook model.
   UMD export for browser worker and Node test runner. No external dependencies.
*/
(function(root){
"use strict";
const LEGACY_MODEL_VERSION='game-first-volume-v4-depth-chart-qb';
const MODEL_VERSION='game-first-volume-v5-counts-catch';
const DEFAULT_EFFICIENCY_PROFILE='sample_counts';
const MARKETS={
 rushYards:[25,40,50,60,70,80,100],
 recYards:[20,25,30,40,50,60,70,80,100],
 receptions:[2,3,4,5,6,7,8],
 passYards:[150,175,200,225,250,275,300]
};
const finite=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const mean=(arr,k)=>arr.length?arr.reduce((a,x)=>a+(finite(x[k])??0),0)/arr.length:0;
const rng=seed=>{let t=seed>>>0;return ()=>{t+=0x6D2B79F5;let x=t;x=Math.imul(x^x>>>15,x|1);x^=x+Math.imul(x^x>>>7,x|61);return ((x^x>>>14)>>>0)/4294967296;}};
function normal(random){const u=Math.max(1e-9,random()),v=random();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)}
function randCount(n,p,random){let x=0;for(let i=0;i<n;i++)if(random()<p)x++;return x;}
function weighted(items,sum,random){let u=random()*sum;for(let i=0;i<items.length;i++){u-=items[i].weight;if(u<0)return items[i]}return items[items.length-1]}
function blocked(p){
 if(p.qbRole==='BACKUP')return true;
 const report=String(p.injuryReportStatus||'').toUpperCase();
 const roster=String(p.availability||'').toUpperCase();
 return /^(OUT|INACTIVE|SUSPENDED|IR|PUP|RES|DEV|CUT|RET|EXE|TRD|TRT)$/.test(report)||
        /^(OUT|INACTIVE|SUSPENDED|IR|PUP|RES|DEV|CUT|RET|EXE|TRD|TRT)$/.test(roster);
}
const HTTPS_SOURCE=/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d+)?(?:[/?#][^\s]*)?$/i;
const sourceURL=v=>typeof v==='string'&&HTTPS_SOURCE.test(v.trim());
const sourceNumber=v=>(typeof v==='number'||typeof v==='string'&&v.trim()!=='')&&Number.isFinite(Number(v))?Number(v):null;
function citedStarter(p){return p.qbRole==='EXPECTED_STARTER'&&sourceURL(p.starterContext?.source)&&typeof p.starterContext?.note==='string'&&p.starterContext.note.trim()!==''}
function firstUnitQuarterback(p,now){
 const d=p.depthChart;if(p.pos!=='QB'||!d||d.order!==1||d.unit!=='first'||d.position!=='QB'||d.sourceStatus!=='ok'||!sourceURL(d.source)||typeof d.observedAt!=='string')return false;
 const observed=Date.parse(d.observedAt),season=sourceNumber(d.season);
 if(!Number.isFinite(observed)||observed>now+300000||now-observed>72*3600000||!Number.isInteger(season)||season<1900)return false;
 return p.season===null||p.season===undefined||p.season===''||sourceNumber(p.season)===season;
}
function tightEndTargetBaseline(records){
 const allowed=new Map(),conflicts=new Set();
 for(const row of records||[]){
  const value=sourceNumber(row?.defTargetsAllowed);
  if(row?.market!=='ATD'||row.pos!=='TE'||!row.opp||value===null||value<0)continue;
  if(allowed.has(row.opp)&&allowed.get(row.opp)!==value)conflicts.add(row.opp);
  allowed.set(row.opp,value);
 }
 for(const team of conflicts)allowed.delete(team);
 const values=[...allowed.values()].sort((a,b)=>a-b);
 if(values.length<20)return null;
 return (values[Math.floor((values.length-1)/2)]+values[Math.floor(values.length/2)])/2;
}
function tightEndOpportunity(player,leagueTargets,now=Date.now()){
 const observed=Date.parse(player?.depthChart?.observedAt);
 if(player?.pos!=='TE'||player.playerAppearancesVerified!==true||
    player.availability!=='ROSTER_ACTIVE'||!['ACTIVE','AVAILABLE','NOT_REPORTED'].includes(player.injuryReportStatus)||
    player.depthChart?.unit!=='first'||player.depthChart?.position!=='TE'||player.depthChart?.sourceStatus!=='ok'||
    /OUT|INACTIVE|DOUBTFUL|QUESTIONABLE|LIMITED|DNP/.test([player.gameDayAvailability,player.injuryPracticeStatus].join('|').toUpperCase())||
    !sourceURL(player.depthChart?.source)||!Number.isFinite(observed)||observed>now+300000||now-observed>72*3600000)return null;
 const rawSnap=sourceNumber(player.snapShare),snap=rawSnap>1?rawSnap/100:rawSnap;
 if(!(snap>=.5&&snap<=1))return null;
 const opportunity=quietTightEndTargets(player.seasonGameStats,sourceNumber(player.defTargetsAllowed),leagueTargets);
 return opportunity?{...opportunity,snapShare:snap}:null;
}
function quietTightEndTargets(history,allowed,leagueTargets){
 if(!Number.isFinite(leagueTargets)||leagueTargets<=0||!Number.isFinite(allowed)||allowed<leagueTargets*1.15||
    !Array.isArray(history)||history.length<6||history.some(row=>!row||!Number.isInteger(row.week)||row.week<1||
    ['targets','receptions'].some(key=>sourceNumber(row[key])===null||sourceNumber(row[key])<0)))return null;
 const ordered=[...history].sort((a,b)=>a.week-b.week),recent=ordered.slice(-3),previous=ordered.slice(0,-3);
 if(new Set(ordered.map(row=>row.week)).size!==ordered.length)return null;
 const earlierTargets=mean(previous,'targets'),recentTargets=mean(recent,'targets'),catchRate=mean(previous,'receptions')/earlierTargets;
 if(earlierTargets<2.5||recentTargets>earlierTargets*.8||!Number.isFinite(catchRate)||catchRate<.5||catchRate>1)return null;
 const addedWeight=Math.min(.75,(earlierTargets-recentTargets)*.35,(allowed/leagueTargets-1)*2);
 return {earlierTargets,recentTargets,allowed,leagueTargets,addedWeight};
}
function playerParams(p,efficiencyProfile){
 const history=Array.isArray(p.seasonGameStats)?p.seasonGameStats:[];
 const fields=p.pos==='QB'?['passAttempts','rushAttempts','rushYards']:['targets','receptions','recYards','rushAttempts','rushYards'];
 if(history.some(r=>!r||fields.some(k=>finite(r[k])===null)))return null;
 const gameIds=history.map(r=>r.gameId).filter(Boolean);if(new Set(gameIds).size!==gameIds.length)return null;
 if(history.length<3||p.playerAppearancesVerified===false)return null;
 const key=String(p.player_id||p.team+'|'+p.player);
 const rec=mean(history,'receptions'),targets=mean(history,'targets'),carries=mean(history,'rushAttempts');
 const pass=mean(history,'passAttempts');
 const yardsPerCatch=clamp(efficiencyProfile==='sample_counts'?(history.reduce((s,r)=>s+(finite(r.recYards)??0),0)+35)/(history.reduce((s,r)=>s+(finite(r.receptions)??0),0)+3):(mean(history,'recYards')+35)/(rec+3),3,23);
 const rushPerCarry=clamp((mean(history,'rushYards')+18)/(carries+4),1.7,7);
 const catches=history.reduce((sum,r)=>sum+(finite(r.receptions)??0),0),targetCount=history.reduce((sum,r)=>sum+(finite(r.targets)??0),0);
 const targetRate=clamp(efficiencyProfile==='sample_counts'?(catches+3)/(targetCount+6):(rec+3)/(targets+6),.28,.88);
 const norm=history.slice(-5);
 const usage=(field)=>.65*mean(history,field)+.35*mean(norm,field);
 const ratios=p.defenseOpponentRatio||{};
 return {id:key,name:String(p.player||key),team:String(p.team),pos:String(p.pos),
  qbRole:p.qbRole,starterContext:p.starterContext&&typeof p.starterContext==='object'?{...p.starterContext}:null,
  season:p.season===undefined||p.season===null||p.season===''?null:sourceNumber(p.season)??NaN,
  depthChart:p.depthChart&&typeof p.depthChart==='object'&&!Array.isArray(p.depthChart)?{...p.depthChart}:null,
  gameCount:history.length,history:history.map(r=>({...r})),sourceAvailability:{roster:p.availability||'UNVERIFIED',injury:p.injuryReportStatus||'UNVERIFIED',gameDay:p.gameDayAvailability||'UNVERIFIED'},historicalPassingYards:history.every(r=>finite(r.passYards)!==null)?mean(history,'passYards'):null,historicalPassAttempts:pass,questionable:/QUESTIONABLE|DOUBTFUL|UNVERIFIED|NOT_REPORTED|LIMITED|DNP_PRACTICE/.test(
   [p.injuryReportStatus,p.availability,p.injuryPracticeStatus].join('|').toUpperCase()),
  pass:usage('passAttempts'),targets:usage('targets'),carries:usage('rushAttempts'),
  verifiedTeamPass:finite(p.teamPassAttemptsPerGame),
  catchRate:targetRate,catchRateEvidence:{profile:efficiencyProfile,catches,targets:targetCount,priorCatches:3,priorTargets:6},ypc:yardsPerCatch,ypcarry:rushPerCarry,
  passMatch:clamp(finite(ratios.PASS)??1,.85,1.12),
  recMatch:clamp(finite(ratios.REC)??1,.85,1.12),
  rushMatch:clamp(finite(ratios.RUSH)??1,.85,1.12),
  output:{passYards:0,rushYards:0,recYards:0,receptions:0}
 };
}
function build(records,options={}){
 if(!Array.isArray(records)||!records.length)throw Error('No matchup player records');
 if(!options||typeof options!=='object'||Array.isArray(options))throw Error('Simulation options must be an object');
 const efficiencyProfile=options.efficiencyProfile??DEFAULT_EFFICIENCY_PROFILE;
 if(!['legacy','sample_counts'].includes(efficiencyProfile))throw Error('Unsupported receiver efficiency profile');
 const quarterbackChoices=options.quarterbacks===undefined?{}:options.quarterbacks;
 if(!quarterbackChoices||typeof quarterbackChoices!=='object'||Array.isArray(quarterbackChoices))
  throw Error('Conditional quarterbacks must be an object mapping teams to player IDs');
 const entries=records.filter(p=>p&&p.team&&p.opp&&!blocked(p)).map(p=>playerParams(p,efficiencyProfile)).filter(Boolean);
 if(new Set(entries.map(p=>p.id)).size!==entries.length)throw Error('Duplicate player identity in matchup inputs');
 const teams=[...new Set(records.map(p=>String(p.team)))].sort();
 if(teams.length!==2)throw Error('Exactly two teams are required for one game');
 for(const team of Object.keys(quarterbackChoices))if(!teams.includes(team))
  throw Error('Conditional quarterback team '+team+' is not in this matchup');
 const sourceTime=Date.now();
 const league=teams.map(team=>{
  const roster=entries.filter(p=>p.team===team);
  const qbs=roster.filter(p=>p.pos==='QB').sort((a,b)=>Number(citedStarter(b))-Number(citedStarter(a))||Number(firstUnitQuarterback(b,sourceTime))-Number(firstUnitQuarterback(a,sourceTime))||b.pass-a.pass);
  const sourceQuarterbacks=records.filter(p=>p&&String(p.team)===team&&p.pos==='QB');
  const announced=sourceQuarterbacks.filter(citedStarter),charted=sourceQuarterbacks.filter(p=>firstUnitQuarterback(p,sourceTime));
  const preferred=announced.length?announced:charted;
  const conditional=Object.prototype.hasOwnProperty.call(quarterbackChoices,team);
  // A cited first-unit player with missing/blocked history cannot silently be
  // replaced by the quarterback with the largest earlier season workload.
  let chosenQuarterback=preferred.length===1?qbs.find(p=>p.id===String(preferred[0].player_id||preferred[0].team+'|'+preferred[0].player)):preferred.length>1?undefined:qbs[0];
  if(conditional){
   const choice=quarterbackChoices[team];
   if(!['string','number'].includes(typeof choice)||String(choice).trim()==='')
    throw Error(team+': conditional quarterback requires a player ID');
   const id=String(choice),source=records.find(p=>p&&String(p.player_id||p.team+'|'+p.player)===id);
   if(!source)throw Error(team+': conditional quarterback '+id+' is not in the matchup inputs');
   if(String(source.team)!==team)throw Error(team+': conditional quarterback '+id+' belongs to another team');
   if(source.pos!=='QB')throw Error(team+': conditional player '+id+' is not a quarterback');
   if(blocked(source))throw Error(team+': conditional quarterback '+id+' is blocked by roster, injury or backup status');
   chosenQuarterback=qbs.find(p=>p.id===id);
   if(!chosenQuarterback)throw Error(team+': conditional quarterback '+id+' requires at least three complete verified player-history games');
   if(chosenQuarterback.pass<12)throw Error(team+': conditional quarterback '+id+' has insufficient verified passing workload (minimum 12 attempts per game)');
  }
  const quarterbackVerified=!!chosenQuarterback&&chosenQuarterback.pass>=12;
  const candidates=roster.map(p=>p.verifiedTeamPass).filter(x=>x!==null&&x>=12&&x<=65);
  // If the QB's individual history is unavailable (injury, return, change of
  // starter), use verified historical TEAM passing attempts instead.
  // An internal anonymous passer enables receiver-target simulations, but
  // MUST NOT generate a named player/QB passing-yard market or imply a starter.
  const fallbackAttempts=candidates.length?candidates[0]:null;
  const fallbackWarning=preferred.length?'No supported individual scenario for the source-named quarterback'+(preferred.length>1?'s ':' ')+preferred.map(p=>String(p.player||p.player_id)).join(', ')+'. Team passing volume uses completed PBP. No QB props are projected.':'QB individual history is insufficient; team passing volume based on completed PBP. No QB props are projected.';
  if(!quarterbackVerified&&fallbackAttempts===null)
   throw Error(team+': no verified quarterback or historical team passing volume');
  const qb=quarterbackVerified?chosenQuarterback:{
   id:'UNVERIFIED_TEAM_QB_'+team,team,pos:'TEAM_PASSER_UNVERIFIED',
   pass:fallbackAttempts,passMatch:1,
   output:{passYards:0,rushYards:0,recYards:0,receptions:0}
  };
  const receivers=roster.filter(p=>['WR','TE','RB'].includes(p.pos)&&p.targets>=.25);
  const runners=roster.filter(p=>['RB','QB','WR'].includes(p.pos)&&p.carries>=.15&&
   (p.pos!=='QB'||quarterbackVerified&&p.id===qb.id));
  const passAttempts=clamp(qb.pass,20,48);
  const rushAttempts=clamp(runners.reduce((a,p)=>a+p.carries,0),12,44);
  const pace=clamp(passAttempts+rushAttempts,42,83);
  const passRate=clamp(passAttempts/pace,.36,.78);
  // Untracked backup players and receiving targets remain a real residual
  // category rather than inflating the known players to 100% of opportunities.
  function pool(known,total,minimum){
   const sum=known.reduce((a,p)=>a+Math.max(.05,p.weight),0);
   const other=Math.max(minimum,total-sum);
   return {items:[...known,{p:null,weight:other}],sum:sum+other};
  }
  const targetPool=pool(receivers.map(p=>({p,weight:p.targets})),passAttempts,2.5);
  const receiverMatchup=options.receiverMatchup;
  const selected=targetPool.items.find(item=>item.p&&String(receiverMatchup?.id)===item.p.id);
  const source=selected&&records.find(p=>p&&String(p.player_id||p.team+'|'+p.player)===selected.p.id);
  const opportunity=source&&tightEndOpportunity(source,receiverMatchup.leagueTargets);
  if(opportunity){
   const otherWeight=targetPool.sum-selected.weight;
   const gain=Math.min(opportunity.addedWeight,otherWeight*.1);
   const baselineTargets=selected.weight/targetPool.sum*passAttempts;
   for(const item of targetPool.items)if(item!==selected)item.weight*=1-gain/otherWeight;
   selected.weight+=gain;
   selected.p.targetMatchup={...opportunity,baselineTargets,scenarioTargets:selected.weight/targetPool.sum*passAttempts};
  }
  const carryPool=pool(runners.map(p=>({p,weight:p.carries})),rushAttempts,1);
  const quarterbackSelection=conditional?'CONDITIONAL_PLAYER_SCENARIO':!quarterbackVerified?'TEAM_VOLUME_FALLBACK':
   citedStarter(qb)?'VERIFIED_EXPECTED_STARTER':firstUnitQuarterback(qb,sourceTime)?'SOURCED_DEPTH_CHART':'MODEL_INPUT_SELECTION';
  return {team,roster,qb,pace,passRate,targetPool,carryPool,
   outlook:{team,quarterback:quarterbackVerified?qb.name:null,quarterbackId:quarterbackVerified?qb.id:null,quarterbackSelection,
    starterContext:qb.starterContext||null,depthChart:firstUnitQuarterback(qb,sourceTime)?{...qb.depthChart}:null,passVolumeSource:quarterbackVerified?'VERIFIED_QB_PLAYER_HISTORY':'VERIFIED_TEAM_PBP_NO_QB_PROPS',
    quarterbackPlayerPropsAvailable:quarterbackVerified,
    warning:conditional?'Conditional scenario: assumes '+qb.name+' starts at quarterback for '+team+'. Game-day starting status is not confirmed.':
     quarterbackSelection==='SOURCED_DEPTH_CHART'?'Depth-chart scenario: assumes '+qb.name+' starts at quarterback for '+team+'. Game-day starting status is not confirmed.':
     quarterbackVerified?null:fallbackWarning,
    estimatedPlays:Math.round(pace),estimatedPassAttempts:Math.round(passAttempts),
    estimatedRushAttempts:Math.round(rushAttempts),passingShare:Math.round(passRate*100),
    untrackedTargetShare:Math.round(targetPool.items[targetPool.items.length-1].weight/targetPool.sum*100),
    untrackedCarryShare:Math.round(carryPool.items[carryPool.items.length-1].weight/carryPool.sum*100)}
  };
 });
 if(league.some(t=>t.roster.length<(t.outlook.quarterbackPlayerPropsAvailable?4:3)))
  throw Error('Not enough position-verified offensive players for complete matchup');
 return {teams:league,players:entries,efficiencyProfile};
}
function simulate(records,count=10000,seed=1307,selected=[],options={}){
 if(!Number.isInteger(count)||count<1000||count>100000)throw Error('Simulation count must be 1,000 to 100,000');
 const model=build(records,options),random=rng(seed);
 const hits=new Map(),totals=new Map(),samples=new Map();
 if(!Array.isArray(selected))throw Error('Selected player props must be an array');
 const selections=selected.map(x=>({id:String(x?.id),market:String(x?.market),
  line:typeof x?.line==='number'||typeof x?.line==='string'?finite(x.line):null}));
 const byId=new Map(model.players.map(p=>[p.id,p]));
 const supportedMarkets=new Set(),unavailableMarkets=[];
 const settlementBins=options.collectSettlements===true?new Map():null;
 const teamsByName=new Map(model.teams.map(t=>[t.team,t]));
 const marketKey=(id,market)=>JSON.stringify([id,market]);
 const allStats={};
 for(const p of model.players){allStats[p.id]={rushYards:0,recYards:0,receptions:0,passYards:0};}
 for(const p of model.players)for(const [market,lines] of Object.entries(MARKETS)){
  if(market==='passYards'&&p.pos!=='QB')continue;
  if(['recYards','receptions'].includes(market)&&!['RB','WR','TE'].includes(p.pos))continue;
  if(market==='rushYards'&&!['QB','RB','WR'].includes(p.pos))continue;
  const team=teamsByName.get(p.team);
  const selectedQuarterback=team.outlook.quarterbackPlayerPropsAvailable&&team.qb.id===p.id;
  let reason=null;
  if(p.pos==='QB'&&!selectedQuarterback)
   reason=p.name+' is not the modeled quarterback for '+p.team+'. Named QB passing and rushing scenarios are unavailable; game-day starting status is not confirmed.';
  else if(market==='rushYards'&&!team.carryPool.items.some(x=>x.p?.id===p.id))
   reason='No supported rushing opportunity for '+p.name+' in the verified workload inputs. A rushing frequency is unavailable.';
  else if(['recYards','receptions'].includes(market)&&!team.targetPool.items.some(x=>x.p?.id===p.id))
   reason='No supported receiving opportunity for '+p.name+' in the verified workload inputs. A receiving frequency is unavailable.';
  if(reason){unavailableMarkets.push({id:p.id,market,reason});continue}
  supportedMarkets.add(marketKey(p.id,market));
  if(settlementBins)settlementBins.set(marketKey(p.id,market),new Map());
  for(const line of lines)hits.set(JSON.stringify([p.id,market,line]),0);
 }
 const outcomeRows=new Map();
 if(options.collectPlayerOutcomes!==undefined&&options.collectPlayerOutcomes!==false){
  const requested=options.collectPlayerOutcomes===true?[...supportedMarkets].map(key=>{const [id,market]=JSON.parse(key);return {id,market}}):options.collectPlayerOutcomes;
  if(!Array.isArray(requested)||requested.length>160)throw Error('Outcome collection requires at most 160 supported player markets');
  for(const row of requested){
   const key=marketKey(String(row?.id||''),row?.market);
   if(!supportedMarkets.has(key))throw Error('Cannot collect an unsupported player market');
   if(!outcomeRows.has(key))outcomeRows.set(key,[]);
  }
 }
 // Unsupported selections are missing model coverage, not zero-probability
 // outcomes. Custom positive thresholds remain valid for supported markets.
 for(const leg of selections){
  if(leg.line===null||leg.line<=0)throw Error('Cannot simulate '+leg.id+' '+leg.market+': the selected threshold must be a positive finite number');
  if(!byId.has(leg.id))throw Error('Cannot simulate '+leg.id+' '+leg.market+': player has no eligible verified history in this matchup');
  if(!supportedMarkets.has(marketKey(leg.id,leg.market))){
   const unavailable=unavailableMarkets.find(x=>x.id===leg.id&&x.market===leg.market);
   throw Error('Cannot simulate '+leg.id+' '+leg.market+': '+(unavailable?.reason||'This market is not supported for the selected player'));
  }
 }
 let parlayLegs=null;
 if(options.parlayLegs!==undefined){
  if(!Array.isArray(options.parlayLegs)||options.parlayLegs.length<1||options.parlayLegs.length>10)
   throw Error('Parlay legs must be an array of one to ten supported player props');
  const seen=new Set();parlayLegs=[];
  for(const leg of options.parlayLegs){
   if(!leg||typeof leg!=='object'||Array.isArray(leg))throw Error('Each parlay leg must be a player prop object');
   const id=typeof leg.id==='string'?leg.id.trim():typeof leg.id==='number'&&Number.isSafeInteger(leg.id)&&leg.id>=0?String(leg.id):null;
   const raw=leg.line;
   const numeric=typeof raw==='number'||typeof raw==='string'&&/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw.trim());
   const line=numeric?Number(raw):NaN;
   if(!id||typeof leg.market!=='string'||!Object.hasOwn(MARKETS,leg.market)||!['over','at_least'].includes(leg.side))
    throw Error('Parlay legs require an exact player identity, supported player market and over or at_least side');
   if(!Number.isFinite(line)||line<0||line>10000||!Number.isInteger(line*2)||leg.side==='at_least'&&line===0)
    throw Error('Parlay lines must be finite whole or half thresholds; at_least thresholds must be positive');
   if(seen.has(id))throw Error('A parlay may contain only one prop per player');
   if(!byId.has(id))throw Error('Cannot simulate parlay '+id+': player has no eligible verified history in this matchup');
   if(!supportedMarkets.has(marketKey(id,leg.market)))
    throw Error('Cannot simulate parlay '+id+' '+leg.market+': this player market is unavailable');
   seen.add(id);parlayLegs.push({p:byId.get(id),market:leg.market,line,side:leg.side});
  }
 }
 let joint=0;
 let parlayAllWin=0,parlayNonLoss=0;
 const sumScores={};
 for(let trial=0;trial<count;trial++){
  for(const p of model.players){p.output.passYards=0;p.output.rushYards=0;p.output.recYards=0;p.output.receptions=0;}
  const paceShock=normal(random)*.11;
  const scriptShock=normal(random);
  for(let ti=0;ti<model.teams.length;ti++){
   const t=model.teams[ti];
   const plays=clamp(Math.round(t.pace*Math.exp(paceShock+normal(random)*.07)),35,90);
   const passRate=clamp(t.passRate+(ti===0?1:-1)*scriptShock*.032+normal(random)*.043,.33,.84);
   const attempts=randCount(plays,passRate,random),rushes=plays-attempts;
   let qbYards=0,knownReceiving=0,untrackedPassing=0;
   const teamRecFactor=clamp(Math.exp(normal(random)*.12),.68,1.42);
   const teamRushFactor=clamp(Math.exp(normal(random)*.14),.65,1.47);
   for(let a=0;a<attempts;a++){
    const to=weighted(t.targetPool.items,t.targetPool.sum,random);
    if(to.p){
     const p=to.p;
     if(random()<p.catchRate){
      const yards=clamp(p.ypc*p.recMatch*teamRecFactor*Math.exp(normal(random)*.55-.55*.55/2),0,85);
      p.output.receptions+=1;p.output.recYards+=yards;qbYards+=yards;knownReceiving+=yards;
     }
    }else if(random()<.65){const yards=clamp(9.5*t.qb.passMatch*teamRecFactor*Math.exp(normal(random)*.55-.15),0,70);qbYards+=yards;untrackedPassing+=yards;}
   }
   t.qb.output.passYards=qbYards;
   if(Math.abs(qbYards-knownReceiving-untrackedPassing)>1e-7)throw Error('Passing/receiving yard conservation failed');
   for(let c=0;c<rushes;c++){
    const to=weighted(t.carryPool.items,t.carryPool.sum,random);
    if(!to.p)continue;
    const p=to.p;
    const yards=clamp(p.ypcarry*p.rushMatch*teamRushFactor*Math.exp(normal(random)*.68-.68*.68/2),0,55);
    p.output.rushYards+=yards;
   }
   const scores=sumScores[t.team]||(sumScores[t.team]={plays:0,passes:0,rushes:0,passingYards:0,untrackedPassingYards:0});
   scores.plays+=plays;scores.passes+=attempts;scores.rushes+=rushes;scores.passingYards+=qbYards;scores.untrackedPassingYards+=untrackedPassing;
  }
  for(const p of model.players){
   for(const [market,lines] of Object.entries(MARKETS)){
    const outcomes=outcomeRows.get(marketKey(p.id,market));
    if(outcomes)outcomes.push(Math.floor(p.output[market]));
    const bins=settlementBins?.get(marketKey(p.id,market));
    if(bins){
     // Whole-number settlement is a review convention. Flooring preserves
     // every existing integer alternate threshold without changing the draws.
     const wholeTotal=Math.floor(p.output[market]);
     bins.set(wholeTotal,(bins.get(wholeTotal)||0)+1);
    }
    for(const line of lines){
     const key=JSON.stringify([p.id,market,line]);
     if(!hits.has(key))continue;
     if(p.output[market]>=line)hits.set(key,hits.get(key)+1);
    }
   }
   for(const field of Object.keys(allStats[p.id]))allStats[p.id][field]+=p.output[field];
  }
  if(selections.length&&selections.every(x=>{
   const p=byId.get(x.id);return p&&MARKETS[x.market]&&p.output[x.market]>=x.line;
  }))joint++;
  if(parlayLegs){
   let allWin=true,nonLoss=true;
   for(const leg of parlayLegs){
    const value=Math.floor(leg.p.output[leg.market]);
    if(value<leg.line){allWin=false;nonLoss=false;break}
    if(leg.side==='over'&&value===leg.line)allWin=false;
   }
   if(allWin)parlayAllWin++;
   if(nonLoss)parlayNonLoss++;
  }
 }
 const markets=[];
 for(const [key,n] of hits.entries()){
  const [id,market,line]=JSON.parse(key);
  const p=byId.get(id);
  if(!p)continue;
  const rate=n/count;
  // Wilson score interval describes Monte Carlo sampling noise ONLY.
  const z=1.96,den=1+z*z/count,mid=(rate+z*z/(2*count))/den;
  const err=z*Math.sqrt(rate*(1-rate)/count+z*z/(4*count*count))/den;
  markets.push({id,name:p.name,team:p.team,pos:p.pos,market,line:Number(line),hits:n,
   scenarioRate:Math.round(rate*10000)/10000,scenarioLow:Math.max(0,mid-err),
   scenarioHigh:Math.min(1,mid+err),questionable:p.questionable,
   modeledMean:Math.round(allStats[p.id][market]/count*10)/10});
 }
 const summary=model.teams.map(t=>({
  ...t.outlook,scenarioAvgPassYards:sumScores[t.team].passingYards/count,scenarioAvgUntrackedReceivingYards:sumScores[t.team].untrackedPassingYards/count,scenarioAvgPlays:Math.round(sumScores[t.team].plays/count*10)/10,
  scenarioAvgPasses:Math.round(sumScores[t.team].passes/count*10)/10,
  scenarioAvgRushes:Math.round(sumScores[t.team].rushes/count*10)/10
 }));
 const baseVersion=model.efficiencyProfile==='legacy'?LEGACY_MODEL_VERSION:MODEL_VERSION;
 const outputVersion=model.players.some(p=>p.targetMatchup)?baseVersion+'-te-target-scenario-v1':baseVersion;
 let fingerprint=2166136261;
 const evidence=JSON.stringify(model.players.map(p=>[p.id,p.team,p.pos,p.pass,p.targets,p.carries,p.catchRate,p.ypc,p.ypcarry,p.passMatch,p.recMatch,p.rushMatch,p.sourceAvailability,...(p.targetMatchup?[p.targetMatchup]:[])]));
 for(let i=0;i<evidence.length;i++)fingerprint=Math.imul(fingerprint^evidence.charCodeAt(i),16777619);
 const outcomeSetId=[outputVersion,seed,count,(fingerprint>>>0).toString(16)].join('|');
 return {status:'RESEARCH_ONLY_UNCALIBRATED',modelVersion:outputVersion,efficiencyProfile:model.efficiencyProfile,inputAudit:model.players.map(p=>({id:p.id,name:p.name,team:p.team,games:p.gameCount,history:p.history,sourceAvailability:p.sourceAvailability,catchRate:p.catchRate,catchRateEvidence:p.catchRateEvidence,historicalPassingYards:p.historicalPassingYards,historicalPassAttempts:p.historicalPassAttempts,modeledPassAttempts:p.pos==='QB'&&!supportedMarkets.has(marketKey(p.id,'passYards'))?null:p.pass,...(p.targetMatchup?{targetMatchup:p.targetMatchup}:{}),passingMatchupFactor:p.passMatch,receivingMatchupFactor:p.recMatch,rushingMatchupFactor:p.rushMatch,participationAssumption:p.pos==='QB'&&!supportedMarkets.has(marketKey(p.id,'passYards'))?'Not selected as the modeled quarterback; named QB passing and rushing scenarios are unavailable. Game-day starting status is not confirmed.':'Assumes listed eligible player participates; game-day active status is not confirmed'})),audit:{passingReceivingConservation:true},
  count,seed,teams:summary,markets,unavailableMarkets,
  ...(outcomeRows.size?{outcomeSetId,playerOutcomes:[...outcomeRows].map(([key,values])=>{const [id,market]=JSON.parse(key);return {id,market,values,outcomeSetId}})}:{}),
  ...(settlementBins?{settlements:[...settlementBins].map(([key,bins])=>{
   const [id,market]=JSON.parse(key);
   return {id,market,count,bins:[...bins].sort((a,b)=>a[0]-b[0])};
  })}:{}),
  joint:selections.length?{legs:selections.length,hits:joint,scenarioRate:joint/count}:null,
  ...(parlayLegs?{parlay:{count,legs:parlayLegs.length,
   allWinCount:parlayAllWin,nonLossCount:parlayNonLoss,
   // At least one push and no losing leg. Book-specific parlay repricing
   // determines payout; this category does not imply a full-stake refund.
   pushOnlyCount:parlayNonLoss-parlayAllWin,lossCount:count-parlayNonLoss,
   allWinRate:parlayAllWin/count,nonLossRate:parlayNonLoss/count,
   pushOnlyRate:(parlayNonLoss-parlayAllWin)/count,lossRate:(count-parlayNonLoss)/count}}:{}),
  assumptions:['Generative team play volume and pass/rush split','Player targets and carries compete for team opportunities',
   'Receptions require target and completion','Quarterback passing yards derive from completed receiver outcomes',
   'Pace/game script drive within-game dependencies','Distribution parameters and correlations are NOT calibrated']};
}
const api={build,simulate,tightEndTargetBaseline,tightEndOpportunity,quietTightEndTargets,MARKETS,blocked,MODEL_VERSION};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.PropVaultGameEngine=api;
})(typeof self!=='undefined'?self:typeof globalThis!=='undefined'?globalThis:this);

