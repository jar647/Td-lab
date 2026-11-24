/* Opponent-adjusted NBA possession challenger. No live weights or odds.
   Fit shrunk offense/defense effects from earlier reconciled box scores,
   replacing (not stacking with) the existing schedule-strength term. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),engine=require('../nba_possession_engine.js');
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const clamp=(v,l,h)=>Math.max(l,Math.min(h,v));
function fit(history,penalty=10){
 const rows=history.flatMap(g=>{
  const poss=g.poss*g.duration/48;
  return poss>0?[{off:g.home,def:g.away,y:g.h.pts/poss},{off:g.away,def:g.home,y:g.a.pts/poss}]:[];
 });
 if(rows.length<40)throw Error('Insufficient opponent-adjusted scoring history');
 const teams=[...new Set(rows.flatMap(r=>[r.off,r.def]))];
 const league=mean(rows.map(r=>r.y)),off={},def={};
 for(const t of teams){off[t]=0;def[t]=0}
 for(let iter=0;iter<30;iter++){
  for(const t of teams){
   const o=rows.filter(r=>r.off===t),d=rows.filter(r=>r.def===t);
   off[t]=o.reduce((s,r)=>s+r.y-league-def[r.def],0)/(o.length+penalty);
   def[t]=d.reduce((s,r)=>s+r.y-league-off[r.off],0)/(d.length+penalty);
  }
 }
 return {league,off,def,rows:rows.length};
}
function adjustment(model,history,team){
 const games=history.filter(g=>g.home===team||g.away===team).slice(0,12);
 if(games.length<3||!Number.isFinite(model.off[team]))throw Error('Insufficient team history');
 const schedule=games.map(g=>model.def[g.home===team?g.away:g.home]);
 if(!schedule.every(Number.isFinite))throw Error('Opponent rating unavailable');
 // Convert points per possession into a bounded shooting-probability
 // correction. This conversion is a challenger assumption, not calibration.
 return clamp(-mean(schedule)/2.3,-.03,.03);
}
function replay(feed){
 const targets=engine.records(feed,Infinity).slice(0,60).reverse(),rows=[],skipped=[];
 for(const g of targets){
  try{
   const tip=Date.parse(g.date),earlier={...feed,games:feed.games.filter(x=>Date.parse(x.date)<tip-86400000)};
   const hist=engine.records(earlier,tip),rating=fit(hist);
   const current=engine.build({...g,status:'STATUS_SCHEDULED'},earlier,{injuries:[]},{},tip-1,{historical:true});
   const candidate={...current,teams:Object.fromEntries(Object.entries(current.teams).map(([t,v])=>[t,{...v,strength:adjustment(rating,hist,t)}]))};
   const a=engine.draws(current,1000,6472026),b=engine.draws(candidate,1000,6472026);
   const errors=r=>({margin:Math.abs(mean(r.home)-mean(r.away)-g.h.pts+g.a.pts),total:Math.abs(mean(r.home)+mean(r.away)-g.h.pts-g.a.pts)});
   rows.push({id:g.id,date:g.date,current:errors(a),candidate:errors(b)});
  }catch(e){skipped.push({id:g.id,reason:e.message})}
 }
 const dates=[...new Set(rows.map(r=>r.date.slice(0,10)))].sort(),cutoff=dates[Math.floor(dates.length*2/3)];
 const split=(rs)=>({games:rs.length,...Object.fromEntries(['current','candidate'].map(k=>[k,rs.length?{margin_mae:mean(rs.map(r=>r[k].margin)),total_mae:mean(rs.map(r=>r[k].total))}:null]))});
 const development=split(rows.filter(r=>r.date.slice(0,10)<cutoff)),holdout=split(rows.filter(r=>r.date.slice(0,10)>=cutoff));
 if(development.games<10||holdout.games<10)throw Error('Insufficient matched chronological games');
 return {status:'RESEARCH_ONLY',model:engine.VERSION,candidate:'joint-offense-defense-schedule-v1',cutoff,development,holdout,skipped,
 limits:'Earlier box scores only; 24-hour embargo; historical injuries and roster announcements unknown. No live change or probability validation.'};
}
if(require.main===module)console.log(JSON.stringify(replay(JSON.parse(fs.readFileSync(path.resolve(__dirname,'../data/nba_games.json'),'utf8'))),null,2));
module.exports={fit,adjustment,replay};
