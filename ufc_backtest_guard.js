/* Historical prediction integrity checks. No current-day career aggregates may
   be used as if they were available before a historical bout. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 root.UFCBacktestGuard=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function timestamp(v){if(typeof v!=='string')return null;const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(v);if(!m)return null;const [year,month,day,hour,minute,second]=m.slice(1,7).map(Number);const leap=year%4===0&&(year%100!==0||year%400===0);const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];if(year<1||month<1||month>12||day<1||day>days[month-1]||hour>23||minute>59||second>59)return null;const zone=m[7];if(zone!=='Z'){const zh=Number(zone.slice(1,3)),zm=Number(zone.slice(4,6));if(zh>14||zm>59||(zh===14&&zm!==0))return null;}const n=Date.parse(v);return Number.isFinite(n)?n:null;}
 function inspect(bout,profiles){
  const cutoff=timestamp(bout?.starts_at);
  const errors=[];
  if(cutoff===null)errors.push('missing_bout_timestamp');
  if(!Array.isArray(profiles)||profiles.length!==2)errors.push('missing_fighter_snapshots');
  else profiles.forEach((p,i)=>{
   const expected=String(i===0?bout?.fighter_a||'':bout?.fighter_b||'');
   const actual=String(p?.fighter_id||p?.id||'');
   if(!expected||!actual)errors.push('fighter_'+i+'_missing_snapshot_identity');
   else if(actual!==expected)errors.push('fighter_'+i+'_snapshot_identity_mismatch');
   const hasAsOf=p?.stats_as_of!==undefined&&p?.stats_as_of!==null;
   const hasSnapshot=p?.snapshot_at!==undefined&&p?.snapshot_at!==null;
   const asOf=hasAsOf?timestamp(p.stats_as_of):null;
   const collected=hasSnapshot?timestamp(p.snapshot_at):null;
   if((hasAsOf&&asOf===null)||(hasSnapshot&&collected===null)||(!hasAsOf&&!hasSnapshot))errors.push('fighter_'+i+'_missing_stats_snapshot_timestamp');
   if(asOf!==null&&collected!==null&&asOf>collected)errors.push('fighter_'+i+'_stats_as_of_after_collection');
   for(const at of [asOf,collected])if(at!==null&&cutoff!==null&&at>=cutoff){errors.push('fighter_'+i+'_stats_snapshot_after_bout');break;}
   const source=typeof p?.stats_source==='string'?p.stats_source.trim():'';
   if(!source)errors.push('fighter_'+i+'_missing_stats_source');
   const stats=p?.stats;
   if(!stats||typeof stats!=='object'||!Object.values(stats).some(v=>typeof v==='number'&&Number.isFinite(v)))errors.push('fighter_'+i+'_missing_numeric_stats');
  });
  return {eligible:errors.length===0,errors,cutoff:cutoff===null?null:new Date(cutoff).toISOString()};
 }
 function audit(bouts,snapshotsByBout){
  const rows=(Array.isArray(bouts)?bouts:[]).map(b=>{
   const id=String(b?.bout_id||'');
   const result=inspect(b,snapshotsByBout?.[id]);
   return {bout_id:id,...result};
  });
  return {total:rows.length,eligible:rows.filter(x=>x.eligible).length,blocked:rows.filter(x=>!x.eligible).length,rows};
 }
 return {inspect,audit};
});
