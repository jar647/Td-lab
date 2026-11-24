/* Model NFL outcomes from opponent-sensitive rushing distributions and
 * passing/rushing EPA, without ever turning a defensive edge into a forced win.
 */
'use strict';
const assert=require('node:assert/strict');
const engine=require('./game_odds_engine.js');
const match=require('./nfl_matchup_scenario.js');
const observed=(off,allowed,league,mode)=>{
 const obj={available:true,confidence:{level:'SUPPORTED'},offense_games:9,opponent_games:9,offense_plays:mode==='rush'?237:320,
  opponent_plays:mode==='rush'?236:320,league_teams:32,
  offense_epa:off,opponent_allowed_epa:allowed,league_epa:league};
 if(mode==='rush')obj.rushing_yards={offense_yards_per_carry:2.9,opponent_yards_allowed_per_carry:2.5,
 league_yards_per_carry:4.5,offense_carries_per_game:27,opponent_carries_allowed_per_game:25,
 offense_yardage_plays:237,defense_yardage_plays:236};
 if(mode==='pass')obj.passing_yards={offense_net_yards_per_play:6.8,opponent_net_yards_allowed_per_play:5.3,
 league_net_yards_per_play:6,offense_pass_plays_per_game:34,opponent_pass_plays_allowed_per_game:36,
 offense_yardage_plays:320,defense_yardage_plays:320};
 return obj;
};
const team=(name,opponent,rush,pass)=>({team:name,opponent,
 rush:observed(rush.off,rush.allowed,0,'rush'),
 pass:observed(pass.off,pass.allowed,0,'pass')});
const feed={version:'nfl-matchup-research-v1',status:'RESEARCH_ONLY',through_week:8,
 source_coverage:{league_scrimmage_plays_per_team_game:62},
 opportunities:[
  team('GOOD','BAD',{off:.05,allowed:.08},{off:.11,allowed:.08}),
  team('BAD','GOOD',{off:-.28,allowed:-.25},{off:.12,allowed:.12})
 ]};
const research=match.evaluate(feed,'GOOD','BAD',9);
assert(research.away.passYards&&research.away.passYards.matchupYards>0,'Verified passing efficiency should create a real net passing projection');
assert(research.away.expectedPlays>40&&research.away.expectedPlays<80,'Pass/run volumes must drive expected plays');
assert(Number.isFinite(research.away.varianceScale),'Tempo and observed event risk must enter the score distribution');
const supported=structuredClone(feed);
const pairedSituational=(good,bad)=>({
 success:{offense_rate:good,opponent_allowed_rate:bad,league_rate:.45,offense_plays:320,opponent_plays:320},
 explosive:{offense_rate:.17,opponent_allowed_rate:.15,league_rate:.10,offense_plays:320,opponent_plays:320},
 turnover:{offense_rate:.01,opponent_allowed_rate:.015,league_rate:.025,offense_plays:320,opponent_plays:320},
 sack:{offense_rate:.035,opponent_allowed_rate:.04,league_rate:.075,offense_plays:320,opponent_plays:320},
 third_conversion:{offense_rate:.48,opponent_allowed_rate:.47,league_rate:.40,offense_plays:85,opponent_plays:90},
 red_zone_td:{offense_rate:.17,opponent_allowed_rate:.18,league_rate:.12,offense_plays:28,opponent_plays:26}
});
supported.opportunities[0].pass.situational=pairedSituational(.56,.54);
const withSituational=match.evaluate(supported,'GOOD','BAD',9);
const factor=withSituational.home.details.find(d=>d.mode==='pass');
assert(factor.situational.observed.length===6,'All six supported passing dimensions must actually be read');
assert.notEqual(factor.epaPointsShift,factor.pointsShift,'Multiple supported stats change the blended pass point adjustment');
assert(Math.abs(factor.pointsShift)<=1.5,'Corroboration cannot escape the existing EPA cap');
const missing=structuredClone(supported);
missing.opportunities[0].pass.situational.success.offense_rate=null;
missing.opportunities[0].pass.situational.turnover.offense_plays=0;
const tested=match.evaluate(missing,'GOOD','BAD',9).home.details.find(d=>d.mode==='pass');
assert(tested.situational.observed.every(d=>!['success','turnover'].includes(d.name)),
 'Missing or unsupported source fields cannot be fabricated as neutral rates');
const unsafe=structuredClone(supported);
unsafe.opportunities[0].pass.situational.sack.offense_rate=999;
assert(!match.evaluate(unsafe,'GOOD','BAD',9).home.details.find(d=>d.mode==='pass').situational.observed.some(d=>d.name==='sack'),
 'Out-of-bounds event rates must be rejected without inventing them');
assert(research.away.rushYards.matchupYards<research.away.rushYards.baselineYards,
 'Bad rush offense versus good rush defense must reduce yard expectation');
assert(research.away.details.find(x=>x.mode==='rush').pointsShift<0,'Weak run matchup must reduce rushing contribution');
assert(research.away.pointsShift<0,'Strong rushing defense should affect overall scoring when passing does not fully offset it');
const strongPass=structuredClone(feed);
strongPass.opportunities[1].pass.offense_epa=.3;
strongPass.opportunities[1].pass.opponent_allowed_epa=.3;
const offset=match.evaluate(strongPass,'GOOD','BAD',9);
assert(offset.away.pointsShift>=research.away.pointsShift,'Strong passing matchup can offset bad rushing');
assert(research.away.pointsShift>-2.51,'Poor rush alone cannot determine the scoreboard');
assert.equal(research.away.rushYards.offenseYpc,2.9);
const residual={records:Array.from({length:150},(_,i)=>({season:2025,week:(i%17)+1,
 projected_home:22,projected_away:24,
 actual_home:22+Math.round(Math.sin(i)*7),actual_away:24+Math.round(Math.cos(i)*8)
}))};
const game={game_id:'2026_09_BAD_GOOD',home:'GOOD',away:'BAD',projected_home_points:22,projected_away_points:28,
 model_inputs:{home:{games:9,offense:23,defense_allowed:20},
 away:{games:9,offense:30,defense_allowed:21},matchup_research:feed}};
const neutral=engine.nflGame(game,residual,{week:9,season:2026,modelMode:'baseline'});
const adjusted=engine.nflGame(game,residual,{week:9,season:2026,modelMode:'matchup'});
assert(adjusted.matchupScenario,'Adjusted model must contain sourced matchup inputs');
assert(adjusted.projectedAway>adjusted.projectedHome,
 'Even an adverse run matchup can coexist with a favored team');
assert(adjusted.projectedAway<neutral.projectedAway,
 'Poor rushing matchup must reduce the modeled score center, not set a fixed result');
const sampled=engine.simulate(adjusted,{},10000,125);
const sampledAgain=engine.simulate(adjusted,{},10000,125);
assert.deepEqual(sampled.rushing,sampledAgain.rushing,'Rushing draws must be reproducible');
assert.equal(sampled.runCount,10000);
assert(sampled.passing.BAD?.mean>0,'Each jointly simulated NFL game needs the supported net passing distribution');
assert(sampled.passing.BAD.p10<sampled.passing.BAD.p90,'Net pass yards must have game-to-game variance');
const noPass=structuredClone(adjusted);
noPass.matchupScenario.away.passYards=null;noPass.matchupScenario.home.passYards=null;
const withoutPass=engine.simulate(noPass,{},10000,125);
assert.notDeepEqual(sampled.scoreBins,withoutPass.scoreBins,'Passing yard variance must alter the same-game score outcomes');
const differentlyPriced=engine.simulate(adjusted,{homeML:'-180',awayML:'+160'},10000,125);
assert.deepEqual(sampled.simulated,differentlyPriced.simulated,'Book prices must never influence the expanded model');
assert.deepEqual(sampled.rushing,differentlyPriced.rushing,'Book prices must not change rush draws');
assert.deepEqual(sampled.passing,differentlyPriced.passing,'Book prices must not change pass draws');
assert(sampled.rushing.BAD.mean<sampled.rushing.BAD.baselineYards,
 'Strong run defense should suppress most outcomes');
assert(sampled.rushing.BAD.p10<sampled.rushing.BAD.p90,
 'Simulation must retain realistic upside and downside tails');
assert(sampled.rushing.BAD.p90>sampled.rushing.BAD.median*1.2,'The model must retain a meaningful high-rushing tail');
assert(sampled.rushing.BAD.under100>.5,'Poor rushing matchup should produce under 100 yards more often');
assert(sampled.simulated.awayWin>.5,'Even with suppressed rush yards, passing and team score can keep a team favored');
assert(sampled.simulated.homeWin>0,'NFL upsets must stay possible');
assert.equal(sampled.modelStatus,'RESEARCH ONLY · NOT CALIBRATED');
assert(sampled.markets.every(x=>!x.eligible),'Research outcomes cannot authorize an uncalibrated bet');
const expired={...feed,through_week:7};
assert.throws(()=>match.evaluate(expired,'GOOD','BAD',9),/week/i);
const noYards=structuredClone(feed);delete noYards.opportunities[1].rush.rushing_yards;
assert.throws(()=>match.evaluate(noYards,'GOOD','BAD',9),/rushing yardage/i);
const noRun=structuredClone(feed);noRun.opportunities[1].rush.available=false;
assert.throws(()=>match.evaluate(noRun,'GOOD','BAD',9),/coverage/i);
console.log('NFL opponent rushing and score scenario: pass, rushing suppression and independent outcome tails PASS');
