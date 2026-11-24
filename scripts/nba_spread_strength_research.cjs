/* Compare NBA possession margins with directly fitted team-strength margins.
   No sportsbook inputs; retrospective results are reused diagnostics only. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),engine=require('../nba_possession_engine.js');
const W=[0,.25,.5,.75,1],THRESHOLDS=[-14.5,-7.5,-3.5,.5,3.5,7.5,14.5];
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
function fit(history){
 const rows=history.map(g=>({h:g.home,a:g.away,y:g.h.pts-g.a.pts,
   venue:String(g.neutralSite)==='true'?0:1,w:1}));
 if(rows.length<40)throw Error('Insufficient historical team strength');
 const teams=[...new Set(rows.flatMap(r=>[r.h,r.a]))],rating=Object.fromEntries(teams.map(t=>[t,0]));
 let home=2;
 // Shrunk least squares on signed game margins, fitted jointly against opponents.
 for(let iter=0;iter<40;iter++){
  home=(rows.reduce((s,r)=>s+r.w*r.venue*(r.y-rating[r.h]+rating[r.a]),0)+12*2)/(rows.reduce((s,r)=>s+r.w*r.venue*r.venue,0)+12);
  for(const t of teams){
   const games=rows.filter(r=>r.h===t||r.a===t);
   rating[t]=games.reduce((s,r)=>s+r.w*(r.h===t?r.y-home*r.venue+rating[r.a]:-r.y+home*r.venue+rating[r.h]),0)/(games.reduce((s,r)=>s+r.w,0)+8);
  }
 }
 return {home,rating};
}
function metrics(m,actual){
 const sorted=[...m].sort((a,b)=>a-b),q=p=>sorted[Math.floor(p*(sorted.length-1))];
 return {margin_mae:Math.abs(mean(m)-actual),spread_brier:mean(THRESHOLDS.map(t=>(mean(m.map(x=>Number(x>t)))-Number(actual>t))**2)),margin_bias:mean(m)-actual,interval80_coverage:Number(q(.1)<=actual&&actual<=q(.9))};
}
function replay(feed){
 const rows=[],skipped=[];
 for(const g of engine.records(feed,Infinity).slice(0,80).reverse()){
  try{
   const tip=Date.parse(g.date),earlier={...feed,games:feed.games.filter(x=>Date.parse(x.date)<tip-86400000)};
   const hist=engine.records(earlier,tip),rating=fit(hist);
   if(!Number.isFinite(rating.rating[g.home])||!Number.isFinite(rating.rating[g.away]))throw Error('Team rating missing');
   const model=engine.build({...g,status:'STATUS_SCHEDULED'},earlier,{injuries:[]},{},tip-1,{historical:true});
   const r=engine.draws(model,1000,6472026),raw=r.home.map((h,i)=>h-r.away[i]);
   const target=rating.rating[g.home]-rating.rating[g.away]+(String(g.neutralSite)==='true'?0:rating.home);
   const center=mean(raw);
   rows.push({date:g.date,metrics:Object.fromEntries(W.map(w=>[w,metrics(raw.map(x=>x+w*(target-center)),g.h.pts-g.a.pts)]))});
  }catch(e){skipped.push({id:String(g.id),reason:e.message})}
 }
 const dates=[...new Set(rows.map(r=>r.date.slice(0,10)))].sort(),cutoff=dates[Math.floor(dates.length*2/3)];
 const dev=rows.filter(r=>r.date.slice(0,10)<cutoff),diagnostic=rows.filter(r=>r.date.slice(0,10)>=cutoff);
 if(dev.length<10||diagnostic.length<10)throw Error('Insufficient chronological evaluation');
 const summarize=rs=>Object.fromEntries(W.map(w=>[w,Object.fromEntries(Object.keys(rs[0].metrics[w]).map(k=>[k,mean(rs.map(r=>r.metrics[w][k]))]))]));
 const training=summarize(dev),test=summarize(diagnostic),selected=[...W].sort((a,b)=>training[a].margin_mae-training[b].margin_mae)[0];
 return {status:'RESEARCH_ONLY',model:'nba-possession-strength-margin-v1',development_games:dev.length,diagnostic_games:diagnostic.length,development_selected_weight:selected,development:training,reused_diagnostic:test,skipped,
 limits:'Continuous margin-only distribution shift, not a score simulation. Earlier box scores only; 24-hour embargo; historical injury/lineup snapshots unavailable; no live promotion.'};
}
if(require.main===module)console.log(JSON.stringify(replay(JSON.parse(fs.readFileSync(path.resolve(__dirname,'../data/nba_games.json'),'utf8'))),null,2));
module.exports={fit,metrics,replay};
