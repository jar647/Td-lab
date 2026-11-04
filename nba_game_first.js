/* Shared-outcome NBA matchup research; prices never change the simulation. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./nba_possession_engine.js'):root.CookNBAPossessions);if(typeof module==='object'&&module.exports)module.exports=api;root.CookNBAGameFirst=api;})(typeof globalThis!=='undefined'?globalThis:this,function(possessions){
'use strict';
const markets=['points','rebounds','assists','Points + Rebounds','Points + Assists','Rebounds + Assists','PRA'];
const fields=m=>({'Points + Rebounds':['points','rebounds'],'Points + Assists':['points','assists'],'Rebounds + Assists':['rebounds','assists'],PRA:['points','rebounds','assists']}[m]||[m]);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),mean=a=>a.reduce((s,x)=>s+x,0)/Math.max(1,a.length);
function chance(row,line){if(!Number.isFinite(line)||line<.5||!row.samples?.length)return null;return row.samples.filter(x=>x>line).length/row.samples.length;}
function candidate(row,excluded=[],lines={}){
 if(!row||!markets.includes(row.market)||excluded.includes(row.market)||/under/i.test(row.side||'')||row.eligible!==true||!(Number(row.matchupGames)>=3)||!Number.isFinite(row.forecast)||row.forecast<=0||!row.samples?.length||!(row.matchupBoost>0))return null;
 const minimum={points:8,rebounds:3,assists:3}[row.market]||10;if(row.forecast<minimum)return null;
 const override=lines[row.key];const line=override===undefined?Math.max(.5,Math.floor(row.forecast*.84-.5)+.5):override;
 const probability=chance(row,line);if(probability===null||probability<.5)return null;
 return {...row,line,side:'over',probability,researchOnly:true,score:Math.round(clamp(probability*65+Math.min(15,row.matchupBoost*100)+Math.min(10,row.matchupGames)+Math.min(10,row.minutes/4),0,100))};
}
function build(rows,options={}){
 const excluded=options.excludedMarkets||[],max=clamp(Math.trunc(Number(options.maxLegs)||5),1,5);
 const ranked=(rows||[]).map(r=>candidate(r,excluded,options.lines||{})).filter(Boolean).sort((a,b)=>b.score-a.score||b.matchupBoost-a.matchupBoost||a.key.localeCompare(b.key));
 const picks=[],seen=new Set(),correlations=[];let wins=null;
 for(const row of ranked){
  if(seen.has(String(row.playerId)))continue;
  if(picks.length&&row.gameId!==picks[0].gameId)continue;
  const hit=row.samples.map(x=>x>row.line);if(wins&&hit.length!==wins.length)continue;
  let conflicts=false;
  for(const prior of picks){const joint=mean(hit.map((v,i)=>Number(v&&prior.samples[i]>prior.line))),ratio=joint/Math.max(.001,row.probability*prior.probability);if(ratio<.8){conflicts=true;break}}
  if(conflicts)continue;
  for(const prior of picks)correlations.push({a:prior.key,b:row.key,joint:mean(hit.map((v,i)=>Number(v&&prior.samples[i]>prior.line)))});
  wins=wins?wins.map((v,i)=>v&&hit[i]):hit;seen.add(String(row.playerId));picks.push(row);if(picks.length>=max)break;
 }
 const unique=new Set(),topThree=ranked.filter(r=>!unique.has(r.playerId)&&unique.add(r.playerId)).slice(0,3);
 return {picks,bestSingle:ranked[0]||null,topThree,correlations,jointHitRate:wins?mean(wins.map(Number)):null,excludedMarkets:excluded,disclaimer:'Experimental simulation frequencies, not calibrated win probabilities or verified sportsbook edges. Ticket frequency is counted from shared game outcomes, never multiplied from individual percentages. Fewer legs are shown when evidence or compatibility is insufficient.'};
}
function analyze(game,feed,injuries,rosters,context,now=Date.now(),options={}){
 try{
  const model=possessions.build(game,feed,injuries,rosters,now,{context});
  const simulation=possessions.draws(model,options.count||1000,6472026,{collectPlayerOutcomes:true});
  const rows=[];
  for(const team of [game.away,game.home]){
   const own=model.teams[team],opponent=team===game.home?game.away:game.home,def=model.teams[opponent];
   for(const player of own.players){
    if(player.pending||own.minutes[player.id]<20)continue;
    const projected=simulation.players.find(p=>p.id===player.id),samples=simulation.playerOutcomes[player.id];
    const shotShare=own.minutes[player.id]*player.fga/Math.max(.001,own.players.reduce((s,p)=>s+own.minutes[p.id]*p.fga,0));
    const paceBoost=model.pace/model.league.pace-1,minuteBoost=own.minutes[player.id]/Math.max(1,player.baseline)-1;
    const shooting=(1-player.tpa/Math.max(.001,player.fga))*def.twoDefense+player.tpa/Math.max(.001,player.fga)*def.threeDefense;
    const reboundBoost=(model.league.orb-def.orb)*.25,assistBoost=shooting;
    const boosts={points:shooting*2,rebounds:reboundBoost,assists:assistBoost};
    for(const market of markets){
     const ks=fields(market),forecast=ks.reduce((s,k)=>s+projected[k],0),defense=mean(ks.map(k=>boosts[k]));
     const boost=defense+.35*paceBoost+.35*clamp(minuteBoost,-.2,.2);
     const values=samples[ks[0]].map((_,i)=>ks.reduce((s,k)=>s+samples[k][i],0));
     const reason=player.name+' vs '+opponent+': '+projected.minutes.toFixed(1)+' simulated minutes ('+player.baseline.toFixed(1)+' recent baseline), '+(100*shotShare).toFixed(1)+'% of projected team field-goal attempts. '+
      ks.map(k=>k==='rebounds'?'Rebound role: '+(player.orb*36).toFixed(1)+' offensive / '+(player.drb*36).toFixed(1)+' defensive boards per 36 observed minutes; opponent offensive-rebound rate '+(100*def.orb).toFixed(1)+'%. ':k==='assists'?'Creation role: '+(player.ast*36).toFixed(1)+' assists per 36 observed minutes; teammate shooting and opponent defense share the same simulation. ':'Player shooting mix: '+(100*(1-player.tpa/Math.max(.001,player.fga))).toFixed(0)+'% two-point attempts; opponent two-point defense delta '+(100*def.twoDefense).toFixed(1)+' percentage points. ').join('')+
      'Pace '+model.pace.toFixed(1)+' vs '+model.league.pace.toFixed(1)+' league sample possessions; '+player.sample+' player games / '+def.games+' opponent games.'+(own.absent.length?' Rotation redistributed with '+own.absent.join(', ')+' absent.':'')+' '+(100*simulation.blowoutRate).toFixed(1)+'% simulated blowouts; late-game minutes adjust in those outcomes.';
     rows.push({key:[game.id,player.id,market].join('|'),gameId:String(game.id),game,playerId:player.id,name:player.name,team,opponent,market,forecast,minutes:projected.minutes,matchupGames:def.games,matchupBoost:boost,samples:values,reason:reason+' '+(model.context?.tracking==='fresh'&&Object.keys(player.defenderExposure||{}).length?'Fresh defender tracking incorporated; historical exposure '+Number(player.matchupSample||0).toFixed(0)+' possessions, not a confirmed assignment.':'Individual defender tracking unavailable or stale; that adjustment is omitted.'),eligible:true});
    }
   }
  }
  return {rows,model: model.version,generatedAt:new Date(now).toISOString(),inputTimes:model.inputTimes,context:model.context,warnings:model.warnings,pace:model.pace,blowoutRate:simulation.blowoutRate,reason:null};
 }catch(e){return {rows:[],reason:e.message,warnings:[]};}
}
return {chance,candidate,build,analyze,markets};
});
