/* Chronological replay of actual possession events. No sportsbook input to fitting or selection. */
'use strict';
const fs=require('node:fs'),engine=require('../nba_possession_engine.js'),strength=require('../nba_spread_strength.js');
const assert=require('node:assert/strict');
const CONFIGS=[{id:'current',ridge:8,noise:1},{id:'ridge4',ridge:4,noise:1},{id:'ridge2',ridge:2,noise:1},{id:'noiseHalf',ridge:8,noise:.5},{id:'ridge4NoiseHalf',ridge:4,noise:.5},{id:'ridge2NoiseHalf',ridge:2,noise:.5},{id:'noiseZero',ridge:8,noise:0}];
const THRESHOLDS=[-14.5,-7.5,-3.5,.5,3.5,7.5,14.5],mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const quantile=(a,p)=>a[Math.floor((a.length-1)*p)];
function outcomeMetrics(draw,actual,actualTotal){
 const m=draw.home.map((h,i)=>h-draw.away[i]),t=draw.home.map((h,i)=>h+draw.away[i]),center=mean(m),sorted=[...m].sort((a,b)=>a-b);
 const variance=mean(m.map(x=>(x-center)**2));
 const probs=THRESHOLDS.map(t=>mean(m.map(x=>Number(x>t))));
 const wp=mean(m.map(x=>Number(x>0)));
 return {center,total:mean(t),error:center-actual,margin_mae:Math.abs(center-actual),margin_mse:(center-actual)**2,total_mae:Math.abs(mean(t)-actualTotal),spread_brier:mean(probs.map((p,i)=>(p-Number(actual>THRESHOLDS[i]))**2)),moneyline_brier:(wp-Number(actual>0))**2,coverage80:Number(actual>=quantile(sorted,.1)&&actual<=quantile(sorted,.9)),interval80_width:quantile(sorted,.9)-quantile(sorted,.1),variance,homeWin:wp};
}
function summarize(rows,id){
 const a=rows.map(r=>r.models[id]),avg=k=>mean(a.map(x=>x[k]));
 const m=avg('center'),y=mean(rows.map(r=>r.actual)),den=mean(a.map(x=>(x.center-m)**2));
 const slope=den>0?mean(rows.map((r,i)=>(a[i].center-m)*(r.actual-y)))/den:null;
 return {games:a.length,margin_mae:avg('margin_mae'),rmse:Math.sqrt(avg('margin_mse')),margin_bias:avg('error'),spread_brier:avg('spread_brier'),moneyline_brier:avg('moneyline_brier'),total_mae:avg('total_mae'),coverage80:avg('coverage80'),interval80_width:avg('interval80_width'),predicted_residual_sd:Math.sqrt(avg('variance')),actual_vs_projected_slope:slope,mean_absolute_projection:mean(a.map(x=>Math.abs(x.center)))};
}
function marketAudit(rows,quotes,id){
 const paired=rows.flatMap(r=>{const q=quotes.get(r.id);if(!q||q.home!==r.home||q.away!==r.away||Date.parse(q.start)!==Date.parse(r.date)||q.actual.home-q.actual.away!==r.actual||!Number.isFinite(q.quote?.home_spread))return [];return [{...r,market:-q.quote.home_spread}];});
 const group=a=>{const side=r=>Math.sign(r.market),avg=f=>mean(a.map(f));return {games:a.length,book_margin:avg(r=>Math.abs(r.market)),model_margin:avg(r=>side(r)*r.models[id].center),actual_margin:avg(r=>side(r)*r.actual),smaller_than_book:a.filter(r=>side(r)*r.models[id].center<Math.abs(r.market)).length,market_mae:avg(r=>Math.abs(r.market-r.actual)),model_mae:avg(r=>r.models[id].margin_mae),mean_market_gap:avg(r=>Math.abs(r.market-r.models[id].center))};};
 return {all:group(paired),favorites7:group(paired.filter(r=>Math.abs(r.market)>=7)),favorites10:group(paired.filter(r=>Math.abs(r.market)>=10))};
}
function replay(feed,quoteRows=[]){
 const rows=[],skipped=[];
 for(const g of engine.records(feed,Infinity).slice(0,120).reverse()){
  try{
   const tip=Date.parse(g.date),cutoff=tip-86400000;
   const earlier={...feed,games:feed.games.filter(x=>Date.parse(x.date)<cutoff)};
   const model=engine.build({...g,status:'STATUS_SCHEDULED'},earlier,{injuries:[]},{},tip-1,{historical:true});
   const pilot=engine.draws(model,1000,6472026),referenceMargin=mean(pilot.home)-mean(pilot.away);
   const actual=g.h.pts-g.a.pts,actualTotal=g.h.pts+g.a.pts,models={};
   const offsets=new Map();
   for(const cfg of CONFIGS){
    if(!offsets.has(cfg.ridge)){
     const r=strength.prepare(g,earlier,engine,tip-1,{ridge:cfg.ridge});
     const correction=Math.max(-8,Math.min(8,r.margin-referenceMargin));
     const offset=Math.max(-.025,Math.min(.025,correction/(model.pace*4)));
     offsets.set(cfg.ridge,{shotOffsets:{[g.home]:offset,[g.away]:-offset}});
    }
    const adjusted={...model,strengthAnchor:offsets.get(cfg.ridge)};
    const draw=engine.draws(adjusted,2000,6472026,{researchNoiseScale:cfg.noise});
    assert.equal(draw.home.length,2000);assert.ok(draw.home.every((h,i)=>Number.isInteger(h)&&Number.isInteger(draw.away[i])&&h!==draw.away[i]));
    for(const team of [g.home,g.away]){
     const pts=draw.players.filter(p=>p.team===team).reduce((s,p)=>s+p.points,0);
     assert.ok(Math.abs(pts-mean(team===g.home?draw.home:draw.away))<1e-7,'Player score conservation');
    }
    models[cfg.id]=outcomeMetrics(draw,actual,actualTotal);
   }
   rows.push({id:String(g.id),date:g.date,home:g.home,away:g.away,actual,actualTotal,models});
  }catch(e){skipped.push({id:String(g.id),reason:e.message});}
 }
 const days=[...new Set(rows.map(r=>r.date.slice(0,10)))].sort(),split=days[Math.floor(days.length*2/3)];
 const development=rows.filter(r=>r.date.slice(0,10)<split),diagnostic=rows.filter(r=>r.date.slice(0,10)>=split);
 assert.ok(development.length>=30&&diagnostic.length>=20,'Insufficient chronological replay');
 const dev=Object.fromEntries(CONFIGS.map(c=>[c.id,summarize(development,c.id)])),test=Object.fromEntries(CONFIGS.map(c=>[c.id,summarize(diagnostic,c.id)]));
 // Pre-specified selection uses outcomes ONLY, not sportsbook spreads, and penalizes degrading probability forecasts.
 const feasible=CONFIGS.filter(c=>c.id!=='current'&&dev[c.id].margin_mae<dev.current.margin_mae&&dev[c.id].spread_brier<=dev.current.spread_brier&&dev[c.id].moneyline_brier<=dev.current.moneyline_brier&&dev[c.id].total_mae<=dev.current.total_mae+1);
 const selected=feasible.sort((a,b)=>dev[a.id].margin_mae-dev[b.id].margin_mae)[0]?.id||'current';
 const passesDiagnostic=selected!=='current'&&test[selected].margin_mae<test.current.margin_mae&&test[selected].spread_brier<=test.current.spread_brier&&test[selected].moneyline_brier<=test.current.moneyline_brier&&test[selected].total_mae<=test.current.total_mae+1;
 // Quotes deliberately joined only AFTER the candidate decision.
 const quotes=new Map(quoteRows.map(r=>[r.game_id,r]));
 return {status:'RESEARCH_ONLY',configs:CONFIGS,split,development:dev,reused_diagnostic:test,development_selected:selected,passes_diagnostic:passesDiagnostic,market_diagnostic:{current:marketAudit(diagnostic,quotes,'current'),selected:marketAudit(diagnostic,quotes,selected)},market_all:{current:marketAudit(rows,quotes,'current'),selected:marketAudit(rows,quotes,selected)},skipped,rows,limits:'Actual possession draws, 2000 per configuration; 24h embargo; no historical injury snapshots; recent historical games overlap prior research and are not independent confirmation. Reference is historical availability. Current comparison is the integrated algorithm on these historical inputs, not archived live forecasts. Selection uses actual outcomes only. Market quotes are joined afterward. No automatic deployment or proof of predictive edge.'};
}
if(require.main===module){
 const feed=JSON.parse(fs.readFileSync('data/nba_games.json','utf8'));
 const report=JSON.parse(fs.readFileSync('data/nba_closing_benchmark.json','utf8'));
 console.log(JSON.stringify(replay(feed,report.rows?.historical||[]),null,2));
}
module.exports={replay,outcomeMetrics,summarize};
