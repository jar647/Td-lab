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
 const VERSION='nfl-matchup-epa-interaction-v1';
 const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
 const number=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
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
    const raw=paired*plays*0.25,shift=clamp(raw,-1.5,1.5);
    const detail={mode,team,opponent,offenseEpa:offense,defenseAllowedEpa:allowed,
      leagueEpa:league,offenseRelative:offenseRel,defenseRelative:defenseRel,
      playsPerGame:plays,offenseGames:sample.offense_games,defenseGames:sample.opponent_games,
      directionalSignal:shift>0?'FAVORABLE':shift<0?'ADVERSE':'NEUTRAL',
      pointsShift:Number(shift.toFixed(3))};
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
   directions[team]={team,opponent,details,rushYards,pointsShift:Number(clamp(details.reduce((n,x)=>n+x.pointsShift,0),-2.5,2.5).toFixed(3))};
  }
  return {version:VERSION,sourceVersion:research.version,throughWeek:expectedWeek,
   status:'RESEARCH SCENARIO · NOT CALIBRATED',
   home:directions[home],away:directions[away],
   assumptions:'Prior-week pass/run EPA aligned weaknesses add at most ±1.5 team points per play type and ±2.5 per team. Rushing yard expectations use 70% offense and 30% opponent attempts allowed, 70% of the offense-versus-league yards/carry gap and 75% of the opponent allowance gap. Rushing totals are drawn in each simulated game with game-script and skewed performance variation. All these weights are heuristic, not calibrated betting probabilities.',
   verifiedCoverage:'At least 3 completed games and 45 plays per offense/defense play type; duplicate/missing observations rejected.'};
 }
 return {VERSION,evaluate};
});
