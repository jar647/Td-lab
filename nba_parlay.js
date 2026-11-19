/* NBA research drafts: supported roles, exact lines and shared game outcomes.
 * Book prices never enter selection. Model frequencies are not calibrated odds. */
(function(root,factory){
 const api=factory(typeof module==='object'&&module.exports?require('./nba_prop_lines.js'):root.CookNBAPropLines);
 if(typeof module==='object'&&module.exports)module.exports=api;root.PropShopNBAParlay=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(lines){
 'use strict';
 const MIN_SAMPLES=1000,MAX_SAMPLES=100000,BEAM=64;
 const finite=value=>typeof value==='number'&&Number.isFinite(value);
 const id=value=>typeof value==='string'&&value.trim()?value.trim():Number.isSafeInteger(value)&&value>=0?String(value):null;
 const time=value=>typeof value==='string'&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)?Date.parse(value):NaN;
 const clamp=value=>Math.max(0,Math.min(1,value)),mean=values=>values.reduce((sum,x)=>sum+x,0)/Math.max(1,values.length);
 const LIMITS=[
  'Experimental shared-outcome frequencies, not calibrated win probabilities or a verified betting edge.',
  'Same-game results are counted from aligned simulated outcomes. Distinct game groups are combined under an explicit independence assumption.',
  'Default lines are research targets until the actual sportsbook line is entered. No sportsbook price influences matchup scores or draft selection.',
  'The bounded research search balances matchup quality, minutes stability, line difficulty and joint outcomes; it is not a guarantee of an optimal or profitable ticket.'
 ];
 function sensitivity(prepared){
  const players=[...new Set(prepared.flatMap(p=>p.raw.availabilitySensitivity?.type==='equal_weight_in_out'
   ?(p.raw.availabilitySensitivity.players||[]).filter(x=>typeof x==='string'&&x.trim()):[]))];
  const used=prepared.some(p=>p.raw.availabilitySensitivity?.type==='equal_weight_in_out');
  return {used,players,type:used?'equal_weight_in_out':null,probabilityValidated:false};
 }
 function disclosures(prepared){
  const availabilitySensitivity=sensitivity(prepared),limits=[...LIMITS];
  if(availabilitySensitivity.used)limits.push('Game outcomes include equally weighted in/out sensitivity'+
   (availabilitySensitivity.players.length?' for '+availabilitySensitivity.players.join(', '):' for uncertain teammates')+
   '. These weights are not estimated real-world participation probabilities.');
  return {availabilitySensitivity,limits};
 }
 function empty(reason,{requested=0,legs=[],mode=null,gameId=null}={}){
  return {available:false,status:'PASS',legs,requested,shortfall:Math.max(0,requested-legs.length),mode,gameId,
   jointFrequency:null,nonLossFrequency:null,pushFrequency:null,lossFrequency:null,
   gameGroups:[],correlations:[],legFrequencies:[],independentGames:false,calibrated:false,play:false,reason,...disclosures(legs.map(raw=>({raw})))};
 }
 function prepare(raw,now){
  const c=raw,g=c?.game,r=c?.roleEvidence,market=lines?.canonical(c?.market);
  if(!c||!g||!r||!market||!id(c.key)||!id(c.playerId)||!id(c.gameId)||id(g.id)!==id(c.gameId)||
   typeof c.name!=='string'||!c.name.trim()||c.side!=='over'||c.eligible!==true||c.reviewRequired||c.parlayEligible===false||
   !finite(c.score)||c.score<85||c.score>100||!finite(c.line)||c.line<.5||c.line>400||
   c.matchupRating?.score!==undefined&&c.matchupRating.score!==c.score)return null;
  if(g.status!=='STATUS_SCHEDULED'||typeof g.home!=='string'||!g.home.trim()||typeof g.away!=='string'||!g.away.trim()||g.home===g.away||
   ![g.home,g.away].includes(c.team)||c.opponent!==undefined&&c.opponent!==(c.team===g.home?g.away:g.home))return null;
  const tip=time(g.date);if(!Number.isFinite(tip)||tip<=now||tip-now>7*86400000)return null;
  const supported=new Set(['NOT LISTED','ACTIVE','AVAILABLE','PROBABLE']);
  if(id(r.playerId)!==id(c.playerId)||r.team!==c.team||r.eligible!==true||r.roleStatus!=='SUPPORTED'||!supported.has(String(r.status||'').toUpperCase())||
   c.status!==undefined&&!supported.has(String(c.status).toUpperCase())||
   !finite(r.projectedMinutes)||!finite(r.minutesLow)||!finite(r.minutesHigh)||r.minutesLow<20||r.minutesHigh>48||
   r.minutesHigh<r.minutesLow||r.minutesHigh-r.minutesLow>6||r.projectedMinutes<r.minutesLow-.01||r.projectedMinutes>r.minutesHigh+.01||
   !Number.isInteger(r.historyGames)||r.historyGames<5||!Array.isArray(r.holdReasons)||r.holdReasons.length)return null;
  const inputs=c.inputTimes;if(!inputs||typeof inputs!=='object')return null;
  const stamps={};for(const [key,hours]of [['games',12],['injuries',tip-now<=90*60000?.25:12],['rosters',72]]){
   const stamp=time(inputs[key]);if(!Number.isFinite(stamp)||stamp>now+300000||now-stamp>hours*3600000)return null;stamps[key]=stamp;
  }
  // A current candidate cannot rehabilitate roles built from different feeds.
  if(r.inputTimes!==undefined&&(!r.inputTimes||typeof r.inputTimes!=='object'||
   Object.keys(stamps).some(key=>time(r.inputTimes[key])!==stamps[key])))return null;
  if(!Array.isArray(c.samples)||c.samples.length<MIN_SAMPLES||c.samples.length>MAX_SAMPLES||c.samples.some(x=>!finite(x)||x<0))return null;
  const settlement=lines.evaluate(c.samples,c.line);if(!settlement.available)return null;
  const win=new Uint8Array(c.samples.length),nonLoss=new Uint8Array(c.samples.length);
  for(let i=0;i<c.samples.length;i++){win[i]=Number(c.samples[i]>c.line);nonLoss[i]=Number(c.samples[i]>=c.line)}
  return {raw:c,key:id(c.key),playerId:id(c.playerId),gameId:id(c.gameId),market,
   tip,fixture:JSON.stringify([g.home,g.away,tip]),source:JSON.stringify(stamps),set:id(c.outcomeSetId),
   win,nonLoss,settlement,probability:settlement.winFrequency,
   stability:1-clamp((r.minutesHigh-r.minutesLow)/6),coverage:clamp(r.historyGames/10),
   quality:(c.score-85)/15,balance:1-clamp(Math.abs(settlement.winFrequency-.75)/.25)};
 }
 function ambiguousGames(pool){
  const fixtures=new Map(),physical=new Map(),bad=new Set();
  for(const p of pool){
   if(fixtures.has(p.gameId)&&fixtures.get(p.gameId)!==p.fixture)bad.add(p.gameId);else fixtures.set(p.gameId,p.fixture);
   if(physical.has(p.fixture)&&physical.get(p.fixture)!==p.gameId){bad.add(p.gameId);bad.add(physical.get(p.fixture))}else physical.set(p.fixture,p.gameId);
  }
  return bad;
 }
 function groupMetrics(group){
  const first=group[0],count=first.win.length;
  if(group.some(p=>p.fixture!==first.fixture||p.source!==first.source||p.win.length!==count)||
   group.length>1&&(!first.set||group.some(p=>p.set!==first.set)))return null;
  if(group.length===1){const s=first.settlement;return {gameId:first.gameId,legs:1,sampleCount:count,outcomeSetId:first.set,
   allWinCount:s.wins,nonLossCount:s.wins+s.pushes,pushCount:s.pushes,lossCount:s.losses,
   allWinFrequency:s.winFrequency,nonLossFrequency:s.winFrequency+s.pushFrequency,
   pushFrequency:s.pushFrequency,lossFrequency:s.lossFrequency,correlations:[]};}
  let allWinCount=0,nonLossCount=0;const correlations=[];
  for(let i=0;i<count;i++){
   let won=true,notLost=true;for(const p of group){won=won&&!!p.win[i];notLost=notLost&&!!p.nonLoss[i]}
   allWinCount+=Number(won);nonLossCount+=Number(notLost);
  }
  for(let a=0;a<group.length;a++)for(let b=a+1;b<group.length;b++){
   const x=group[a],y=group[b];let wins=0;for(let i=0;i<count;i++)wins+=Number(x.win[i]&&y.win[i]);
   const shared=wins/count,independent=x.probability*y.probability;
   const denominator=Math.sqrt(x.probability*(1-x.probability)*y.probability*(1-y.probability));
   correlations.push({a:x.key,b:y.key,gameId:first.gameId,sharedHitFrequency:shared,
    independentHitFrequency:independent,ratio:independent?shared/independent:null,
    coefficient:denominator?(shared-independent)/denominator:null});
  }
  return {gameId:first.gameId,legs:group.length,sampleCount:count,outcomeSetId:first.set,
   allWinCount,nonLossCount,pushCount:nonLossCount-allWinCount,lossCount:count-nonLossCount,
   allWinFrequency:allWinCount/count,nonLossFrequency:nonLossCount/count,
   pushFrequency:(nonLossCount-allWinCount)/count,lossFrequency:1-nonLossCount/count,correlations};
 }
 function metrics(prepared){
  const byGame=new Map();for(const p of prepared){if(!byGame.has(p.gameId))byGame.set(p.gameId,[]);byGame.get(p.gameId).push(p)}
  const groups=[];for(const group of byGame.values()){const result=groupMetrics(group);if(!result)return null;groups.push(result)}
  const jointFrequency=groups.reduce((n,g)=>n*g.allWinFrequency,1),nonLossFrequency=groups.reduce((n,g)=>n*g.nonLossFrequency,1);
  return {jointFrequency,nonLossFrequency,pushFrequency:nonLossFrequency-jointFrequency,
   lossFrequency:1-nonLossFrequency,gameGroups:groups,correlations:groups.flatMap(g=>g.correlations),independentGames:groups.length>1};
 }
 function describe(prepared,result){
  return prepared.map(p=>({...p.raw,probability:p.probability,pushProbability:p.settlement.pushFrequency,
   lossProbability:p.settlement.lossFrequency,
   parlayReason:p.raw.score+'/100 matchup; '+p.raw.roleEvidence.minutesLow.toFixed(1)+'–'+p.raw.roleEvidence.minutesHigh.toFixed(1)+
    ' supported minutes; '+(100*p.probability).toFixed(1)+'% of the exact-line simulation sample. '+
    (result.gameGroups.find(g=>g.gameId===p.gameId).legs>1?'Evaluated jointly with the other legs in this game.':'Adds a distinct game exposure.') }));
 }
 function evaluate(legs,{now=Date.now()}={}){
  if(!finite(now)||!Array.isArray(legs)||legs.length<2||legs.length>4)return empty('A parlay requires two to four supported exact-line legs.',{requested:Array.isArray(legs)?legs.length:0});
  const prepared=legs.map(c=>prepare(c,now));
  if(prepared.some(p=>!p))return empty('A selected player, line, role, source timestamp or upcoming fixture is no longer supported.',{requested:legs.length});
  if(new Set(prepared.map(p=>p.key)).size!==prepared.length)return empty('Selected legs must have distinct, unambiguous identities.',{requested:legs.length});
  if(new Set(prepared.map(p=>p.playerId)).size!==prepared.length)return empty('Use one leg per player; overlapping player props cannot be treated as separate support.',{requested:legs.length});
  if(ambiguousGames(prepared).size)return empty('The game identities or kickoff records are ambiguous.',{requested:legs.length});
  const result=metrics(prepared);if(!result)return empty('Same-game legs require the same aligned outcome batch and source records.',{requested:legs.length});
  return {available:true,status:'READY',legs:describe(prepared,result),requested:legs.length,shortfall:0,...result,
   legFrequencies:prepared.map(p=>({key:p.key,winFrequency:p.probability,pushFrequency:p.settlement.pushFrequency,lossFrequency:p.settlement.lossFrequency,count:p.win.length})),
   calibrated:false,play:false,reason:result.independentGames?'Exact-line game groups evaluated; separate games are assumed independent.':'All legs counted from the same aligned game simulations.',...disclosures(prepared)};
 }
 function evaluateLeg(leg,{now=Date.now()}={}){
  const p=finite(now)?prepare(leg,now):null;
  if(!p)return {available:false,reason:'The exact line or current player/source evidence is unsupported.',winFrequency:null,pushFrequency:null,lossFrequency:null};
  return {...p.settlement,leg:{...p.raw,probability:p.probability,pushProbability:p.settlement.pushFrequency,
   lossProbability:p.settlement.lossFrequency},calibrated:false};
 }
 function utility(prepared,result){
  if(!result||result.jointFrequency<=0||result.correlations.some(p=>p.ratio!==null&&p.ratio<.8))return null;
  const n=prepared.length,quality=mean(prepared.map(p=>p.quality)),balance=mean(prepared.map(p=>p.balance)),
   stability=mean(prepared.map(p=>p.stability*.75+p.coverage*.25));
  // Wilson lower planning bounds make 1,000 highly favorable draws less
  // compelling than the raw rate alone. Their product is a planning heuristic,
  // not a calibrated confidence interval for a multi-game ticket.
  const lower=g=>{const z=1.96,p=g.allWinFrequency,k=g.sampleCount,d=1+z*z/k;return Math.max(0,(p+z*z/(2*k)-z*Math.sqrt(p*(1-p)/k+z*z/(4*k*k)))/d)};
  const jointPlanningBound=result.gameGroups.reduce((p,g)=>p*lower(g),1),jointSupport=clamp(jointPlanningBound/Math.pow(.75,n));
  let exposurePenalty=0;
  for(let a=0;a<n;a++)for(let b=a+1;b<n;b++){
   if(prepared[a].raw.team===prepared[b].raw.team&&prepared[a].gameId===prepared[b].gameId)exposurePenalty+=.025;
   if(prepared[a].market===prepared[b].market)exposurePenalty+=.015;
  }
  exposurePenalty+=result.correlations.filter(p=>p.coefficient!==null&&p.coefficient>.65).length*.04;
  const score=.35*balance+.25*quality+.25*stability+.15*jointSupport-exposurePenalty;
  return {score,meanMatchupScore:mean(prepared.map(p=>p.raw.score)),meanMinutesRange:mean(prepared.map(p=>p.raw.roleEvidence.minutesHigh-p.raw.roleEvidence.minutesLow)),
   lineBalance:balance,roleStability:stability,jointPlanningBound,exposurePenalty,
   definition:'Research planning rank, not a hit probability. Prices are excluded.'};
 }
 function generate(candidates,{count=3,mode='cross_game',gameId,now=Date.now()}={}){
  const requested=Number.isInteger(count)&&count>=2&&count<=4?count:0,selectedGame=id(gameId);
  const fail=reason=>empty(reason,{requested,mode,gameId:selectedGame});
  if(!requested)return fail('Choose two to four legs.');
  if(mode!=='cross_game'&&mode!=='sgp')return fail('Choose distinct games or a selected same-game parlay.');
  if(mode==='sgp'&&!selectedGame)return fail('Choose a verified game for the same-game draft.');
  if(!finite(now)||!Array.isArray(candidates)||typeof lines?.evaluate!=='function')return fail('Current supported NBA outcomes are unavailable.');
  const prepared=candidates.map(c=>prepare(c,now)).filter(Boolean),bad=ambiguousGames(prepared),unique=new Map(),keys=new Map(),ambiguousKeys=new Set();
  for(const p of prepared){
   const signature=JSON.stringify([p.playerId,p.gameId,p.raw.team,p.market,p.raw.line,p.raw.score,p.fixture,p.source,p.set,
    p.raw.roleEvidence.projectedMinutes,p.raw.roleEvidence.minutesLow,p.raw.roleEvidence.minutesHigh,p.raw.roleEvidence.historyGames,p.raw.samples]);
   if(keys.has(p.key)&&keys.get(p.key)!==signature)ambiguousKeys.add(p.key);else keys.set(p.key,signature);
  }
  for(const p of prepared){
   if(bad.has(p.gameId)||ambiguousKeys.has(p.key)||mode==='sgp'&&p.gameId!==selectedGame||p.probability<.5||p.probability>.95||p.raw.line<lines.minimum(p.market)-.5)continue;
   if(!unique.has(p.key))unique.set(p.key,p);
  }
  const intrinsic=p=>.35*p.balance+.25*p.quality+.25*(p.stability*.75+p.coverage*.25)+.15*p.probability;
  const order=(a,b)=>intrinsic(b)-intrinsic(a)||a.key.localeCompare(b.key);
  const sorted=[...unique.values()].sort(order),perPlayer=new Map(),pool=[],pooled=new Set();
  const add=p=>{const key=p.gameId+'|'+p.playerId,n=perPlayer.get(key)||0;if(pooled.has(p.key)||n>=3||pool.length>=120)return;
   perPlayer.set(key,n+1);pooled.add(p.key);pool.push(p)};
  // Reserve fixture diversity before bounding search; a crowded game must not
  // erase otherwise supported games. Keep at most three markets per player.
  if(mode==='cross_game'){const games=new Set();for(const p of sorted)if(!games.has(p.gameId)){games.add(p.gameId);add(p)}}
  for(const p of sorted)add(p);
  pool.sort(order);
  if(!pool.length)return fail('No 85+ OVER candidates have current source records, stable supported minutes and suitable exact-line simulation frequencies.');
  let beam=[{indices:[],prepared:[],score:0,key:''}],best=null;
  const groupCache=new Map();
  function scoreCombo(combo){
   const cacheKey=combo.map(p=>p.key).sort().join('\n');
   if(groupCache.has(cacheKey))return groupCache.get(cacheKey);
   const result=metrics(combo),objective=utility(combo,result),scored=objective?{result,objective}:null;
   groupCache.set(cacheKey,scored);return scored;
  }
  for(let depth=1;depth<=requested;depth++){
   const next=[];
   for(const prior of beam)for(let index=(prior.indices.at(-1)??-1)+1;index<pool.length;index++){
    const p=pool[index];if(prior.prepared.some(x=>x.playerId===p.playerId||mode==='cross_game'&&x.gameId===p.gameId))continue;
    const combo=[...prior.prepared,p],scored=scoreCombo(combo);if(!scored)continue;
    next.push({indices:[...prior.indices,index],prepared:combo,score:scored.objective.score,key:combo.map(x=>x.key).sort().join('|'),...scored});
   }
   next.sort((a,b)=>b.score-a.score||a.key.localeCompare(b.key));beam=next.slice(0,BEAM);
   if(!beam.length)break;best=beam[0];
  }
  if(!best)return fail('Supported candidates do not form a compatible research draft.');
  const legs=describe(best.prepared,best.result),shortfall=requested-legs.length;
  if(shortfall){return {...empty('Only '+legs.length+' compatible supported legs are available; no filler was added and no complete-ticket percentage is supplied.',{requested,legs,mode,gameId:selectedGame}),
   legFrequencies:best.prepared.map(p=>({key:p.key,winFrequency:p.probability,pushFrequency:p.settlement.pushFrequency,lossFrequency:p.settlement.lossFrequency,count:p.win.length}))};}
  return {...evaluate(legs,{now}),requested,shortfall:0,mode,gameId:selectedGame,objective:best.objective,
   reason:'Draft balances supported matchup quality, minutes stability, line difficulty and shared game outcomes rather than taking the highest scores alone.'};
 }
 return {generate,evaluate,evaluateLeg,MIN_SAMPLES,LIMITS:[...LIMITS]};
});
