/* Transparent NBA pregame shortlist. This is NOT a calibrated value-betting
 * engine; only user-entered quotes and previously independent scores are used.
 * No model probability is upgraded to "verified edge" by this display. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.CookNBABetResearch=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const round=x=>Math.round(x*10)/10;
const pct=x=>(100*x).toFixed(1)+'%';
const age=(now,x)=>{const t=Date.parse(x);return Number.isFinite(t)?now-t:Infinity;};
const maxOdds=-200;
const minSpread=2.5,minTotal=4,minML=0.08;
const hours=3600000;
function score(home,away,baseline,w){
 return {home:round((1-w)*home+w*baseline.home),away:round((1-w)*away+w*baseline.away)};
}
function pregameHealth(result,model,now=Date.now()){
 const tip=Date.parse(model?.date),m=model?.possessionModel,t=m?.inputTimes||{};
 if(model?.sport!=='NBA'||!m||!result?.possession||model.rotationFallback)return {ok:false,why:'A supported NBA possession-model run is required.'};
 if(!Number.isFinite(tip)||tip<=now)return {ok:false,why:'The game has started; no pregame shortlist.'};
 if(![result.simulated?.home,result.simulated?.away,model.baseline?.home,model.baseline?.away].every(finite))return {ok:false,why:'Independent possession and historical score estimates are missing.'};
 if(!result.audit?.passed)return {ok:false,why:'Simulation integrity has not passed.'};
 if(!Number.isFinite(Date.parse(t.games))||age(now,t.games)>12*hours||age(now,t.games)<-300000||
    !Number.isFinite(Date.parse(t.injuries))||age(now,t.injuries)>12*hours||age(now,t.injuries)<-300000||
    !Number.isFinite(Date.parse(t.rosters))||age(now,t.rosters)>72*hours||age(now,t.rosters)<-300000)
   return {ok:false,why:'Game, injury, or roster snapshots are stale or unverified.'};
 if(tip-now<=90*60000&&age(now,t.injuries)>15*60000)
   return {ok:false,why:'Inside 90 minutes of tipoff, injuries must be checked within 15 minutes.'};
 const uncertain=Array.isArray(m.uncertain)?m.uncertain:[];
 if(uncertain.length)return {ok:false,why:'Unconfirmed player availability: '+uncertain.slice(0,3).map(x=>String(x)).join(', ')+'. Recheck after injury announcements.'};
 return {ok:true,why:'Pregame game/roster/injury snapshots meet freshness checks. Starting lineups and actual book availability still require confirmation.'};
}
const oddsOk=x=>finite(x)&&x>=maxOdds&&x!==0;
const implied=x=>x>0?100/(100+x):-x/(-x+100);
function analyze(result,model,now=Date.now()){
 const health=pregameHealth(result,model,now);
 if(!health.ok)return {status:'HOLD',reason:health.why,candidates:[],modelStatus:'UNVALIDATED'};
 const market=result.market||{},quotes=Object.fromEntries((result.markets||[]).map(x=>[x.key,x]));
 const base=model.baseline,blend50=score(result.simulated.home,result.simulated.away,base,.5),blend75=score(result.simulated.home,result.simulated.away,base,.75),candidates=[];
 const fmtOdds=x=>(x>0?'+':'')+x;
 function add(key,label,price,gap50,gap75,threshold,note,kind){
  if(!oddsOk(price))return;
  if(!finite(gap50)||!finite(gap75)||gap50<threshold||gap75<threshold)return;
  const agreement=round(Math.min(gap50,gap75));
  candidates.push({key,label,price,priceDisplay:fmtOdds(price),kind,agreement,
   gap50:round(gap50),gap75:round(gap75),note,priority:round(agreement/threshold),
   status:'RESEARCH CANDIDATE · NOT VERIFIED'});
 }
 if(finite(market.homeSpread)){
  const hLine=-market.homeSpread,m50=blend50.home-blend50.away,m75=blend75.home-blend75.away;
  add('homeATS',model.home+' '+(market.homeSpread>0?'+':'')+market.homeSpread,quotes.homeATS?.price,m50-hLine,m75-hLine,minSpread,
   'Both blended margins favor the home side beyond the entered spread. This is a model disagreement with the line, not a proven edge.','spread');
  add('awayATS',model.away+' '+(-market.homeSpread>0?'+':'')+(-market.homeSpread),quotes.awayATS?.price,hLine-m50,hLine-m75,minSpread,
   'Both blended margins favor the away side beyond the entered spread. This is a model disagreement with the line, not a proven edge.','spread');
 }
 if(finite(market.total)){
  const t50=blend50.home+blend50.away,t75=blend75.home+blend75.away;
  // User wants positive player/game scoring positions, not model-generated unders.
  add('over','Over '+market.total,quotes.over?.price,t50-market.total,t75-market.total,minTotal,
   'Both projected combined scores exceed the entered total. Overs remain vulnerable to injury, pace and shooting variance.','total');
 }
 const homeWin=result.simulated.homeWin,awayWin=result.simulated.awayWin;
 if(finite(homeWin)&&finite(awayWin)){
  const homeML=quotes.homeML?.price,awayML=quotes.awayML?.price;
  const pair=oddsOk(homeML)&&oddsOk(awayML);
  if(pair){
   const noVigHome=implied(homeML)/(implied(homeML)+implied(awayML));
   const noVigAway=1-noVigHome;
   if(blend50.home-blend50.away>=3&&blend75.home-blend75.away>=3)
    add('homeML',model.home+' moneyline',homeML,homeWin-noVigHome,homeWin-noVigHome,minML,
     'Both score blends favor the home team; simulated win chance is higher than the no-vig estimate. The simulated probability is not calibrated.','moneyline');
   if(blend50.away-blend50.home>=3&&blend75.away-blend75.home>=3)
    add('awayML',model.away+' moneyline',awayML,awayWin-noVigAway,awayWin-noVigAway,minML,
     'Both score blends favor the away team; simulated win chance is higher than the no-vig estimate. The simulated probability is not calibrated.','moneyline');
  }
 }
 candidates.sort((a,b)=>b.priority-a.priority||b.agreement-a.agreement);
 return {status:candidates.length?'SHORTLIST':'PASS',reason:candidates.length?health.why:'No priced over, spread or moneyline cleared the two-blend agreement thresholds. Do not manufacture a pick.',candidates:candidates.slice(0,3),
  blend50,blend75,modelStatus:'UNVALIDATED',method:'Compare 50/50 and 75/25 baseline/possession projections to manually entered market lines. Spread gap >=2.5 points, Over gap >=4 points, or moneyline probability gap >=8 percentage points against both quoted no-vig prices. No unders; odds worse than -200 excluded. No claim of positive expected value.'};
}
function html(report){
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 if(report.status==='HOLD')return '<section class="panel"><h3>NBA bet research shortlist</h3><p class="warn">HOLD · '+esc(report.reason)+'</p><p class="muted">No player-availability assumptions are substituted for confirmed information.</p></section>';
 const rows=report.candidates.map((x,i)=>'<div class="breakdown"><strong>'+esc((i+1)+'. '+x.label+' · '+x.priceDisplay)+'</strong><p>Model consensus: 50/50 gap '+esc(x.gap50)+'; 75/25 gap '+esc(x.gap75)+(x.kind==='moneyline'?' probability points':' points')+'. '+esc(x.note)+'</p><p class="muted">'+esc(x.status)+'</p></div>').join('');
 return '<section class="panel"><h3>NBA bet research shortlist · '+esc(report.status)+'</h3>'+ (rows||'<p class="warn">PASS · No qualifying price-backed consensus.</p>')+'<p class="muted">'+esc(report.reason)+'</p><p class="muted">These are screening candidates, NOT verified profitable bets or automatic approvals. Price and lineup must be rechecked at the sportsbook. No source is connected to Hard Rock Bet. The original game simulation remains unchanged.</p></section>';
}
return {analyze,pregameHealth,html};
});
