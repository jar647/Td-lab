/* NFL pregame opponent matchup interaction. Research-only.
 * Uses prior-week, independently sourced passing/rushing EPA against the
 * specific opposing defense. A small, capped scenario shift is kept separate
 * from production scoring baselines and betting-calibration claims.
 */
(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 root.CookNFLMatchupScenario=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const VERSION='nfl-matchup-multifactor-v2';
 const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
 const number=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
 // Most situational stats overlap EPA; treat them as corroborating estimates
 // in a WEIGHTED BLEND rather than stacking independent point adjustments.
 const corroboration={success:{coefficient:4,weight:3},explosive:{coefficient:5,weight:2},
  turnover:{coefficient:-10,weight:2},sack:{coefficient:-5,weight:2},
  third_conversion:{coefficient:3,weight:1},red_zone_td:{coefficient:3,weight:1}};
 function metrics(sample,mode,epaPoints){
  const observed=[],rates=sample.situational||{};
  for(const [key,spec] of Object.entries(corroboration)){
   if(mode==='rush'&&key==='sack')continue;
   const r=rates[key],a=number(r?.offense_rate),d=number(r?.opponent_allowed_rate),league=number(r?.league_rate);
   if(a===null||d===null||league===null||[a,d,league].some(x=>x<0||x>1)||
      !Number.isInteger(r.offense_plays)||!Number.isInteger(r.opponent_plays)||
      Math.min(r.offense_plays,r.opponent_plays)<(key==='red_zone_td'?8:key==='third_conversion'?12:45))continue;
   const off=a-league,def=d-league;
   const aligned=off*def>0?Math.sign(off)*Math.min(Math.abs(off),Math.abs(def)):0;
   const effect=clamp(aligned*spec.coefficient,-1.5,1.5);
   observed.push({name:key,offenseRate:a,opponentRate:d,leagueRate:league,
    direction:effect>0?'FAVORABLE':effect<0?'ADVERSE':'NEUTRAL',
    scoreEquivalent:Number(effect.toFixed(3)),weight:spec.weight});
  }
  const totalWeight=observed.reduce((sum,x)=>sum+x.weight,0);
  const corroborationPoints=totalWeight?observed.reduce((sum,x)=>sum+x.scoreEquivalent*x.weight,0)/totalWeight:0;
  // With at least two observed corroborators, reuse the EPA scoring budget:
  // 80% EPA / 20% independent event-rate estimate, not EPA plus all rates.
  const combined=observed.length>=2?.8*epaPoints+.2*corroborationPoints:epaPoints;
  return {observed,scoreEquivalent:Number(corroborationPoints.toFixed(3)),
   blendedShift:Number(clamp(combined,-1.5,1.5).toFixed(3)),
   weighting:observed.length>=2?'80% EPA + 20% correlated event-rate corroboration':'EPA only: less than two supported situational rates'};
 }
 function passingYards(row){
  const r=row.pass.passing_yards;
  if(!r)return null;
  const fields=['offense_net_yards_per_play','opponent_net_yards_allowed_per_play','league_net_yards_per_play',
   'offense_pass_plays_per_game','opponent_pass_plays_allowed_per_game'];
  if(fields.some(k=>number(r[k])===null)||!Number.isInteger(r.offense_yardage_plays)||r.offense_yardage_plays<45||
     !Number.isInteger(r.defense_yardage_plays)||r.defense_yardage_plays<45||
     fields.slice(0,3).some(k=>r[k]<-2||r[k]>16)||fields.slice(3).some(k=>r[k]<5||r[k]>75))return null;
  const league=r.league_net_yards_per_play,
   baseline=clamp(league+.7*(r.offense_net_yards_per_play-league),1,11.5),
   ypa=clamp(baseline+.75*(r.opponent_net_yards_allowed_per_play-league),.8,12),
   attempts=clamp(.7*r.offense_pass_plays_per_game+.3*r.opponent_pass_plays_allowed_per_game,12,65);
  return {baselineNetYpa:Number(baseline.toFixed(3)),matchupNetYpa:Number(ypa.toFixed(3)),
   expectedAttempts:Number(attempts.toFixed(3)),baselineYards:Number((attempts*baseline).toFixed(2)),
   matchupYards:Number((attempts*ypa).toFixed(2)),offenseNetYpa:r.offense_net_yards_per_play,
   opponentAllowedNetYpa:r.opponent_net_yards_allowed_per_play,
   offenseYardagePlays:r.offense_yardage_plays,defenseYardagePlays:r.defense_yardage_plays};
 }
 function evaluate(research,home,away,week){
  const expectedWeek=Number(week)-1;
  if(!research||research.version!=='nfl-matchup-research-v1'||research.status!=='RESEARCH_ONLY'||
     !Number.isInteger(expectedWeek)||expectedWeek<1||research.through_week!==expectedWeek||
     !Array.isArray(research.opportunities))
   throw Error('Current-week, source-bounded NFL pass/rush matchup research unavailable');
  const names=[home,away];
  if(!names.every(x=>typeof x==='string'&&x.length>0)||home===away)throw Error('Matchup teams are missing or duplicated');
  const directions={},all=[];
  for(const team of names){
   const opponent=team===home?away:home;
   const rows=research.opportunities.filter(x=>x.team===team&&x.opponent===opponent);
   if(rows.length!==1)throw Error('Missing or duplicated EPA matchup evidence for '+team+' against '+opponent);
   const row=rows[0],details=[];
   for(const mode of ['pass','rush']){
    const sample=row[mode];
    if(!sample||sample.available!==true||!['SUPPORTED','LIMITED'].includes(sample.confidence?.level)||
       !['number','string'].includes(typeof sample.offense_plays)||
       !Number.isInteger(sample.offense_games)||sample.offense_games<3||
       !Number.isInteger(sample.opponent_games)||sample.opponent_games<3||
       !Number.isInteger(sample.offense_plays)||sample.offense_plays<45||
       !Number.isInteger(sample.opponent_plays)||sample.opponent_plays<45||
       !Number.isInteger(sample.league_teams)||sample.league_teams<4)
     throw Error(team+' '+mode+' EPA matchup has insufficient verified prior-game coverage');
    const offense=number(sample.offense_epa),allowed=number(sample.opponent_allowed_epa),
      league=number(sample.league_epa);
    if(offense===null||allowed===null||league===null||Math.max(Math.abs(offense),Math.abs(allowed),Math.abs(league))>3)
     throw Error(team+' '+mode+' EPA inputs are unavailable or outside plausible bounds');
    const offenseRel=offense-league,defenseRel=allowed-league,
      // Matching bad offense and strong defense (both negative) lowers output;
      // matching strong offense and weak defense (both positive) raises it.
      // Opposing signs do not invent a directional advantage.
      paired=offenseRel*defenseRel>0?Math.sign(offenseRel)*Math.min(Math.abs(offenseRel),Math.abs(defenseRel)):0,
      plays=clamp(sample.offense_plays/sample.offense_games,0,70);
    // Only 25% of the observed aligned EPA gap is allowed because baseline
    // team scoring already includes offense and opponent effects.
    const raw=paired*plays*0.25,epaShift=clamp(raw,-1.5,1.5);
    const evidence=metrics(sample,mode,epaShift),shift=evidence.blendedShift;
    const detail={mode,team,opponent,offenseEpa:offense,defenseAllowedEpa:allowed,
      leagueEpa:league,offenseRelative:offenseRel,defenseRelative:defenseRel,
      playsPerGame:plays,offenseGames:sample.offense_games,defenseGames:sample.opponent_games,
      directionalSignal:shift>0?'FAVORABLE':shift<0?'ADVERSE':'NEUTRAL',
      epaPointsShift:Number(epaShift.toFixed(3)),
      pointsShift:Number(shift.toFixed(3)),situational:evidence};
    details.push(detail);all.push(detail);
   }
   const rushRecord=row.rush.rushing_yards;
   const fields=['offense_yards_per_carry','opponent_yards_allowed_per_carry','league_yards_per_carry','offense_carries_per_game','opponent_carries_allowed_per_game'];
   if(!rushRecord||fields.some(k=>number(rushRecord[k])===null)||
      !Number.isInteger(rushRecord.offense_yardage_plays)||rushRecord.offense_yardage_plays<45||
      !Number.isInteger(rushRecord.defense_yardage_plays)||rushRecord.defense_yardage_plays<45||
      fields.slice(0,3).some(k=>rushRecord[k]<-2||rushRecord[k]>14)||
      fields.slice(3).some(k=>rushRecord[k]<5||rushRecord[k]>70))
     throw Error(team+' prior-week rushing yardage or volume source is unavailable; refresh the verified NFL feed');
   const leagueYpc=rushRecord.league_yards_per_carry;
   const baselineYpc=clamp(leagueYpc+.7*(rushRecord.offense_yards_per_carry-leagueYpc),1.25,8.5);
   const matchupYpc=clamp(baselineYpc+.75*(rushRecord.opponent_yards_allowed_per_carry-leagueYpc),1.1,8.5);
   const rushAttempts=clamp(.7*rushRecord.offense_carries_per_game+.3*rushRecord.opponent_carries_allowed_per_game,10,50);
   const rushYards={
     baselineYpc:Number(baselineYpc.toFixed(3)),
     matchupYpc:Number(matchupYpc.toFixed(3)),
     expectedAttempts:Number(rushAttempts.toFixed(3)),
     baselineYards:Number((rushAttempts*baselineYpc).toFixed(2)),
     matchupYards:Number((rushAttempts*matchupYpc).toFixed(2)),
     offenseYpc:rushRecord.offense_yards_per_carry,
     opponentAllowedYpc:rushRecord.opponent_yards_allowed_per_carry,
     leagueYpc,
     offenseGames:row.rush.offense_games,defenseGames:row.rush.opponent_games,
     offenseYardagePlays:rushRecord.offense_yardage_plays,
     defenseYardagePlays:rushRecord.defense_yardage_plays
   };
   const passYards=passingYards(row);
   // Tempo changes SCORE SPREAD, not baseline team quality. Historical team
   // scoring already includes pace; moving the mean again would double-count.
   const offensePlays=(row.pass.offense_plays/row.pass.offense_games)+(row.rush.offense_plays/row.rush.offense_games);
   const defensePlays=(row.pass.opponent_plays/row.pass.opponent_games)+(row.rush.opponent_plays/row.rush.opponent_games);
   const tempo=number(research.source_coverage?.league_scrimmage_plays_per_team_game);
   const expectedPlays=.7*offensePlays+.3*defensePlays;
   const tempoScale=tempo!==null&&tempo>=30&&tempo<=85?clamp(Math.sqrt(expectedPlays/tempo),.90,1.12):1;
   const situational=row.pass.situational||{};
   const turnover=situational.turnover,explosive=situational.explosive;
   const eventImpact=r=>r&&[r.offense_rate,r.opponent_allowed_rate,r.league_rate].every(x=>number(x)!==null)?
    (.5*(r.offense_rate-r.league_rate)+.5*(r.opponent_allowed_rate-r.league_rate)):0;
   const varianceScale=clamp(tempoScale*(1+.6*eventImpact(turnover)+.4*eventImpact(explosive)),.85,1.18);
   directions[team]={team,opponent,details,rushYards,passYards,
    expectedPlays:Number(expectedPlays.toFixed(2)),
    varianceScale:Number(varianceScale.toFixed(4)),
    pointsShift:Number(clamp(details.reduce((n,x)=>n+x.pointsShift,0),-2.5,2.5).toFixed(3))};
  }
  return {version:VERSION,sourceVersion:research.version,throughWeek:expectedWeek,
   status:'RESEARCH SCENARIO · NOT CALIBRATED',
   home:directions[home],away:directions[away],
   assumptions:'Prior-week pass/run EPA is the main scoring signal; documented success, explosive rate, sack/turnover, third-down and red-zone rates share up to 20% of the SAME bounded point-adjustment budget when at least two are supported. No additive double counting. Per-side run/pass yards use shrinkage toward league per-play rates and opponent allowances; pace and documented event risk modestly change residual variance. Yardage deviations influence scores within each simulated game, never via sportsbook lines. At most ±1.5 per play type and ±2.5 per team in pregame score centers. All coefficients are heuristics, not calibrated betting probabilities.',
   verifiedCoverage:'At least 3 completed games and 45 plays per offense/defense play type; duplicate/missing observations rejected.'};
 }
 return {VERSION,evaluate};
});
