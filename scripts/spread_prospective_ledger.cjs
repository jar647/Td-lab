/* Immutable paired pregame evidence. Separate from live recommendations. */
'use strict';
const fs=require('node:fs');
const T=[-14.5,-7.5,-3.5,.5,3.5,7.5,14.5];
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const valid=d=>d&&Number.isFinite(d.margin)&&Array.isArray(d.probabilities)&&d.probabilities.length===T.length&&d.probabilities.every((p,i,a)=>Number.isFinite(p)&&p>=0&&p<=1&&(!i||p<=a[i-1]))&&Array.isArray(d.interval80)&&d.interval80.length===2&&d.interval80.every(Number.isFinite)&&d.interval80[0]<=d.interval80[1];
function update(previous,bundle,sport,now=Date.now()){
 const records=structuredClone(previous.records||[]),key=r=>r.sport+'|'+r.game_id+'|'+r.version;
 const keys=new Set(records.map(key));if(keys.size!==records.length)throw Error('Duplicate frozen evidence keys');
 for(const r of bundle.forecasts||[]){
  const start=Date.parse(r.start),captured=Date.parse(r.captured_at),source=Date.parse(r.source_at);
  if(r.sport!==sport||!r.game_id||!r.version||!r.home||!r.away||r.home===r.away||!Number.isFinite(start)||!Number.isFinite(captured)||!Number.isFinite(source)||source>captured||captured>=start||captured>now||start-captured>48*3600000||!valid(r.baseline)||!valid(r.candidate)||r.draws!==10000)throw Error('Invalid pregame paired evidence');
  if(!keys.has(key(r))){records.push({...structuredClone(r),actual:null});keys.add(key(r))}
 }
 for(const r of records){
  if(r.actual||r.sport!==sport)continue;
  const g=bundle.finals?.[r.game_id];if(!g||g.home!==r.home||g.away!==r.away||Date.parse(r.start)>=now||g.start&&Date.parse(g.start)!==Date.parse(r.start)||![g.home_points,g.away_points].every(x=>Number.isInteger(x)&&x>=0))continue;
  r.actual={home:g.home_points,away:g.away_points,graded_at:new Date(now).toISOString()};
 }
 const groups={};
 for(const r of records){const k=r.sport+'|'+r.version;(groups[k]??=[]).push(r)}
 const summary=Object.fromEntries(Object.entries(groups).map(([k,rows])=>{
  const graded=rows.filter(r=>r.actual),metrics=name=>{
   const errors=graded.map(r=>r[name].margin-(r.actual.home-r.actual.away));
   return {margin_mae:mean(errors.map(Math.abs)),margin_bias:mean(errors),spread_brier:mean(graded.map(r=>mean(T.map((t,i)=>(r[name].probabilities[i]-Number(r.actual.home-r.actual.away>t))**2)))),interval80_coverage:mean(graded.map(r=>Number(r.actual.home-r.actual.away>=r[name].interval80[0]&&r.actual.home-r.actual.away<=r[name].interval80[1])))};
  };
  return [k,{frozen:rows.length,graded:graded.length,baseline:metrics('baseline'),candidate:metrics('candidate')}];
 }));
 return {status:'PROSPECTIVE_RESEARCH_ONLY',thresholds:T,summary,records,latest_failures:bundle.failures||[],updated_at:new Date(now).toISOString(),limits:'First paired pregame freeze per model version. Synthetic fixed thresholds, not sportsbook lines; no profitability or live promotion implied.'};
}
if(require.main===module){
 const [sport,bundlePath,out]=process.argv.slice(2);
 if(!['NFL','NBA'].includes(sport)||!bundlePath||!out)throw Error('Expected sport, bundle and ledger paths');
 const previous=fs.existsSync(out)?JSON.parse(fs.readFileSync(out,'utf8')):{};
 const data=update(previous,JSON.parse(fs.readFileSync(bundlePath,'utf8')),sport);
 fs.writeFileSync(out+'.tmp',JSON.stringify(data,null,2)+'\n');fs.renameSync(out+'.tmp',out);
 console.log(JSON.stringify(data.summary));
}
module.exports={update};
