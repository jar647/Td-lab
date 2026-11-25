/* Pregame, frozen NBA spread candidate from PR166. No market inputs. */
'use strict';
const fs=require('node:fs'),engine=require('../nba_possession_engine.js'),gameEngine=require('../game_odds_engine.js'),strength=require('./nba_spread_strength_research.cjs');
const T=[-14.5,-7.5,-3.5,.5,3.5,7.5,14.5],VERSION='nba-possession-strength-prospective-v1';
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
function distribution(m){
 const sorted=[...m].sort((a,b)=>a-b);
 return {margin:mean(m),probabilities:T.map(t=>mean(m.map(x=>Number(x>t)))),interval80:[sorted[Math.floor(.1*(m.length-1))],sorted[Math.floor(.9*(m.length-1))]]};
}
function capture(feed,injuries,rosters,context,now=Date.now(),draws=10000,integrated=false){
 const forecasts=[],finals={},failures=[];
 for(const g of feed.games||[]){
  if(g.status==='STATUS_FINAL'){
   const a=gameEngine.gamePoints(g);
   if(a&&Number.isFinite(a.homePoints)&&Number.isFinite(a.awayPoints))finals[String(g.id)]={home:g.home,away:g.away,home_points:a.homePoints,away_points:a.awayPoints,start:g.date};
   continue;
  }
  const tip=Date.parse(g.date);
  if(g.status!=='STATUS_SCHEDULED'||!Number.isFinite(tip)||tip<=now||tip>now+48*3600000)continue;
  try{
   const hist=engine.records(feed,now-86400000),rating=strength.fit(hist);
   if(!Number.isFinite(rating.rating[g.home])||!Number.isFinite(rating.rating[g.away]))throw Error('Missing opponent-adjusted team rating');
   const model=engine.build(g,feed,injuries,rosters,now,{context});
   const r=engine.draws(model,draws,6472026),raw=r.home.map((h,i)=>h-r.away[i]),center=mean(raw);
   const target=rating.rating[g.home]-rating.rating[g.away]+(String(g.neutralSite)==='true'?0:rating.home);
   let candidate=raw.map(x=>x+target-center);
   if(integrated){const anchor=require('../nba_spread_strength.js').anchor(g,feed,engine,model,engine.draws(model,1000,6472026),now);const adjusted=engine.draws(anchor.model,draws,6472026);candidate=adjusted.home.map((h,i)=>h-adjusted.away[i]);}
   const captured=Date.now();
   if(captured>=tip)throw Error('Tipoff crossed during calculation');
   forecasts.push({sport:'NBA',game_id:String(g.id),version:integrated?'nba-possession-strength-events-v1':VERSION,home:g.home,away:g.away,start:g.date,captured_at:new Date(captured).toISOString(),source_at:feed.generated_at,draws,baseline:distribution(raw),candidate:distribution(candidate)});
  }catch(e){failures.push({game_id:String(g.id),reason:e.message})}
 }
 return {forecasts,finals,failures};
}
if(require.main===module){
 const read=p=>JSON.parse(fs.readFileSync('data/'+p,'utf8'));
 console.log(JSON.stringify(capture(read('nba_games.json'),read('nba_injuries.json'),read('nba_rosters.json'),read('nba_game_context.json'),Date.now(),10000,true)));
}
module.exports={capture,distribution};
