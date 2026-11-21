/* Shared rotation and observed-opportunity evidence for NBA prop research.
 * Role-adjusted history is constructed research data, never official tracking
 * or a calibrated prediction. No sportsbook input enters this module.
 */
(function(root,factory){
 const api=factory(typeof module==='object'&&module.exports?require('./nba_possession_engine.js'):root.CookNBAPossessions,
  typeof module==='object'&&module.exports?require('./nba_game_context.js'):root.CookNBAGameContext);
 if(typeof module==='object'&&module.exports)module.exports=api;
 root.CookNBAPropEvidence=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(boxes,contextAPI){
 'use strict';
 const VERSION='nba-prop-evidence-v1',MIN_HISTORY=5,MIN_MINUTES=20,MAX_SCENARIO_SPREAD=6;
 const fields={points:['points'],rebounds:['rebounds'],assists:['assists'],threes:['threes'],pr:['points','rebounds'],pa:['points','assists'],ra:['rebounds','assists'],pra:['points','rebounds','assists'],steals:['steals'],blocks:['blocks'],stocks:['steals','blocks']};
 const finite=x=>typeof x==='number'&&Number.isFinite(x),mean=xs=>xs.length?xs.reduce((s,x)=>s+x,0)/xs.length:null;
 const normalized=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
 const supportedStatus=status=>['NOT LISTED','ACTIVE','AVAILABLE','PROBABLE'].includes(String(status||'').toUpperCase());
 const failure=reason=>({version:VERSION,ready:false,reason,players:{},sampleKind:'role_adjusted_history'});
 function fresh(data,now,hours){const at=Date.parse(data?.generated_at);return !!data&&(!data.status||data.status==='ok')&&Number.isFinite(at)&&at<=now+300000&&now-at<=hours*3600000;}
 function availability(game,injuries,now,context){return contextAPI?.availability?contextAPI.availability(context,game,injuries,now):injuries;}
 function verify(game,feed,rosters,injuries,now,model,context){
  const tip=Date.parse(game?.date);
  if(!Number.isFinite(tip))throw Error('Verified tipoff is required for role evidence');
  if(game.status!=='STATUS_SCHEDULED'||now>=tip)throw Error('Pregame role evidence closes after tipoff');
  if(!fresh(feed,now,12)||!fresh(rosters,now,72)||!fresh(injuries,now,12))throw Error('Fresh game, injury and roster feeds are required for role evidence');
  if(!Array.isArray(injuries.injuries))throw Error('Injury report schema unavailable for role evidence');
  if(tip-now<=90*60000&&now-Date.parse(injuries.generated_at)>15*60000)throw Error('Inside 90 minutes of tipoff, availability must be refreshed within 15 minutes');
  if(!model||model.historical||String(model.game?.id)!==String(game.id)||model.game?.home!==game.home||model.game?.away!==game.away||model.game?.date!==game.date)throw Error('Rotation model does not match the current fixture');
  if(model.inputTimes?.games!==feed.generated_at||model.inputTimes?.rosters!==rosters.generated_at||model.inputTimes?.injuries!==injuries.generated_at)throw Error('Rotation model sources changed; rebuild current role evidence');
  const currentLineup=!!contextAPI?.lineup?.(context,game,now);
  if(model.context?.observedAt!==(context?.generated_at||null)||(model.context?.lineups==='fresh')!==currentLineup)throw Error('Pregame lineup context changed; rebuild current role evidence');
  const generated=Date.parse(model.generatedAt);
  if(!Number.isFinite(generated)||generated>now+300000||generated<Math.max(...Object.values(model.inputTimes).map(Date.parse))-300000)throw Error('Rotation model observation time is unavailable or inconsistent');
  const ids=new Set();
  for(const team of [game.home,game.away]){
   const t=model.teams?.[team],members=rosters.teams?.[team];
   if(!t||!Array.isArray(t.players)||!Array.isArray(members)||!members.length||!(t.games>=3))throw Error(team+': supported current rotation is unavailable');
   const allowed=new Set(members.map(String));
   for(const player of t.players){
    const id=String(player.id||'');
    if(!id||ids.has(id)||player.team!==team||!allowed.has(id))throw Error('Player identity is ambiguous or absent from the current roster');
    ids.add(id);
    const reports=injuries.injuries.filter(r=>String(r.player_id||r.id||'')===id||normalized(r.player||r.name)===normalized(player.name));
    if(reports.some(r=>/\b(OUT|INACTIVE|DOUBTFUL|SUSPENDED)\b/.test(String(r.status||'').toUpperCase())))throw Error('Rotation model still includes a currently unavailable player; rebuild it');
    const statuses=[...new Set(reports.map(r=>String(r.status||'UNKNOWN').toUpperCase()))],expected=statuses.length>1?'UNKNOWN':statuses[0]||'NOT LISTED';
    if(player.status!==expected||Boolean(player.pending)!==!supportedStatus(expected))throw Error('Rotation availability changed; rebuild current role evidence');
   }
  }
 }
 function validHistory(player){return (Array.isArray(player.statHistory)?player.statHistory:[]).filter(row=>row&&finite(row.minutes)&&row.minutes>0&&row.minutes<=80&&['points','rebounds','assists','threes'].every(k=>finite(row[k])&&row[k]>=0)&&row.threes*3<=row.points);}
 function analyze(game,feed,rosters,injuries,now=Date.now(),options={}){
  try{
   if(!boxes||typeof boxes.build!=='function'||typeof boxes.allocate!=='function')throw Error('Existing rotation engine unavailable');
   const activeInjuries=availability(game,injuries,now,options.context);
   const model=options.model||boxes.build(game,feed,injuries,rosters,now,{context:options.context});
   verify(game,feed,rosters,activeInjuries,now,model,options.context);
   const players={},teamScenarios={};
   for(const team of [game.home,game.away]){
    const t=model.teams[team],all=t.players,healthy=all.filter(p=>!p.pending&&supportedStatus(p.status));
    const weights=rows=>Object.fromEntries(rows.map(p=>[String(p.id),p.weight]));
    if(all.some(p=>!finite(p.weight)||p.weight<=0))throw Error(team+': rotation weights are missing or invalid');
    const included=boxes.allocate(weights(all)),excluded=boxes.allocate(weights(healthy));
    if(!included||!excluded||healthy.length<6)throw Error(team+': uncertain availability leaves fewer than six supported rotation players');
    teamScenarios[team]={included,excluded,healthyPlayers:healthy.length,uncertainPlayers:all.filter(p=>p.pending||!supportedStatus(p.status)).map(p=>p.name)};
    const actionRate=p=>[p.fga,p.fta,p.to].every(x=>finite(x)&&x>=0)?p.fga+.44*p.fta+p.to:null;
    const actionRates=all.map(actionRate),teamActions=actionRates.every(x=>x!==null)?all.reduce((sum,p,i)=>sum+included[p.id]*actionRates[i],0):null;
    for(const p of all){
     const id=String(p.id),history=validHistory(p),recent=history.slice(0,5),baseline=mean(recent.map(r=>r.minutes));
     const low=Math.min(included[id]??0,excluded[id]??0),high=Math.max(included[id]??0,excluded[id]??0),holdReasons=[];
     const starterGames=Number.isInteger(p.roleMinutes?.starterGames)&&p.roleMinutes.starterGames>=0?p.roleMinutes.starterGames:0;
     const starterMinutes=finite(p.roleMinutes?.starter)?p.roleMinutes.starter:null;
     const starterSupport=starterGames>=3&&starterMinutes!==null&&low<=Math.min(40,starterMinutes+2);
     if(p.pending||!supportedStatus(p.status))holdReasons.push('Current availability is uncertain; no participation probability is assumed');
     if(history.length<MIN_HISTORY)holdReasons.push('At least five supported prior appearances are required for prop role evidence');
     if(!finite(low)||!finite(high)||low<MIN_MINUTES)holdReasons.push('Conservative supported minutes are below 20');
     if(high-low>MAX_SCENARIO_SPREAD)holdReasons.push('Supported in/out scenarios change this role by more than six minutes');
     if(baseline===null||baseline<=0)holdReasons.push('Recent observed minutes are unavailable');
     else if((low-baseline>6||low>baseline*1.25)&&!starterSupport)holdReasons.push('Projected workload jump lacks at least three supporting starter appearances');
     const fga=finite(p.fga)&&p.fga>=0?p.fga*low:null,threeAttempts=finite(p.tpa)&&p.tpa>=0?p.tpa*low:null,freeThrows=finite(p.fta)&&p.fta>=0?p.fta*low:null;
     if(fga===null||threeAttempts===null||freeThrows===null||threeAttempts>fga+1e-8||teamActions===null||!(teamActions>0))holdReasons.push('Observed shot-attempt and team-action evidence is incomplete');
     const selectionSamples=Object.fromEntries(Object.entries(fields).map(([market,keys])=>[market,history.filter(r=>keys.every(k=>finite(r[k])&&r[k]>=0)).map(r=>keys.reduce((sum,k)=>sum+r[k],0)/r.minutes*low)]));
     players[id]={playerId:id,name:p.name,team,status:p.status,lineupStatus:t.lineupStatus||'UNAVAILABLE',expectedStarter:p.starting===true,roleStatus:holdReasons.length?'HELD':'SUPPORTED',eligible:holdReasons.length===0,holdReasons,
      projectedMinutes:low,minutesLow:low,minutesHigh:high,recentMinutes:baseline,historyGames:history.length,starterGames,
      attempts:{fga,threeAttempts,freeThrows},opportunityShare:teamActions>0&&actionRate(p)!==null?included[id]*actionRate(p)/teamActions:null,
      opportunityBasis:'Share of observed field-goal attempts + 0.44 free-throw attempts + turnovers in the all-in projected rotation; a box-score proxy, not official usage or tracking.',
      selectionSamples,sampleKind:'role_adjusted_history',observedHistory:history.map(r=>({...r})),
      absentTeammates:Array.isArray(t.absent)?t.absent.slice():[],inputTimes:{...model.inputTimes},generatedAt:model.generatedAt,
      tracking:{potentialAssists:null,reboundChances:null,deflections:null,shotsContested:null},
      limits:'Minutes use the conservative bound across supported current and all-uncertain-out rotations. History is rescaled by those minutes; it is not recorded historical production or calibrated hit probability.'};
    }
   }
   return {version:VERSION,ready:true,reason:null,players,teamScenarios,model,
    ...(options.simulation?{simulation:options.simulation}:{}),sampleKind:'role_adjusted_history',inputTimes:{...model.inputTimes},
    method:'Existing rotation allocation with conservative availability scenarios and source-observed attempt rates. No new game simulation is run.'};
  }catch(error){return failure(error?.message||'Supported role evidence is unavailable');}
 }
 return {VERSION,analyze};
});
