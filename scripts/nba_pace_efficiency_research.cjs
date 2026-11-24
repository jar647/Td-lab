/* NBA pace + rebound opportunity challenger, with the exact possession engine.
   All inputs are earlier reconciled boxes; no odds or final target stats.
   The reused historical sample is diagnostic, not independent validation. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),engine=require('../nba_possession_engine.js');
const opponent=require('./nba_opponent_possession_research.cjs');
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const clamp=(x,l,h)=>Math.max(l,Math.min(h,x));
function candidate(current,hist){
 const teams=current.teams, names=[current.game.home,current.game.away],league=current.league;
 const rating=opponent.fit(hist);
 const profiles={};
 for(const team of names){
  const gs=hist.filter(g=>g.home===team||g.away===team).slice(0,12);
  if(gs.length<3)throw Error('Insufficient pace/rebound evidence');
  const weighted=gs.map((g,i)=>({g,w:.93**i}));
  const pace=(weighted.reduce((s,{g,w})=>s+w*g.poss,0)+5*league.pace)/(weighted.reduce((s,x)=>s+x.w,0)+5);
  const own=g=>g.home===team?g.h:g.a,other=g=>g.home===team?g.a:g.h;
  const allowed=gs.reduce((s,g)=>s+other(g).orb,0),defensive=gs.reduce((s,g)=>s+own(g).drb,0);
  const orbAllowed=(allowed+100*league.orb)/(allowed+defensive+100);
  profiles[team]={pace,orbAllowed};
 }
 // Both teams influence pace; opponent defensive rebounding influences
 // the offense's second-chance probability. No added independent point bonus.
 const result={...current,pace:clamp(profiles[names[0]].pace+profiles[names[1]].pace-league.pace,75,120),
 teams:Object.fromEntries(names.map((t,i)=>{
  const v=teams[t],d=profiles[names[1-i]];
  const orb=clamp(v.orb+.5*(d.orbAllowed-league.orb),.10,.40);
  return [t,{...v,orb,strength:opponent.adjustment(rating,hist,t)}];
 }))};
 return result;
}
function replay(feed){
 const rows=[],skipped=[];
 for(const g of engine.records(feed,Infinity).slice(0,80).reverse()){
  try{
   const tip=Date.parse(g.date),earlier={...feed,games:feed.games.filter(x=>Date.parse(x.date)<tip-86400000)};
   const hist=engine.records(earlier,tip);
   const current=engine.build({...g,status:'STATUS_SCHEDULED'},earlier,{injuries:[]},{},tip-1,{historical:true});
   const joint=opponent.fit(hist);
   const previous={...current,teams:Object.fromEntries(Object.entries(current.teams).map(([t,v])=>[t,{...v,strength:opponent.adjustment(joint,hist,t)}]))};
   const next=candidate(current,hist);
   const results={};
   for(const [name,model] of Object.entries({current,previous,next})){
    const r=engine.draws(model,1000,6472026);
    results[name]={margin:Math.abs(mean(r.home)-mean(r.away)-g.h.pts+g.a.pts),
      total:Math.abs(mean(r.home)+mean(r.away)-g.h.pts-g.a.pts)};
   }
   rows.push({date:g.date,...results});
  }catch(e){skipped.push({id:String(g.id),reason:e.message})}
 }
 const dates=[...new Set(rows.map(r=>r.date.slice(0,10)))].sort(),cutoff=dates[Math.floor(dates.length*2/3)];
 const summarize=rs=>({games:rs.length,...Object.fromEntries(['current','previous','next'].map(k=>[k,rs.length?{margin_mae:mean(rs.map(r=>r[k].margin)),total_mae:mean(rs.map(r=>r[k].total))}:null]))});
 const development=summarize(rows.filter(r=>r.date.slice(0,10)<cutoff)),diagnostic=summarize(rows.filter(r=>r.date.slice(0,10)>=cutoff));
 if(development.games<10||diagnostic.games<10)throw Error('Insufficient historical replay');
 return {status:'RESEARCH_ONLY',candidate:'opponent-pace-rebounds-v2',model:engine.VERSION,cutoff,development,reused_diagnostic:diagnostic,skipped,
 limits:'24-hour result embargo; historical injuries unknown. Existing engine uses estimated possessions; no verified future results or live model changes.'};
}
if(require.main===module)console.log(JSON.stringify(replay(JSON.parse(fs.readFileSync(path.resolve(__dirname,'../data/nba_games.json'),'utf8'))),null,2));
module.exports={candidate,replay};
