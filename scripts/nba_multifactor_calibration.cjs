/* Exact NBA possession-engine schedule-strength sensitivity, research only.
   Each candidate uses the same seed and earlier box scores. No live settings
   or sportsbook inputs are changed. The final dates are held out. */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const engine=require('../nba_possession_engine.js');
const SCALES=[0,.5,1,1.5],DRAWS=1000;
const average=a=>a.reduce((s,x)=>s+x,0)/a.length;
function metrics(rows,scale){
 if(!rows.length)return null;
 const preds=rows.map(r=>r.predictions[String(scale)]);
 return {games:rows.length,margin_mae:average(rows.map((r,i)=>Math.abs(preds[i].home-preds[i].away-r.actual_home+r.actual_away))),
 total_mae:average(rows.map((r,i)=>Math.abs(preds[i].home+preds[i].away-r.actual_home-r.actual_away)))};
}
function evaluate(rows){
 const dates=[...new Set(rows.map(r=>r.date.slice(0,10)))].sort();
 if(dates.length<4)throw Error('Insufficient separate historical dates');
 const cutoff=dates[Math.floor(dates.length*2/3)];
 const development=rows.filter(r=>r.date.slice(0,10)<cutoff),holdout=rows.filter(r=>r.date.slice(0,10)>=cutoff);
 if(development.length<10||holdout.length<10)throw Error('At least ten games required in each split');
 const training=Object.fromEntries(SCALES.map(s=>[s,metrics(development,s)]));
 const selected=[...SCALES].sort((a,b)=>training[a].margin_mae+training[a].total_mae-training[b].margin_mae-training[b].total_mae||a-b)[0];
 return {status:'RESEARCH_ONLY',model:engine.VERSION,cutoff,selected_scale:selected,development:training,
 holdout:{baseline:metrics(holdout,0),current:metrics(holdout,1),selected:metrics(holdout,selected)},live_weights_changed:false};
}
function replay(feed){
 const targets=engine.records(feed,Infinity).slice(0,80).reverse(),rows=[],skipped=[];
 for(const g of targets){
  try{
   const tip=Date.parse(g.date),earlier={...feed,games:feed.games.filter(x=>Date.parse(x.date)<tip-24*3600000)};
   const model=engine.build({...g,status:'STATUS_SCHEDULED'},earlier,{injuries:[]},{},tip-1,{historical:true});
   const predictions={};
   for(const scale of SCALES){
    const candidate={...model,teams:Object.fromEntries(Object.entries(model.teams).map(([t,v])=>[t,{...v,strength:v.strength*scale}]))};
    const r=engine.draws(candidate,DRAWS,6472026);
    predictions[String(scale)]={home:average(r.home),away:average(r.away)};
   }
   rows.push({id:String(g.id),date:g.date,actual_home:g.h.pts,actual_away:g.a.pts,predictions});
  }catch(e){skipped.push({id:String(g.id),reason:e.message});}
 }
 return {...evaluate(rows),attempted_games:targets.length,skipped_games:skipped,draws_per_candidate:DRAWS,
 scope:'Exact possession engine, changing only the existing schedule-strength term. Historical injuries and rosters unknown; 24-hour result embargo; not a full probability calibration.'};
}
if(require.main===module){
 const feed=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../data/nba_games.json'),'utf8'));
 console.log(JSON.stringify(replay(feed),null,2));
}
module.exports={metrics,evaluate,replay};
