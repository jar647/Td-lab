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
 return obj;
};
const team=(name,opponent,rush,pass)=>({team:name,opponent,
 rush:observed(rush.off,rush.allowed,0,'rush'),
 pass:observed(pass.off,pass.allowed,0,'pass')});
const feed={version:'nfl-matchup-research-v1',status:'RESEARCH_ONLY',through_week:8,
 opportunities:[
  team('GOOD','BAD',{off:.05,allowed:.08},{off:.11,allowed:.08}),
  team('BAD','GOOD',{off:-.28,allowed:-.25},{off:.30,allowed:.30})
 ]};
const research=match.evaluate(feed,'GOOD','BAD',9);
assert(research.away.rushYards.matchupYards<research.away.rushYards.baselineYards,
 'Bad rush offense versus good rush defense must reduce yard expectation');
assert(research.away.pointsShift<0,'Weak run match lowers score center');
assert(research.away.pointsShift>-2.51,'Poor rush alone cannot determine the scoreboard');
assert.equal(research.away.rushYards.offenseYpc,2.9);
const residual={records:Array.from({length:150},(_,i)=>({season:2025,week:(i%17)+1,
 projected_home:22,projected_away:24,
 actual_home:22+Math.round(Math.sin(i)*7),actual_away:24+Math.round(Math.cos(i)*8)
}))};
const game={game_id:'2026_09_BAD_GOOD',home:'GOOD',away:'BAD',projected_home_points:18,projected_away_points:32,
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
