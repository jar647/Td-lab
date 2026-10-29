(function(root){
 'use strict';

 const POSITIONS=new Set(['RB','WR','TE','QB']);
 const PLAYING=new Set(['ROSTER_ACTIVE','QUESTIONABLE']);
 const finite=(value)=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));

 function estimate(gameRecords,allRecords){
  const game=Array.isArray(gameRecords)?gameRecords:[];
  const slate=Array.isArray(allRecords)?allRecords:[];
  const eligible=game.filter(r=>r&&r.market==='ATD'&&POSITIONS.has(String(r.pos||'').toUpperCase())&&PLAYING.has(String(r.availability||'').toUpperCase())&&r.playerAppearancesVerified!==false&&finite(r.playerRz)&&Number(r.playerRz)>=0&&finite(r.rzshare)&&Number(r.rzshare)>=0&&finite(r.tdallowed)&&finite(r.rzallowed)&&Number(r.rzallowed)>0&&finite(r.games)&&Number(r.games)>0);
  const teams=[...new Set(game.filter(r=>r&&r.team&&r.opp).map(r=>String(r.team)))];
  if(teams.length!==2)return {status:'insufficient_data',reason:'A complete two-team matchup was not identified.',players:[]};

  // Require broad red-zone usage coverage on both offenses. Missing players
  // must not disappear from the first-scorer denominator silently.
  const coverage={};
  for(const team of teams){
   const rows=new Map();
   for(const r of eligible.filter(x=>String(x.team)===team))rows.set(String(r.player_id||r.player),r);
   const distinct=[...rows.values()];
   const share=Math.min(100,distinct.reduce((sum,r)=>sum+Number(r.rzshare),0));
   coverage[team]={share,count:distinct.length};
   if(share<75||coverage[team].count<4)return {status:'insufficient_data',reason:team+' red-zone usage coverage is only '+share.toFixed(0)+'% across '+coverage[team].count+' eligible players; at least 75% and four players per team are required.',coverage,players:[]};
  }

  // Estimate positional TD conversion from the slate's opponent-defense
  // rates, deduplicated by defense and position. Sparse rates are shrunk
  // toward the slate-wide rate so one small defensive sample cannot dominate.
  const defenseRows=new Map();
  for(const r of slate){
   if(!r||!POSITIONS.has(String(r.pos||'').toUpperCase())||!r.opp||!finite(r.tdallowed)||!finite(r.rzallowed)||Number(r.rzallowed)<=0)continue;
   const key=String(r.opp)+'|'+String(r.pos).toUpperCase();
   if(!defenseRows.has(key))defenseRows.set(key,{pos:String(r.pos).toUpperCase(),td:Number(r.tdallowed),rz:Number(r.rzallowed)});
  }
  const league={};
  for(const pos of POSITIONS){
   const rows=[...defenseRows.values()].filter(x=>x.pos===pos);
   if(rows.length<8)return {status:'insufficient_data',reason:'Fewer than eight opponent-defense samples are available for '+pos+' TD conversion.',coverage,players:[]};
   const rz=rows.reduce((a,x)=>a+x.rz,0),td=rows.reduce((a,x)=>a+x.td,0);
   league[pos]=rz>0?Math.max(0,Math.min(1,td/rz)):NaN;
  }

  const players=[];
  const seen=new Set();
  for(const r of eligible){
   const id=String(r.player_id||r.player)+'|'+String(r.team);
   if(seen.has(id))continue;seen.add(id);
   const pos=String(r.pos).toUpperCase();
   const observed=Number(r.tdallowed)/Number(r.rzallowed);
   const prior=league[pos];
   // Three pseudo red-zone opportunities per game shrink a short or extreme
   // defensive conversion rate toward the slate's position baseline.
   const conversion=Math.max(0,Math.min(1,(observed*Number(r.rzallowed)+prior*3)/(Number(r.rzallowed)+3)));
   const seasonUse=Number(r.playerRz);
   const recentUse=finite(r.recentRz2)&&Number(r.recentRz2Games)>=2?Number(r.recentRz2):null;
   const workload=recentUse===null?seasonUse:.75*seasonUse+.25*recentUse;
   const questionable=String(r.availability).toUpperCase()==='QUESTIONABLE';
   // This is conditional on the player being active. Do not invent an
   // availability probability from an injury designation.
   const hazard=Math.max(0,workload*conversion);
   players.push({record:r,hazard,conversion,workload,questionable});
  }
  const total=players.reduce((sum,p)=>sum+p.hazard,0);
  if(!(total>0))return {status:'insufficient_data',reason:'Available red-zone usage and opponent conversion rates do not support a first-score estimate.',coverage,players:[]};
  const anyTrackedTd=1-Math.exp(-total);
  for(const p of players)p.probability=anyTrackedTd*p.hazard/total;
  players.sort((a,b)=>b.probability-a.probability||String(a.record.player).localeCompare(String(b.record.player)));
  return {status:'uncalibrated',reason:'Experimental competing-risk estimate: red-zone workload × opponent position TD conversion. First-score order has not passed independent holdout calibration; defensive/special-teams scores and untracked players are not modeled.',coverage,trackedTdProbability:anyTrackedTd,players};
 }

 const api={estimate};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(root)root.FirstTDProbability=api;
})(typeof globalThis!=='undefined'?globalThis:this);
