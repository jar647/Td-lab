/* CoOk It Up: game-only NFL/NBA score bootstrap.
 * 100,000 reproducible draws from historical PAIRED score residuals.
 * Sportsbook prices are only evaluated after score generation.
 * Research estimates are UNCALIBRATED and never automatically authorize a bet.
 */
(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 root.CookGameOdds=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const finite=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
 const clamp=(v,low,high)=>Math.max(low,Math.min(high,v));
 const mean=vals=>vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:0;
 const round=v=>Math.round(v*10)/10;
 const dateTime=v=>{const t=Date.parse(String(v||''));return Number.isFinite(t)?t:null};
 const rng=seed=>{let a=seed>>>0;return ()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;}};
 const percent=(x,n)=>n?x/n:null;
 function quote(v){
  if(v===undefined||v===null||String(v).trim()==='')return null;
  const s=String(v).trim();
  if(!/^[+-]?\d+$/.test(s))return null;
  const n=Number(s);
  if(!Number.isSafeInteger(n)||Math.abs(n)<100||Math.abs(n)>100000)return null;
  const decimal=n>0?1+n/100:1+100/(-n);
  return {american:n,decimal,implied:1/decimal};
 }
 function pairedResiduals(raw){
  const rows=raw.filter(r=>Number.isFinite(r.homeError)&&Number.isFinite(r.awayError));
  if(!rows.length)throw Error('No valid historical paired score errors');
  const homeMean=mean(rows.map(r=>r.homeError)),awayMean=mean(rows.map(r=>r.awayError));
  return rows.map(r=>({homeError:r.homeError-homeMean,awayError:r.awayError-awayMean}));
 }
 function contextualResiduals(records,target){
  const keys=['home_rest','away_rest','travel_miles'];
  if(!target)return {records,used:false,weatherUsed:false,reason:'Pregame context is missing; using all earlier score residuals.'};
  const restReady=keys.every(k=>Number.isFinite(finite(target[k])));
  const restMatches=restReady?records.filter(r=>keys.every(k=>Number.isFinite(finite(r[k])))&&
   Math.abs(Number(r.home_rest)-Number(target.home_rest))<=2&&
   Math.abs(Number(r.away_rest)-Number(target.away_rest))<=2&&
   Math.abs(Number(r.travel_miles)-Number(target.travel_miles))<=750):[];
  const weatherReady=String(target.roof||'').length>0&&
   (Number.isFinite(finite(target.temperature_f))||Number.isFinite(finite(target.wind_mph)));
  const weatherMatches=weatherReady?records.filter(r=>{
   if(String(r.roof||'').toLowerCase()!==String(target.roof).toLowerCase())return false;
   if(Number.isFinite(finite(target.temperature_f))&&(!Number.isFinite(finite(r.temperature_f))||Math.abs(Number(r.temperature_f)-Number(target.temperature_f))>20))return false;
   if(Number.isFinite(finite(target.wind_mph))&&(!Number.isFinite(finite(r.wind_mph))||Math.abs(Number(r.wind_mph)-Number(target.wind_mph))>8))return false;
   return true;
  }):[];
  const combined=restReady&&weatherReady?weatherMatches.filter(r=>restMatches.includes(r)):[];
  if(combined.length>=30)return {records:combined,used:true,weatherUsed:true,
   reason:'Residuals matched on roof/weather (within 20°F and 8 mph) plus rest/travel context; '+combined.length+' comparable games.'};
  if(weatherMatches.length>=40)return {records:weatherMatches,used:true,weatherUsed:true,
   reason:'Residuals matched on roof/weather (within 20°F and 8 mph); rest/travel match was too sparse.'};
  if(restMatches.length>=40)return {records:restMatches,used:true,weatherUsed:false,
   reason:'Residuals matched on rest/travel; weather-matched history was too sparse.'};
  return {records,used:false,weatherUsed:false,
   reason:'Fewer than 30 weather-plus-context or 40 single-context games matched; using all earlier score residuals.'};
 }
 function nflGame(game,backtest,meta={}){
  if(!game||!game.home||!game.away)throw Error('Selected NFL matchup is unavailable');
  const home=finite(game.projected_home_points),away=finite(game.projected_away_points);
  const hGames=finite(game.model_inputs?.home?.games),aGames=finite(game.model_inputs?.away?.games);
  if(home===null||away===null||home<0||away<0)throw Error('NFL projection unavailable');
  if(hGames===null||aGames===null||hGames<2||aGames<2)throw Error('Insufficient earlier NFL team games');
  const season=Number(meta.season)||Number(String(game.game_id||'').split('_')[0])||2026;
  const week=Number(meta.week)||Number(String(game.game_id||'').split('_')[1])||0;
  const baselineResiduals=game.model_inputs?.trust?.projection_basis==='SCORING_BASELINE';
  const historyHome=baselineResiduals?'baseline_home':'projected_home',historyAway=baselineResiduals?'baseline_away':'projected_away';
  const records=(backtest?.records||[]).filter(x=>{
   const yr=Number(x.season),wk=Number(x.week);
   return (yr<season||(yr===season&&wk<week))&&Number.isFinite(finite(x.actual_home))&&Number.isFinite(finite(x.actual_away))
    &&Number.isFinite(finite(x[historyHome]))&&Number.isFinite(finite(x[historyAway]));
  }).map(x=>({homeError:Number(x.actual_home)-Number(x[historyHome]),awayError:Number(x.actual_away)-Number(x[historyAway]),
   home_rest:finite(x.home_rest),away_rest:finite(x.away_rest),travel_miles:finite(x.travel_miles),
   roof:x.roof,temperature_f:finite(x.temperature_f),wind_mph:finite(x.wind_mph)}));
  if(records.length<40)throw Error('Insufficient earlier NFL score residuals');
  const conditional=contextualResiduals(records,game.model_inputs?.residual_context);
  const simulationRecords=conditional.records;
  return {sport:'NFL',id:String(game.game_id||game.away+'-'+game.home),date:String(game.gameday||''),home:String(game.home),away:String(game.away),
   projectedHome:home,projectedAway:away,residuals:pairedResiduals(simulationRecords),sample:{homeGames:hGames,awayGames:aGames,residualGames:simulationRecords.length,
    residualContextUsed:conditional.used,residualWeatherUsed:conditional.weatherUsed,residualContextReason:conditional.reason},
   trust:game.model_inputs?.trust||null,feedGeneratedAt:meta.generatedAt||null,
   scoreCandidate:game.model_inputs?.score_candidate||null,
   residualBasis:baselineResiduals?'SCORING_BASELINE':'MATCHUP_ADJUSTED',
   matchupAnalysis:game.model_inputs?.matchup||null,
   pregameContext:game.model_inputs?.research_context||null,
   method:(baselineResiduals?'Historical scoring baseline. Experimental EPA point corrections disabled; residuals use the same baseline':game.model_version==='score-baseline-pbp-v2'?'Pregame scoring baseline with shrunk home/road scoring splits and season/recent EPA-success offense-vs-defense adjustment':'Pregame score baseline')+', plus '+conditional.reason+' Paired historical score residual simulation.',
   homeOffense:finite(game.model_inputs?.home?.offense),awayOffense:finite(game.model_inputs?.away?.offense),
   homeAllowed:finite(game.model_inputs?.home?.defense_allowed),awayAllowed:finite(game.model_inputs?.away?.defense_allowed),
   warning:'Experimental NFL score model. Historical team performance includes prior player/coaching effects; only confirmed current game information should alter projections. Weather conditions residual sampling only when enough matched history exists. Injury/lineup effects are not assigned a guessed point value. Probabilities are uncalibrated.'};
 }
 function gamePoints(game){
  if(!game||game.status!=='STATUS_FINAL'||Number(game.season_type)!==2)return null;
  const value=team=>{
   const players=(game.players||[]).filter(p=>p.team===team&&!p.didNotPlay&&p.stats&&Number.isFinite(finite(p.stats.PTS)));
   const points=players.reduce((sum,p)=>sum+Number(p.stats.PTS),0);
   return players.length>=7&&points>=75&&points<=170?points:null;
  };
  const h=value(game.home),a=value(game.away);
  return h===null||a===null?null:{home:String(game.home),away:String(game.away),homePoints:h,awayPoints:a,date:String(game.date||''),time:dateTime(game.date)};
 }
 function nbaGame(game,all,context=null){
  if(!game||!game.home||!game.away)throw Error('Selected NBA matchup is unavailable');
  const tip=dateTime(game.date);
  if(tip===null)throw Error('NBA tipoff time is missing');
  const hist=(all?.games||[]).filter(g=>dateTime(g.date)!==null&&dateTime(g.date)<tip).map(gamePoints).filter(Boolean).sort((a,b)=>b.time-a.time);
  if(hist.length<8)throw Error('Insufficient earlier completed NBA regular-season games');
  const teamGames=team=>hist.filter(x=>x.home===team||x.away===team).slice(0,12).map(x=>({
   forPoints:x.home===team?x.homePoints:x.awayPoints,
   againstPoints:x.home===team?x.awayPoints:x.homePoints
  }));
  const homeRecent=teamGames(game.home),awayRecent=teamGames(game.away);
  // Limited team history falls back to the observed league scoring prior and remains PASS-only.
  const leagueHome=mean(hist.map(x=>x.homePoints)),leagueAway=mean(hist.map(x=>x.awayPoints));
  const homeOff=mean(homeRecent.map(x=>x.forPoints)),awayOff=mean(awayRecent.map(x=>x.forPoints));
  const homeAllowed=mean(homeRecent.map(x=>x.againstPoints)),awayAllowed=mean(awayRecent.map(x=>x.againstPoints));
  const strength=clamp(Math.min(homeRecent.length,awayRecent.length)/12,0,.7);
  const projectedHome=round(leagueHome*(1-strength)+((homeOff+awayAllowed)/2)*strength);
  const projectedAway=round(leagueAway*(1-strength)+((awayOff+homeAllowed)/2)*strength);
  const residuals=pairedResiduals(hist.map(x=>({homeError:x.homePoints-leagueHome,awayError:x.awayPoints-leagueAway})));
  const baseline={sport:'NBA',id:String(game.id||game.away+'-'+game.home),date:String(game.date),home:String(game.home),away:String(game.away),
   projectedHome,projectedAway,residuals,sample:{homeGames:homeRecent.length,awayGames:awayRecent.length,residualGames:hist.length},feedGeneratedAt:all?.generated_at||null,
   method:'Prior regular-season team scoring/allowance, shrunk toward league average, plus paired historical NBA scoring residual bootstrap.',
   homeOffense:round(homeOff),awayOffense:round(awayOff),homeAllowed:round(homeAllowed),awayAllowed:round(awayAllowed),
   warning:'NBA injury/rotation status, projected minutes and confirmed starting fives are not incorporated into this game-score baseline.'};
  if(context){const engine=typeof module==='object'&&module.exports?require('./nba_possession_engine.js'):globalThis.CookNBAPossessions;if(!engine)throw Error('Possession engine unavailable');
   const possessionModel=engine.build(game,all,context.injuries,context.rosters,context.now??Date.now(),{historical:!!context.historical,context:context.gameContext});
   const unsupported=possessionModel.historical?[]:Object.entries(possessionModel.teams).map(([team,t])=>({team,availablePlayers:t.players.filter(p=>!p.pending).length,uncertainPlayers:t.players.filter(p=>p.pending).map(p=>p.name)})).filter(t=>t.availablePlayers<6);
   if(unsupported.length){const reason=unsupported.map(t=>t.team+': only '+t.availablePlayers+' supported players without uncertain availability; an all-out scenario needs at least six. Uncertain: '+t.uncertainPlayers.join(', ')).join('; ');
    if(context.allowScoreFallback!==true)throw Error('Rotation availability cannot be simulated: '+reason+' Refresh availability or explicitly choose the team-score baseline.');
    return {...baseline,rotationFallback:{reason,teams:unsupported},pregameInputTimes:{...possessionModel.inputTimes},method:'Team-score baseline · player rotation scenarios unavailable. '+baseline.method,warning:'Team-score baseline only. '+reason+' Player availability, minutes and player props are not modeled. Game percentages are uncalibrated; all markets remain PASS.'};
   }
   const pilot=engine.draws(possessionModel,1000,6472026);
   return {sport:'NBA',id:String(game.id),date:game.date,home:game.home,away:game.away,projectedHome:round(mean(pilot.home)),projectedAway:round(mean(pilot.away)),possessionModel,baseline:{home:projectedHome,away:projectedAway},sample:{homeGames:possessionModel.teams[game.home].games,awayGames:possessionModel.teams[game.away].games,residualGames:hist.length},method:'Injury-adjusted rotations and shared box-score-estimated possessions; two/three-point shooting, free throws, turnovers, offensive rebounds, assists, rest and home/road context. '+engine.VERSION,warning:possessionModel.limits,atsBacktestVerified:false};
  }
  return baseline;
 }
 function marketInput(raw={}){
  const spread=finite(raw.homeSpread),total=finite(raw.total);
  const supplied=v=>v!==null&&v!==undefined&&String(v).trim()!=='';
  const validSpread=!supplied(raw.homeSpread)||(spread!==null&&Math.abs(spread)<=60);
  const validTotal=!supplied(raw.total)||(total!==null&&total>0&&total<=400);
  if(!validSpread)throw Error('Enter a valid home-team spread from -60 to +60');
  if(!validTotal)throw Error('Enter a valid full-game total');
  const keys=['homeML','awayML','homeATS','awayATS','over','under'];
  const prices={};
  for(const key of keys){
   const rawOdds=raw[key],p=quote(rawOdds);
   if(supplied(rawOdds)&&!p)throw Error('Invalid American odds for '+key+'. Use -110 or +125.');
   prices[key]=p;
  }
  if(spread===null&&(prices.homeATS||prices.awayATS))throw Error('Enter the home-team spread for ATS pricing');
  if(total===null&&(prices.over||prices.under))throw Error('Enter the total points line for Over/Under pricing');
  return {homeSpread:spread,total,prices};
 }
 function quantile(sorted,p){if(!sorted.length)return null;const i=(sorted.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i);return round(sorted[lo]+(sorted[hi]-sorted[lo])*(i-lo));}
 function fairAmerican(win,lose){
  if(!win||!lose)return null;
  const decimal=(win+lose)/win;
  return Math.round(decimal>=2?100*(decimal-1):-100/(decimal-1));
 }
 function simulate(game,rawMarket={},count=100000,seed=6472026,options={}){
  if(!game||!game.possessionModel&&(!Array.isArray(game.residuals)||game.residuals.length<8))throw Error('Historical score distribution unavailable');
  if(!Number.isInteger(count)||count<1000||count>100000)throw Error('Simulation count must be between 1,000 and 100,000');
  if(game.possessionModel&&!game.possessionModel.historical){const m=game.possessionModel,now=Date.now();if(now>=Date.parse(game.date)||[['games',12],['injuries',12],['rosters',72]].some(([key,hours])=>!Number.isFinite(Date.parse(m.inputTimes[key]))||Date.parse(m.inputTimes[key])>now+300000||now-Date.parse(m.inputTimes[key])>hours*3600000))throw Error('Pregame inputs are stale or the game has started; reload the feeds');if(Date.parse(game.date)-now<=90*60000&&now-Date.parse(m.inputTimes.injuries)>15*60000)throw Error('Inside 90 minutes of tipoff, availability must be refreshed within 15 minutes');}
  if(game.rotationFallback){const now=Date.now(),tip=Date.parse(game.date),times=game.pregameInputTimes||{};if(!Number.isFinite(tip)||now>=tip||[['games',12],['injuries',12],['rosters',72]].some(([key,hours])=>!Number.isFinite(Date.parse(times[key]))||Date.parse(times[key])>now+300000||now-Date.parse(times[key])>hours*3600000))throw Error('Pregame inputs are stale or the game has started; reload the feeds');if(tip-now<=90*60000&&now-Date.parse(times.injuries)>15*60000)throw Error('Inside 90 minutes of tipoff, availability must be refreshed within 15 minutes');}
  const market=marketInput(rawMarket);
  const engine=game.possessionModel?(typeof module==='object'&&module.exports?require('./nba_possession_engine.js'):globalThis.CookNBAPossessions):null;
  // Each requested NBA run is a full shared player/team outcome. Resampling
  // a capped pool overstated simulation precision and disconnected player means.
  const detailedCount=count;
  const possession=engine?engine.draws(game.possessionModel,count,seed,{legs:game.slipLegs||[],onProgress:options.onProgress}):null;
  const random=rng(seed>>>0),residuals=game.residuals,homeScores=[],awayScores=[],margins=[],totals=[];
  const keys=['homeML','awayML','homeATS','awayATS','over','under'];
  const counts={};for(const key of keys)counts[key]={win:0,loss:0,push:0};
  let homeWin=0,awayWin=0,ties=0,homePoints=0,awayPoints=0;
  for(let i=0;i<count;i++){
   const err=possession?null:residuals[Math.floor(random()*residuals.length)];
   const sampledIndex=i;
   let h=possession?possession.home[sampledIndex]:Math.max(0,Math.round(game.projectedHome+err.homeError));
   let a=possession?possession.away[sampledIndex]:Math.max(0,Math.round(game.projectedAway+err.awayError));
   if(game.sport==='NBA'&&h===a){if(random()<.5)h++;else a++;}
   const margin=h-a,total=h+a;
   homeScores.push(h);awayScores.push(a);margins.push(margin);totals.push(total);
   homePoints+=h;awayPoints+=a;
   const ml=margin>0?1:margin<0?-1:0;
   if(ml>0)homeWin++;else if(ml<0)awayWin++;else ties++;
   const ats=market.homeSpread===null?null:Math.abs(margin+market.homeSpread)<1e-9?0:margin+market.homeSpread>0?1:-1;
   const totalsSide=market.total===null?null:total===market.total?0:total>market.total?1:-1;
   const val=(key,v)=>{if(v===0)counts[key].push++;else if(v>0)counts[key].win++;else counts[key].loss++;};
   val('homeML',ml);val('awayML',-ml);
   if(ats!==null){val('homeATS',ats);val('awayATS',-ats);}
   if(totalsSide!==null){val('over',totalsSide);val('under',-totalsSide);}
  }
  margins.sort((a,b)=>a-b);totals.sort((a,b)=>a-b);
  homeScores.sort((a,b)=>a-b);awayScores.sort((a,b)=>a-b);
  const noVig={};for(const [a,b] of [['homeML','awayML'],['homeATS','awayATS'],['over','under']]){
   const x=market.prices[a],y=market.prices[b];
   const sum=x&&y?x.implied+y.implied:0;
   if(sum){noVig[a]=x.implied/sum;noVig[b]=y.implied/sum;}
  }
  const simulationMethod=possession?`${count.toLocaleString('en-US')} complete possession and player-rotation simulations`:`${count.toLocaleString('en-US')} historical score bootstrap outcomes`;
  const markets=keys.filter(key=>(!key.endsWith('ATS')||market.homeSpread!==null)&&(!['over','under'].includes(key)||market.total!==null)).map(key=>{
   const c=counts[key],price=market.prices[key],win=c.win/count,loss=c.loss/count,push=c.push/count;
   const breakeven=price?price.implied*(1-push):null;
   const ev=price?win*(price.decimal-1)-loss:null;
   const fair=fairAmerican(win,loss);
   const modelEdge=breakeven===null?null:win-breakeven;
   const label=key==='homeML'?game.home+' moneyline':key==='awayML'?game.away+' moneyline':
    key==='homeATS'?game.home+' '+(market.homeSpread>0?'+':'')+market.homeSpread:
    key==='awayATS'?game.away+' '+(-market.homeSpread>0?'+':'')+(-market.homeSpread):
    key==='over'?'Over '+market.total:'Under '+market.total;
   const adequatelySampled=game.sample.homeGames>=5&&game.sample.awayGames>=5&&game.sample.residualGames>= (game.sport==='NFL'?100:35);
   // The current repository has no validated home-perspective ATS holdout
   // results (historical coverage is zero). Keep displaying the simulated
   // comparison, but never promote a spread side to a research lean from it.
   const atsBacktestVerified=game.atsBacktestVerified===true;
   const trustRequired=game.sport==='NFL';
   const sourceStale=trustRequired&&(!game.feedGeneratedAt||!Number.isFinite(Date.parse(game.feedGeneratedAt))||Date.now()-Date.parse(game.feedGeneratedAt)>24*3600000);
   const nbaReady=!game.rotationFallback&&(!game.possessionModel||!game.possessionModel.uncertain.length&&!game.possessionModel.warnings.length&&Date.now()-Date.parse(game.possessionModel.inputTimes.injuries)<=12*3600000);
   const sourceReady=(!trustRequired||game.trust?.source_status==='RECONCILED'&&!sourceStale)&&nbaReady;
   const lineupMismatch=trustRequired&&Object.values(game.trust?.qb_context||{}).some(x=>x.status==='RETURNING_STARTER_SAMPLE_MISMATCH');
   const calibrated=!game.rotationFallback&&(game.possessionModel?game.possessionModel.calibrationVerified===true:!trustRequired||game.trust?.calibration_status==='VERIFIED');
   const eligible=sourceReady&&!lineupMismatch&&calibrated&&adequatelySampled&&price&&price.american>=-200&&ev>=.05&&modelEdge>=.025&&
    (!key.endsWith('ATS')||atsBacktestVerified);
   const signal=game.rotationFallback?'PASS · TEAM-SCORE BASELINE ONLY':price===null?'NO ODDS ENTERED':
    game.possessionModel&&!calibrated?'PASS · CANDIDATE MODEL NOT VALIDATED':
    game.possessionModel&&!nbaReady?'PASS · ROTATION AVAILABILITY UNCERTAIN':
    key.endsWith('ATS')&&!atsBacktestVerified?'PASS · ATS NOT BACKTESTED':
    !sourceReady?'PASS · SOURCE UNVERIFIED OR STALE':
    lineupMismatch?'PASS · QB CHANGE NOT VALIDATED':
    price.american< -200?'PASS · PRICE WORSE THAN -200':
    !adequatelySampled?'PASS · LIMITED HISTORY':
    !calibrated?'PASS · MODEL NOT VALIDATED':
    eligible?'RESEARCH LEAN · UNVALIDATED':
    'PASS · NO CLEAR MODEL VALUE';
   return {key,label,win,loss,push,price:price?.american??null,implied:price?.implied??null,
    breakEven:breakeven,noVig:noVig[key]??null,modelEdge,ev,fair,signal,eligible};
  });
  // Every market must reconcile with the exact same score outcomes. Fail closed.
  const reconciles=(a,b)=>!counts[a].win&&!counts[a].loss&&!counts[a].push||
    counts[a].win===counts[b].loss&&counts[a].loss===counts[b].win&&counts[a].push===counts[b].push;
  const audit={
   draws:count,
   winLossConservation:homeWin+awayWin+ties===count,
   moneylineSymmetry:reconciles('homeML','awayML'),
   spreadSymmetry:market.homeSpread===null||reconciles('homeATS','awayATS'),
   totalSymmetry:market.total===null||reconciles('over','under'),
   finiteScores:Number.isFinite(homePoints)&&Number.isFinite(awayPoints),
   playerScoreConservation:!possession||[[game.home,homePoints/count],[game.away,awayPoints/count]].every(([team,score])=>Math.abs(possession.players.filter(p=>p.team===team).reduce((sum,p)=>sum+p.points,0)-score)<1e-7),
   playerMinuteConservation:!possession||[game.home,game.away].every(team=>Math.abs(possession.players.filter(p=>p.team===team).reduce((sum,p)=>sum+p.minutes,0)-(240+25*possession.overtimePeriods))<1e-6),
   calibrationVerified:!game.rotationFallback&&(game.possessionModel?game.possessionModel.calibrationVerified===true:game.trust?.calibration_status==='VERIFIED'),
   historicalValidationRequired:true
  };
  audit.passed=audit.winLossConservation&&audit.moneylineSymmetry&&audit.spreadSymmetry&&audit.totalSymmetry&&audit.finiteScores&&audit.playerScoreConservation&&audit.playerMinuteConservation;
  if(!audit.passed)throw Error('Simulation integrity check failed; predictions withheld');
  const candidates=markets.filter(m=>m.eligible).sort((a,b)=>b.ev-a.ev);
  return {possession:possession?{context:game.possessionModel.context,model:possession.model,players:possession.players,overtimeRate:possession.overtimeRate,overtimePeriods:possession.overtimePeriods,blowoutRate:possession.blowoutRate,legs:possession.legs,jointHitRate:possession.jointHitRate,pairHitRates:possession.pairHitRates,pace:game.possessionModel.pace,uncertain:game.possessionModel.uncertain,rotation:game.possessionModel.teams,baseline:game.baseline}:null,rotationFallback:game.rotationFallback||null,sport:game.sport,home:game.home,away:game.away,runCount:count,detailedGameCount:detailedCount,simulationMethod,seed,modelStatus:'RESEARCH ONLY · NOT CALIBRATED',
   projection:{home:possession?round(homePoints/count):game.projectedHome,away:possession?round(awayPoints/count):game.projectedAway,margin:round(possession?(homePoints-awayPoints)/count:game.projectedHome-game.projectedAway),total:round(possession?(homePoints+awayPoints)/count:game.projectedHome+game.projectedAway)},
   simulated:{home:round(homePoints/count),away:round(awayPoints/count),homeWin:homeWin/count,awayWin:awayWin/count,tie:ties/count,
    margin:{p10:quantile(margins,.1),p25:quantile(margins,.25),median:quantile(margins,.5),p75:quantile(margins,.75),p90:quantile(margins,.9)},
    total:{p10:quantile(totals,.1),p25:quantile(totals,.25),median:quantile(totals,.5),p75:quantile(totals,.75),p90:quantile(totals,.9)},
    homePoints:{p10:quantile(homeScores,.1),p90:quantile(homeScores,.9)},
    awayPoints:{p10:quantile(awayScores,.1),p90:quantile(awayScores,.9)}},
   market:{homeSpread:market.homeSpread,total:market.total},
   markets,audit,candidates:candidates.map(x=>x.key),sample:game.sample,method:game.method,warning:game.warning,
   verification:'No bet is verified: model calibration, real execution prices, injuries and lineups are not independently confirmed. 100,000 draws reduce simulation noise, not underlying model error.'};
 }
 // Walk-forward evaluation: each historical prediction sees ONLY earlier games.
 // Baseline-only mode intentionally excludes unavailable historical injury snapshots.
 function backtestNBA(feed,{minHistory=40,maxGames=120,draws=1000}={}){
  const completed=(feed?.games||[]).map(g=>({raw:g,score:gamePoints(g)})).filter(x=>x.score).sort((a,b)=>a.score.time-b.score.time);
  const rows=[],skipped={insufficientHistory:0,other:0};
  for(let i=minHistory;i<completed.length;i++){
   const actual=completed[i].score,earlier=completed.slice(0,i).map(x=>x.raw);
   if(rows.length>=maxGames)break;
   try{
    const model=nbaGame({id:'walkforward-'+i,home:actual.home,away:actual.away,date:actual.date},{games:earlier});
    const result=simulate(model,{},draws,6472026+i);
    const outcome=actual.homePoints>actual.awayPoints?1:0,p=result.simulated.homeWin;
    // Benchmark: fixed 50% coin flip. Avoid claiming model skill without beating it.
    const benchmarkBrier=(.5-outcome)**2;
    rows.push({date:actual.date,home:actual.home,away:actual.away,probability:p,outcome,projectedHome:result.simulated.home,projectedAway:result.simulated.away,actualHome:actual.homePoints,actualAway:actual.awayPoints,brier:(p-outcome)**2,benchmarkBrier,scoreMAE:(Math.abs(result.simulated.home-actual.homePoints)+Math.abs(result.simulated.away-actual.awayPoints))/2});
   }catch(e){if(/Insufficient/.test(String(e.message)))skipped.insufficientHistory++;else skipped.other++;}
  }
  const bins=[{low:0,high:.2},{low:.2,high:.4},{low:.4,high:.6},{low:.6,high:.8},{low:.8,high:1.000001}].map(b=>{const sample=rows.filter(r=>r.probability>=b.low&&r.probability<b.high);return {range:[b.low,b.high>1?1:b.high],games:sample.length,predicted:sample.length?round(mean(sample.map(r=>r.probability))*100)/100:null,observed:sample.length?round(mean(sample.map(r=>r.outcome))*100)/100:null};});
  return {method:'Walk-forward NBA score baseline only; no historical injury snapshots or sportsbook prices. NOT a validated live possession model.',games:rows.length,brier:rows.length?mean(rows.map(r=>r.brier)):null,benchmarkBrier:rows.length?mean(rows.map(r=>r.benchmarkBrier)):null,beatsCoinFlip:rows.length>=50?mean(rows.map(r=>r.brier))<mean(rows.map(r=>r.benchmarkBrier)):null,scoreMAE:rows.length?mean(rows.map(r=>r.scoreMAE)):null,calibration:bins,skipped,rows};
 }
 return {quote,nflGame,nbaGame,gamePoints,marketInput,simulate,backtestNBA};
});



