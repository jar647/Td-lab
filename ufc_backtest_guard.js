/* Historical prediction integrity checks. No current-day career aggregates may
   be used as if they were available before a historical bout. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 root.UFCBacktestGuard=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function timestamp(v){const t=Date.parse(v);return Number.isFinite(t)?t:null;}
 function inspect(bout,profiles){
  const cutoff=timestamp(bout?.starts_at||bout?.event_date);
  const errors=[];
  if(cutoff===null)errors.push('missing_bout_timestamp');
  if(!Array.isArray(profiles)||profiles.length!==2)errors.push('missing_fighter_snapshots');
  else profiles.forEach((p,i)=>{
   const at=timestamp(p?.stats_as_of||p?.snapshot_at);
   if(at===null)errors.push('fighter_'+i+'_missing_stats_snapshot_timestamp');
   else if(cutoff!==null&&at>=cutoff)errors.push('fighter_'+i+'_stats_snapshot_after_bout');
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
