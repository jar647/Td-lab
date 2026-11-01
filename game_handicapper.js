/* Evidence-led NFL handicap: sporting prediction, supplied price and unresolved news. */
(function(root,factory){
 'use strict';const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 root.CookHandicapper=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const finite=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
 const clean=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
 const statusClass=x=>{
  const value=clean(x);
  if(['out','ir','injuredreserve','pup','suspended','inactive'].includes(value))return 'unavailable';
  if(['questionable','daytoday'].includes(value))return 'questionable';
  if(value==='doubtful')return 'doubtful';
  if(['active','healthy','available'].includes(value))return 'available';
  return null;
 };
 const date=x=>{const t=Date.parse(String(x||''));return Number.isFinite(t)?t:null;};
 const conditional=m=>m&&m.win+m.loss>0?m.win/(m.win+m.loss):null;
 const payout=price=>price>0?price/100:100/-price;
 const american=(win,loss)=>{
  if(win<=0||loss<=0)return null;
  return Math.round(win<=loss?100*loss/win:-100*win/loss);
 };

 function sensitivity(model,result,homeChange,awayChange){
  const sums=Object.fromEntries(result.markets.map(m=>[m.key,{win:0,loss:0,push:0}]));
  for(const err of model.residuals){
   const h=Math.max(0,Math.round(model.projectedHome+homeChange+err.homeError));
   const a=Math.max(0,Math.round(model.projectedAway+awayChange+err.awayError));
   const margin=h-a,total=h+a;
   const values={homeML:margin,awayML:-margin,homeATS:margin+result.market.homeSpread,
    awayATS:-margin-result.market.homeSpread,over:total-result.market.total,under:result.market.total-total};
   for(const [key,count] of Object.entries(sums))count[values[key]>0?'win':values[key]<0?'loss':'push']++;
  }
  return Object.fromEntries(result.markets.map(m=>{
   const count=sums[m.key],n=model.residuals.length,win=count.win/n,loss=count.loss/n,push=count.push/n;
   return [m.key,{win,loss,push,ev:m.price===null?null:win*payout(m.price)-loss}];
  }));
 }

 function build(model,result,{audit=null,now=Date.now()}={}){
  if(model?.sport!=='NFL'||result?.sport!=='NFL')throw Error('The evidence handicap currently supports NFL games');
  if(!model.residuals?.length||!Array.isArray(result.markets))throw Error('Run the game projection before building its handicap');
  const ctx=model.pregameContext||{},facts=ctx.teams||{},risks=[],findings=[],questions=[],coverage=[];
  const addRisk=(code,text,severity='review')=>{if(!risks.some(x=>x.code===code))risks.push({code,text,severity});};
  const generated=date(model.forecastMeta?.generatedAt||ctx.research?.retrieved_at),kickoff=date(model.forecastMeta?.kickoffAt||ctx.kickoff_at);
  if(generated===null)addRisk('forecast-time','The forecast update time is unverified.','block');
  else if(generated>now+300000||now-generated>6*3600000)addRisk('forecast-stale','The forecast is stale or future-dated; refresh team and injury data.','block');
  if(kickoff===null)addRisk('kickoff-time','Kickoff time is unverified; pregame status cannot be confirmed.','block');
  else if(kickoff<=now)addRisk('game-started','Kickoff has passed. This pregame model does not evaluate in-game odds.','block');
  const researchSeason=ctx.research?.season,throughWeek=ctx.research?.through_week;
  if(researchSeason==null||throughWeek==null)addRisk('research-scope','The historical research season/week is unverified.');
  coverage.push({name:'Scoring and efficiency',status:model.matchupAnalysis?'available':'partial',detail:'Earlier scoring and explicit EPA/success/pass-mix adjustments inform the forecast.'});
  const score=model.scoreInputs||{};
  const attribution={baselineHome:finite(score.baselineHome),baselineAway:finite(score.baselineAway),
   homeMatchupChange:finite(score.homeAdjustment),awayMatchupChange:finite(score.awayAdjustment),
   projectedHome:model.projectedHome,projectedAway:model.projectedAway};
  const baselineMargin=finite(score.baselineHome)!==null&&finite(score.baselineAway)!==null?score.baselineHome-score.baselineAway:null;
  const baselineTotal=finite(score.baselineHome)!==null&&finite(score.baselineAway)!==null?score.baselineHome+score.baselineAway:null;
  const efficiencyMargin=finite(score.homeAdjustment)!==null&&finite(score.awayAdjustment)!==null?score.homeAdjustment-score.awayAdjustment:null;
  const efficiencyTotal=finite(score.homeAdjustment)!==null&&finite(score.awayAdjustment)!==null?score.homeAdjustment+score.awayAdjustment:null;
  for(const [team,other,side] of [[model.home,model.away,'home_offense_vs_away_defense'],[model.away,model.home,'away_offense_vs_home_defense']]){
   const f=facts[team]||{},match=model.matchupAnalysis?.[side],injuries=f.injuries||{},news=f.injury_news||{};
   if(match?.available)findings.push({topic:'Matchup',team,modelEffect:'included',
    text:`${team} offense vs ${other}: pass EPA ${format(match.pass_epa_offense)} against ${format(match.pass_epa_defense_allowed)} allowed; rush EPA ${format(match.rush_epa_offense)} against ${format(match.rush_epa_defense_allowed)} allowed. League-centered scoring adjustment ${signed(match.score_adjustment)} points.`});
   const scoring=f.scoring;
   if(scoring?.season?.games)findings.push({topic:'Form and venue',team,modelEffect:'scoring and venue splits included; recent scoring descriptive',
    text:`${team}: season scoring ${format(scoring.season.points_per_game)} for / ${format(scoring.season.points_allowed_per_game)} allowed; last three ${format(scoring.last_three?.points_per_game)} for / ${format(scoring.last_three?.points_allowed_per_game)} allowed. Home sample ${scoring.home?.games||0}, road sample ${scoring.road?.games||0}.`});
   const adjusted=f.deep_stats?.opponent_adjusted;
   if(adjusted?.offense?.available)findings.push({topic:'Schedule strength',team,modelEffect:'descriptive',
    text:`${team} offensive EPA on covered plays: raw ${format(adjusted.offense.raw_epa,3)}, schedule-adjusted ${format(adjusted.offense.adjusted_epa,3)} (${adjusted.offense.covered_plays} plays). Opponents are measured on their other earlier games.`});
   const tendencies=f.deep_stats?.offense?.season;
   if(tendencies)findings.push({topic:'Coaching tendencies',team,modelEffect:'pass mix included; situational rates descriptive',
    text:`${f.coach||team+' coach'}: neutral early-down pass rate ${percent(tendencies.neutral_early_down_pass_rate)}, fourth-down go rate ${percent(tendencies.fourth_down_go_rate)} across ${tendencies.samples?.fourth_down_decisions||0} decisions, red-zone touchdown rate ${percent(tendencies.redzone_td_drive_rate)} across ${tendencies.samples?.redzone_drives||0} known drives. Game situation and personnel affect these rates.`});
   const newsFresh=news.current===true&&date(news.source_updated_at)!==null&&now-date(news.source_updated_at)>=-300000&&now-date(news.source_updated_at)<=12*3600000;
   const reports=[...(injuries.reports||[]).map(r=>({...r,source:'nflverse'})),...(newsFresh?news.reports||[]:[]).map(r=>({...r,source:'ESPN'}))];
   const officialFresh=(injuries.reports||[]).some(r=>date(r.source_updated_at)!==null&&date(r.source_updated_at)<=now&&now-date(r.source_updated_at)<7*86400000);
   coverage.push({name:team+' injuries',status:officialFresh&&newsFresh?'available':officialFresh||newsFresh?'partial':'missing',
    detail:newsFresh?'Timestamped secondary updates available; official inactives remain separate.':'No fresh secondary update is available.'});
   if(!officialFresh&&!newsFresh)addRisk('injuries-'+team,team+' current injury coverage is missing or stale.','block');
   const names=new Map();
   for(const r of reports){
    const key=clean(r.player);if(!key)continue;
    const prior=names.get(key);
    const priorStatus=statusClass(prior?.designation),currentStatus=statusClass(r.designation);
    if(prior&&prior.source!==r.source&&priorStatus&&currentStatus&&priorStatus!==currentStatus)
     addRisk('conflict-'+team+'-'+key,`${team} ${r.player}: sources disagree (${prior.designation||'unknown'} / ${r.designation||'unknown'}); verify current status.`,'block');
    if(!prior||date(prior.source_updated_at)===null||(date(r.source_updated_at)!==null&&date(r.source_updated_at)>=date(prior.source_updated_at)))names.set(key,r);
   }
   const qb=f.usage?.quarterback;
   const qbReport=qb&&[...names.values()].find(r=>clean(r.player)===clean(qb.name)&&['unavailable','questionable','doubtful'].includes(statusClass(r.designation)));
   if(qbReport)addRisk('qb-'+team,`${team} historical high-usage QB ${qb.name} is listed ${qbReport.designation}. The forecast has no estimated replacement-QB point adjustment.`,'block');
   questions.push({team,question:qb?`Confirm ${qb.name} or the actual starting QB; historical usage is not starter confirmation.`:'Confirm the starting QB; individual historical QB usage is unavailable.',resolved:false});
   for(const r of [...names.values()].filter(r=>['unavailable','questionable','doubtful'].includes(statusClass(r.designation))))
    questions.push({team,player:r.player,position:r.position||null,status:r.designation,
     question:`${team} ${r.player} (${r.position||'position unverified'}): ${r.designation}. ${r.summary||'Check official availability and replacement role.'}`,
     source:r.source,sourceUpdatedAt:r.source_updated_at||null,sourceUrl:r.source_url||injuries.source||null,
     impactEstimated:false,resolved:injuries.official_inactives_confirmed===true});
   if(kickoff!==null&&kickoff-now<=90*60000&&kickoff>now&&injuries.official_inactives_confirmed!==true)
    addRisk('inactives-'+team,team+' official inactives are unconfirmed inside 90 minutes of kickoff.','block');
   if(!f.coach)addRisk('coach-'+team,team+' current head coach is unverified.');
  }
  const teams=[facts[model.home]||{},facts[model.away]||{}];
  coverage.push({name:'Home/road and recent results',status:teams.every(f=>f.scoring?.season?.games)?'available':'partial',detail:'Actual results and sample sizes are shown separately from shrunk scoring inputs.'});
  coverage.push({name:'Coaching and situational play',status:teams.every(f=>f.coach&&f.deep_stats?.offense?.season)?'available':'partial',detail:'Current team tendencies inform the breakdown; career wins are not assigned points.'});
  const weather=ctx.weather||{},indoor=['closed','dome'].includes(String(ctx.venue?.roof||'').toLowerCase());
  const weatherFresh=weather.available&&date(weather.updated_at)!==null&&now-date(weather.updated_at)>=-300000&&now-date(weather.updated_at)<=12*3600000;
  coverage.push({name:'Weather and venue',status:indoor||weatherFresh?'available':'partial',detail:indoor?'Indoor roof; outside weather is excluded.':weatherFresh?'Timestamped kickoff-hour forecast available.':weather.reason||'Kickoff weather forecast is missing or stale.'});
  coverage.push({name:'Rest and travel',status:finite(ctx.rest_days?.home)!==null&&finite(ctx.rest_days?.away)!==null?'available':'partial',detail:'Rest/travel can condition historical score errors; flight distance is an estimate.'});
  coverage.push({name:'Replacement-player effects',status:'missing',detail:'No validated injury, projected lineup or replacement-QB point model is connected.'});
  addRisk('replacement-effects','Injury and replacement-player effects have not been fitted. Relevant availability changes may invalidate the baseline.');
  const matchedAudit=audit?.model_version===model.forecastMeta?.modelVersion&&audit?.status==='EXACT_ENGINE_WALK_FORWARD_UNCALIBRATED'?audit:null;
  const base=sensitivity(model,result,0,0);
  const stress={homeMarginDown3:sensitivity(model,result,-1.5,1.5),homeMarginUp3:sensitivity(model,result,1.5,-1.5),
   totalDown3:sensitivity(model,result,-1.5,-1.5),totalUp3:sensitivity(model,result,1.5,1.5)};
  const markets=[['ml','Winner','homeML','awayML'],['ats','Against the spread','homeATS','awayATS'],['total','Total','over','under']].map(([key,title,a,b])=>{
   const rows=result.markets.filter(m=>m.key===a||m.key===b);
   if(rows.length!==2)return {key,title,status:'LINE NEEDED',lean:null,explanation:'Enter this market line to evaluate it.'};
   const ordered=[...rows].sort((x,y)=>y.win-x.win),lean=ordered[0],p=conditional(lean);
   const prices=rows.filter(m=>m.price!==null),valueSide=[...prices].sort((x,y)=>y.ev-x.ev)[0]||null;
   const benchmark=matchedAudit?.holdout?.markets?.[a]?.marketComparison||null;
   const benchmarkBeaten=benchmark?.games>=100&&finite(benchmark.modelBrier)!==null&&finite(benchmark.noVigMarketBrier)!==null&&benchmark.modelBrier<benchmark.noVigMarketBrier;
   const blockers=risks.some(r=>r.severity==='block');
   const potential=valueSide&&valueSide.ev>=.05&&valueSide.modelEdge>=.025;
   const status=!prices.length?'ODDS NEEDED':blockers?'PASS · DATA NEEDS REVIEW':!benchmarkBeaten?'PASS · BENCHMARK NOT BEATEN':
    potential&&valueSide.eligible?'RESEARCH LEAN · UNCALIBRATED':'PASS · NO VERIFIED VALUE';
   const scenarioKeys=key==='total'?['totalDown3','totalUp3']:['homeMarginDown3','homeMarginUp3'];
   return {key,title,status,lean:Math.abs(lean.win-ordered[1].win)<.00001?'No directional preference':lean.label,
    leanKey:lean.key,win:lean.win,push:lean.push,settledProbability:p,smallLean:p!==null&&p<.55,
    fairPrice:american(lean.win,lean.loss),quotedPrice:lean.price,
    bestPricedSide:valueSide?.label||null,bestQuotedEV:valueSide?.ev??null,
    priceAssessment:!valueSide?'Enter both sides of your sportsbook price for a full comparison.':potential?'A model price discrepancy exists, but validation and news still control the decision.':'The supplied prices do not clear the research discrepancy threshold.',
    benchmark:benchmark||null,
    sensitivity:{method:'Exact enumeration of equally weighted paired residuals; point shifts are hypothetical, not estimated injury effects.',
     unchanged:base[lean.key],tests:scenarioKeys.map(k=>({scenario:k,...stress[k][lean.key]}))},
    explanation:key==='ml'?`Scoring and venue give a home margin of ${signed(baselineMargin)}; the explicit efficiency matchup changes that margin by ${signed(efficiencyMargin)}, producing a mean home margin of ${signed(result.projection.margin)}. Most likely winner and best-priced side can differ.`:
     key==='ats'?`The mean home margin is ${signed(result.projection.margin)} against your handicap ${signed(result.market.homeSpread)}. The home handicap needed to balance the simulated margin is approximately ${signed(-result.simulated.margin.median)}.`:
     `The scoring/venue baseline totals ${format(baselineTotal)} points; efficiency adds ${signed(efficiencyTotal)}. The simulated median total is ${format(result.simulated.total.median)} against your total ${format(result.market.total)}.`};
  });
  coverage.push({name:'Your sportsbook prices',status:result.markets.every(m=>m.price!==null)?'available':result.markets.some(m=>m.price!==null)?'partial':'missing',detail:'Only your entered lines and prices are evaluated.'});
  const complete=coverage.filter(x=>x.status==='available').length;
  const spread=finite(result.market.homeSpread),total=finite(result.market.total);
  const impliedHome=spread!==null&&total!==null?(total-spread)/2:null;
  const impliedAway=spread!==null&&total!==null?(total+spread)/2:null;
  return {status:'PROVISIONAL_RESEARCH_HANDICAP',home:model.home,away:model.away,
   headline:`${model.away} ${format(result.projection.away)} — ${model.home} ${format(result.projection.home)}`,
   fairHomeSpread:-result.simulated.margin.median,fairTotal:result.simulated.total.median,
   marketBaseline:{homeSpread:spread,total,
    impliedHomePoints:impliedHome!==null&&impliedHome>=0&&impliedAway>=0?impliedHome:null,
    impliedAwayPoints:impliedAway!==null&&impliedHome>=0&&impliedAway>=0?impliedAway:null,
    homeNoVigWin:result.markets.find(m=>m.key==='homeML')?.noVig??null,
    marginDifference:spread===null?null:result.projection.margin+spread,
    totalDifference:total===null?null:result.projection.total-total},
   markets,attribution,findings,questions,risks,coverage,coverageCount:{available:complete,total:coverage.length},
   sourceScope:{season:researchSeason??null,throughWeek:throughWeek??null,generatedAt:generated===null?null:new Date(generated).toISOString(),kickoffAt:kickoff===null?null:new Date(kickoff).toISOString()},
   note:'Directional predictions are uncalibrated estimates. Evidence coverage measures available research, not the chance a pick wins. Missing replacement effects are not silently assigned points.'};
 }
 const format=(x,n=2)=>finite(x)===null?'unavailable':x.toFixed(n);
 const signed=x=>finite(x)===null?'unavailable':(x>=0?'+':'')+x.toFixed(1);
 const percent=x=>finite(x)===null?'unavailable':(x*100).toFixed(1)+'%';
 return {build,sensitivity};
});
