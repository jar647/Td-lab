/* Sourced pregame context. Historical matchup exposure is not tonight's assignment. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.CookNBAGameContext=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';const norm=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,''),clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function fresh(time,now,hours){const t=Date.parse(time);return Number.isFinite(t)&&t<=now&&now-t<=hours*3600000;}
function lineup(context,game,now){const g=context?.games?.[String(game.id)];return fresh(context?.sources?.lineups?.retrieved_at,now,.25)&&g&&g.tipoff===game.date&&Date.parse(g.observed_at)<Date.parse(game.date)?g:null;}
function availability(context,game,injuries,now){const report=context?.availability;let result=report&&fresh(report.generated_at,now,.25)&&Date.parse(report.generated_at)>Date.parse(injuries?.generated_at)?report:injuries;const g=lineup(context,game,now);if(!g)return result;
 const inactive=Object.values(g.teams).flatMap(t=>t.roster||[]).filter(p=>p.availability==='Inactive');if(!inactive.length)return result;
 const names=new Set(inactive.map(p=>norm(p.name)));return {...result,injuries:[...(result?.injuries||[]).filter(p=>!names.has(norm(p.player||p.name))),...inactive.map(p=>({player:p.name,status:'INACTIVE',source:'NBA.com confirmed roster'}))]};}
function apply(model,context,now){const g=model.game,l=lineup(context,g,now),seasonStart=new Date(g.date).getUTCFullYear()-(new Date(g.date).getUTCMonth()<9),season=seasonStart+'-'+String(seasonStart+1).slice(-2),tracking=!model.historical&&context?.season===season&&fresh(context?.sources?.tracking?.retrieved_at,now,48)&&context.sources.tracking.status==='ok',def=context?.defenders||{},names=new Map();
 for(const [id,d]of Object.entries(def)){const n=norm(d.name);names.set(n,names.has(n)?null:id)}
 model.context={observedAt:context?.generated_at||null,lineups:l?'fresh':'unavailable or older than 15 minutes',tracking:tracking?'fresh':'unavailable, partial or older than 48 hours',assignments:'Estimated from historical exposure and projected quarter minutes; switches/help coverage are not confirmed.',trackingWarning:context?.sources?.tracking?.refresh_error||null,coaching:'Historical substitution patterns; future tactical decisions remain unknown.'};
 for(const [team,t]of Object.entries(model.teams)){
  const source=l?.teams?.[team];t.lineupStatus=source?.status||'UNAVAILABLE';t.lineupSource='NBA.com daily lineups';t.starters=(source?.starters||[]).map(p=>p.name);t.rotationProfileGames=t.rotationProfileGames||0;
  const expected=new Set((source?.starters||[]).map(p=>norm(p.name)));for(const p of t.players){p.nbaId=names.get(norm(p.name))||null;p.starting=expected.has(norm(p.name));const role=p.starting?'starter':'bench',r=p.roleMinutes;if(source?.starters?.length===5&&r&&r[role+'Games']>=3&&p.starting!==(p.recentStarterRate>=.6)){p.weight=Math.max(5,Math.min(40,.5*p.weight+.5*r[role]));p.roleAdjusted=true;}p.tracking=tracking&&p.nbaId?def[p.nbaId]:null;}
  if(t.players.some(p=>p.roleAdjusted)){const weights=Object.fromEntries(t.players.map(p=>[p.id,p.weight])),out={},ids=Object.keys(weights);let left=240,pending=ids;if(ids.length*40<240)throw Error('Unsupported starting rotation');while(pending.length){const sum=pending.reduce((s,id)=>s+weights[id],0),full=pending.filter(id=>left*weights[id]/sum>40);if(!full.length){for(const id of pending)out[id]=left*weights[id]/sum;break}for(const id of full){out[id]=40;left-=40}pending=pending.filter(id=>!full.includes(id))}t.minutes=out;}
  if(t.lineupStatus==='CONFIRMED'){
   const supported=new Set(t.players.map(p=>norm(p.name)));if([...expected].some(n=>!supported.has(n)))throw Error(team+': confirmed starter lacks supported recent rotation data; review required');
  }
 }
 if(tracking){const pairs=new Map();for(const row of context.matchups||[]){if(!Number.isFinite(row.poss)||row.poss<5)continue;const key=row.off+':'+row.def;pairs.set(key,row)}
  for(const [team,t]of Object.entries(model.teams)){const opponent=model.teams[team===g.home?g.away:g.home];
   for(const p of t.players){p.defenderExposure={};if(!p.nbaId)continue;
    const rows=opponent.players.filter(d=>d.tracking).map(d=>({d,pair:pairs.get(p.nbaId+':'+d.nbaId)})),observed=rows.reduce((s,x)=>s+(x.pair?.poss||0),0);
    // Small samples shrink toward a position-aware rotation mixture, not an asserted assignment.
    for(const {d,pair}of rows){const pos=p.tracking?.position||'',defpos=d.tracking.position||'',compat=pos&&defpos?(pos===defpos?1.5:pos.includes(defpos)||defpos.includes(pos)?1.2:.75):1;p.defenderExposure[d.id]={weight:(observed/(observed+100))*(pair?.poss||0)/Math.max(1,observed)+(100/(observed+100))*compat/Math.max(1,rows.length),name:d.name,diff:clamp(d.tracking.diff*d.tracking.shots/(d.tracking.shots+200),-.04,.04),shots:d.tracking.shots,observedPoss:pair?.poss||0};}
    p.matchupSample=observed;
   }
  }
 }
 return model;
}
function defensiveDelta(shooter,defenders,minutes){const known=defenders.filter(d=>shooter.defenderExposure?.[d.id]),weights=known.map(d=>(minutes[d.id]||0)*shooter.defenderExposure[d.id].weight),sum=weights.reduce((a,b)=>a+b,0);return sum>0?known.reduce((s,d,i)=>s+weights[i]*shooter.defenderExposure[d.id].diff,0)/sum:null;}
return {fresh,lineup,availability,apply,defensiveDelta};
});
