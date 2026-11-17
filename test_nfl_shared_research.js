'use strict';
const assert=require('node:assert/strict');
const engine=require('./game_odds_engine');
const {captureAndGrade}=require('./track_game_score_forecasts');
const now=new Date(),generated=now.toISOString(),kickoff=new Date(+now+86400000).toISOString();
const history={records:Array.from({length:100},(_,i)=>({game_id:'earlier-'+i,season:2025,week:5+i%10,
 baseline_home:20,baseline_away:20,actual_home:20+i%7,actual_away:20+i%5}))};
const audit={model_version:'opponent-score-ridge-v1',records:history.records.map(r=>({...r,candidate_home:25,candidate_away:17}))};
const card={version:'nfl-qb-lineup-scenario-v1',base_version:audit.model_version,generated_at:generated,through_week:10,
 available:true,home:28,away:17,quarterbacks:{A:{player_id:'a',effect_available:true},B:{player_id:'b',effect_available:true}}};
const game={game_id:'2026_11_B_A',home:'A',away:'B',kickoff_at:kickoff,model_version:'score-baseline-trust-v3',
 projected_home_points:20,projected_away_points:20,model_inputs:{home:{games:8},away:{games:8},
 trust:{source_status:'RECONCILED',projection_basis:'SCORING_BASELINE',calibration_status:'NOT_CALIBRATED',source_sha256:'verified'},lineup_scenario:card}};
const meta={season:2026,week:11,generatedAt:generated,modelMode:'lineup',lineupHistory:audit};
const before=engine.nflGame(game,history,meta),oldSlate={season:2026,week:11,generated_at:generated,games:[game]};
const frozen=captureAndGrade(oldSlate,history,{}, {},now,'previous-signature',1000,audit);
const original=JSON.stringify(frozen.records);
game.model_inputs.matchup_research={version:'nfl-matchup-research-v1',status:'RESEARCH_ONLY',score_adjustments_applied:false,
 opportunities:[{team:'A',opponent:'B',pass:{available:true,matchup_relative_to_league:.2}}]};
const researched=engine.nflGame(game,history,meta);
assert.deepEqual(researched.matchupResearch,game.model_inputs.matchup_research);
assert.equal(researched.projectedHome,before.projectedHome);assert.equal(researched.projectedAway,before.projectedAway);
assert.deepEqual(engine.simulate(researched,{},1000,647).simulated,engine.simulate(before,{},1000,647).simulated,
 'Adding explanatory research cannot silently promote an EPA point correction');
const repriced=engine.simulate(researched,{homeML:-110,total:44.5,over:-120},1000,647);
assert.deepEqual(repriced.simulated,engine.simulate(researched,{homeML:500,total:60.5,over:150},1000,647).simulated,
 'Book prices and lines do not alter football outcomes');
game.model_inputs.lineup_scenario={...card,version:'nfl-qb-lineup-scenario-v2',home:27};
const updated=captureAndGrade(oldSlate,history,frozen,{},now,'new-signature',1000,audit);
assert.equal(updated.records.length,3);assert.equal(JSON.stringify(updated.records.slice(0,2)),original,
 'New evidence policy must append its own version rather than replace frozen baseline or v1 predictions');
assert.equal(updated.records[2].model_version,'nfl-qb-lineup-scenario-v2');
assert.equal(updated.records[2].lineup_scenario.home,27);
assert(updated.records.every(r=>Date.parse(r.captured_at)<Date.parse(r.kickoff_at)));
assert(repriced.markets.every(r=>!r.eligible),'Research changes do not authorize a betting edge');
console.log('NFL shared research: existing engine integration, unchanged descriptive-only forecasts, odds independence and immutable v1/v2 captures PASS');
