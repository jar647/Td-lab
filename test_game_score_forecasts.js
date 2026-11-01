'use strict';
const assert=require('node:assert/strict');
const engine=require('./game_odds_engine.js');
const {captureAndGrade}=require('./track_game_score_forecasts.js');
const now=new Date('2026-11-01T12:00:00Z');
const history={records:Array.from({length:120},(_,i)=>({season:2025,week:5+i%10,
 baseline_home:22,baseline_away:20,projected_home:i%2?1000:-1000,projected_away:i%2?-900:900,
 actual_home:22+i%10,actual_away:20+i%7}))};
const game={game_id:'2026_08_BAL_BUF',home:'BUF',away:'BAL',gameday:'2026-11-01',
 kickoff_at:'2026-11-01T18:00:00Z',model_version:'score-baseline-trust-v3',
 projected_home_points:25,projected_away_points:22,
 model_inputs:{home:{games:6},away:{games:7},trust:{source_status:'RECONCILED',
 source_sha256:'example',projection_basis:'SCORING_BASELINE',calibration_status:'NOT_CALIBRATED',qb_context:{}}}};
const slate={season:2026,week:8,generated_at:now.toISOString(),games:[game]};
const model=engine.nflGame(game,history,{season:2026,week:8,generatedAt:now.toISOString()});
assert.equal(model.residualBasis,'SCORING_BASELINE');
assert(model.residuals.every(r=>Math.abs(r.homeError)<20),'never mix adjusted-model errors into the baseline distribution');
const simulation=engine.simulate(model,{homeML:'+150',awayML:'+150',total:'45.5',over:'+150',under:'+150'},1000,1);
assert(simulation.markets.every(m=>!m.eligible));
assert(simulation.markets.every(m=>m.signal==='PASS · MODEL NOT VALIDATED'||m.signal==='PASS · SOURCE UNVERIFIED OR STALE'));
model.trust.qb_context.BAL={status:'RETURNING_STARTER_SAMPLE_MISMATCH'};
const changed=engine.simulate(model,{homeML:'+150'},1000,1);
assert(!changed.markets[0].eligible);
assert(changed.markets[0].signal.includes('QB CHANGE')||changed.markets[0].signal.includes('STALE'));
const first=captureAndGrade(slate,history,{}, {},now,'test',1000);
assert.equal(first.records.length,1);
const original=JSON.stringify(first.records[0]);
const altered=JSON.parse(JSON.stringify(slate));altered.games[0].projected_home_points=50;
const next=captureAndGrade(altered,history,first,{},new Date('2026-11-01T13:00:00Z'),'changed',1000);
assert.equal(JSON.stringify(next.records[0]),original,'new inputs never overwrite a forecast');
assert.equal(captureAndGrade(slate,history,{}, {},new Date('2026-11-01T18:00:01Z'),'test',1000).records.length,0,'never capture after kickoff');
const graded=captureAndGrade(slate,history,first,{games:{'2026_08_BAL_BUF':{home:24,away:21}}},new Date('2026-11-02T12:00:00Z'),'test',1000);
assert.equal(graded.summary.graded,1);
assert.equal(graded.records[0].captured_at,first.records[0].captured_at);
assert.equal(graded.records[0].result.home_won,true);
assert(Number.isFinite(graded.summary.brier));
const corrected=captureAndGrade(slate,history,graded,{games:{'2026_08_BAL_BUF':{home:0,away:80}}},new Date('2026-11-03T12:00:00Z'),'test',1000);
assert.deepEqual(corrected.records[0].result,graded.records[0].result,'first grades remain reviewable');
console.log('Audited baseline residuals, no unvalidated leans, immutable pregame forecasts and prospective grading passed');
