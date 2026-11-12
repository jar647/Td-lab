'use strict';const assert=require('node:assert/strict'),engine=require('./game_odds_engine'),{captureAndGrade}=require('./track_game_score_forecasts');
const clock=Date.parse('2026-11-12T12:00:00Z'),realNow=Date.now;Date.now=()=>clock;
try{
 const history={records:Array.from({length:100},(_,i)=>({game_id:'old-'+i,season:2025,week:5+i%10,baseline_home:20,baseline_away:20,actual_home:20+i%7,actual_away:20+i%5}))};
 const audit={model_version:'opponent-score-ridge-v1',records:history.records.map(r=>({...r,candidate_home:25,candidate_away:17}))};
 const card={version:'nfl-qb-lineup-scenario-v1',base_version:audit.model_version,generated_at:new Date(clock).toISOString(),through_week:9,available:true,home:28,away:17,quarterbacks:{A:{player_id:'a',effect_available:true},B:{player_id:'b',effect_available:true}}};
 const game={game_id:'2026_10_B_A',home:'A',away:'B',gameday:'2026-11-13',kickoff_at:'2026-11-13T18:00:00Z',model_version:'score-baseline-trust-v3',projected_home_points:20,projected_away_points:20,model_inputs:{home:{games:8},away:{games:8},trust:{source_status:'RECONCILED',projection_basis:'SCORING_BASELINE',calibration_status:'NOT_CALIBRATED',source_sha256:'test'},lineup_scenario:card}};
 const meta={season:2026,week:10,generatedAt:new Date(clock).toISOString(),modelMode:'lineup',lineupHistory:audit,live:true};
 const model=engine.nflGame(game,history,meta);assert.equal(model.projectedHome,28);assert.equal(model.projectedAway,17);assert.equal(model.residualBasis,'OPPONENT_QB_CHRONOLOGICAL_ERRORS');
 const result=engine.simulate(model,{homeML:120,total:45.5,over:-110},1000,17),repriced=engine.simulate(model,{homeML:-130,total:50.5,over:130},1000,17);assert.deepEqual(result.simulated,repriced.simulated);assert.ok(result.audit.passed);assert.ok(result.markets.every(r=>!r.eligible));
 const future={...audit,records:[...audit.records,{game_id:'future',season:2026,week:10,candidate_home:0,candidate_away:0,actual_home:1000,actual_away:1000}]};assert.deepEqual(engine.nflGame(game,history,{...meta,lineupHistory:future}).residuals,model.residuals);
 assert.throws(()=>engine.nflGame(game,history,{...meta,lineupHistory:{...audit,model_version:'other'}}),/Matching chronological/);
 assert.throws(()=>engine.nflGame(game,history,{...meta,lineupHistory:{...audit,records:[...audit.records,audit.records[0]]}}),/Duplicate/);
 assert.throws(()=>engine.nflGame({...game,model_inputs:{...game.model_inputs,lineup_scenario:{...card,available:false}}},history,meta),/unavailable/);
 assert.throws(()=>engine.nflGame({...game,kickoff_at:null},history,meta),/Verified NFL kickoff/);
 assert.throws(()=>engine.simulate({...model,feedGeneratedAt:new Date(clock-25*3600000).toISOString()},{},1000),/Fresh pregame/);
 assert.throws(()=>engine.simulate({...model,date:new Date(clock-1).toISOString()},{},1000),/Fresh pregame/);
 const slate={season:2026,week:10,generated_at:new Date(clock).toISOString(),games:[game]};const first=captureAndGrade(slate,history,{}, {},new Date(clock),'signature',1000,audit);assert.equal(first.records.length,2);const frozen=JSON.stringify(first.records.find(r=>r.model_version===card.version));game.model_inputs.lineup_scenario.home=99;const again=captureAndGrade(slate,history,first,{},new Date(clock+1000),'signature',1000,audit);assert.equal(again.records.length,2);assert.equal(JSON.stringify(again.records.find(r=>r.model_version===card.version)),frozen);
 console.log('NFL lineup simulator: actual score changes, matching residuals, no future leakage, price isolation, live-input gates and immutable model-specific captures PASS');
}finally{Date.now=realNow}
