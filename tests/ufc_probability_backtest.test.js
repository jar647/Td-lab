const test=require('node:test');const assert=require('node:assert/strict');
const {score}=require('../ufc_probability_backtest.js');
const bout={bout_id:'1',starts_at:'2025-08-01T20:00:00Z',fighter_a:'a',fighter_b:'b',winner:'a',status:'final',method:'Decision'};
const p={stats_as_of:'2025-07-31T00:00:00Z',stats_source:'verified',stats:{slpm:4}};
const snaps={'1':[{...p,fighter_id:'a'},{...p,fighter_id:'b'}]};
const pred={'1':{winner_id:'a',winner_probability:0.8,frozen_at:'2025-08-01T19:00:00Z'}};
test('scores eligible frozen probability with Brier and log loss',()=>{const x=score([bout],snaps,pred);assert.equal(x.scored,1);assert.ok(Math.abs(x.brier-0.04)<1e-12);assert.ok(Math.abs(x.logLoss+Math.log(0.8))<1e-12);assert.equal(x.bins[8].count,1);assert.equal(x.calibrated,false)});
test('does not score missing or invalid probability',()=>{for(const value of [undefined,NaN,-0.1,1.1,'0.8']){const x=score([bout],snaps,{'1':{...pred['1'],winner_probability:value}});assert.equal(x.scored,0);assert.equal(x.brier,null);assert.equal(x.missingProbability,1)}});
test('does not score late predictions or leaked snapshots',()=>{const late=score([bout],snaps,{'1':{...pred['1'],frozen_at:'2025-08-01T21:00:00Z'}});assert.equal(late.scored,0);const leaked=score([bout],{'1':[{...p,fighter_id:'a',stats_as_of:'2025-08-01T19:30:00Z'},{...p,fighter_id:'b'}]},pred);assert.equal(leaked.scored,0)});
test('scores wrong predictions and boundary probabilities without infinite log loss',()=>{const x=score([bout],snaps,{'1':{...pred['1'],winner_id:'b',winner_probability:1}});assert.equal(x.brier,1);assert.ok(Number.isFinite(x.logLoss));assert.equal(x.bins[9].count,1)});
test('empty dataset never claims model performance',()=>{const x=score([],{},{});assert.equal(x.scored,0);assert.equal(x.logLoss,null);assert.equal(x.bettingEdgeVerified,false)});

test('reports finite descriptive reliability error for a single scored prediction',()=>{
 const x=score([bout],snaps,pred);
 assert.ok(Math.abs(x.expectedCalibrationError-0.2)<1e-12);
 assert.ok(Math.abs(x.maxCalibrationError-0.2)<1e-12);
 assert.equal(x.calibrated,false);
});
test('empty reliability diagnostics remain null rather than fabricated zeros',()=>{
 const x=score([],{},{});assert.equal(x.expectedCalibrationError,null);assert.equal(x.maxCalibrationError,null);
});
test('reliability error weights occupied bins and ignores empty bins',()=>{
 const second={...bout,bout_id:'2',fighter_a:'c',fighter_b:'d',winner:'d'};
 const s2=[{...p,fighter_id:'c'},{...p,fighter_id:'d'}];
 const x=score([bout,second],{...snaps,'2':s2},{...pred,'2':{winner_id:'c',winner_probability:0.3,frozen_at:pred['1'].frozen_at}});
 assert.equal(x.scored,2);
 assert.ok(Math.abs(x.expectedCalibrationError-0.25)<1e-12);
 assert.ok(Math.abs(x.maxCalibrationError-0.3)<1e-12);
});

test('rejects collection after freeze even when stats_as_of predates freeze',()=>{
 const later={'1':[{...p,fighter_id:'a',snapshot_at:'2025-08-01T19:30:00Z'},{...p,fighter_id:'b'}]};
 const x=score([bout],later,pred);
 assert.equal(x.scored,0);
 assert.ok(x.rows[0].errors.includes('fighter_0_snapshot_after_prediction'));
});
test('rejects malformed secondary timestamp rather than trusting valid stats_as_of',()=>{
 const malformed={'1':[{...p,fighter_id:'a',snapshot_at:'not-a-date'},{...p,fighter_id:'b'}]};
 const x=score([bout],malformed,pred);
 assert.equal(x.scored,0);
 assert.ok(x.rows[0].errors.includes('fighter_0_missing_stats_snapshot_timestamp'));
});
test('rejects stats timestamp later than collection timestamp',()=>{
 const impossible={'1':[{...p,fighter_id:'a',snapshot_at:'2025-07-30T00:00:00Z'},{...p,fighter_id:'b'}]};
 const x=score([bout],impossible,pred);
 assert.equal(x.scored,0);
 assert.ok(x.rows[0].errors.includes('fighter_0_stats_as_of_after_collection'));
});
test('accepts consistent dual timestamps collected before freeze',()=>{
 const valid={'1':[{...p,fighter_id:'a',snapshot_at:'2025-07-31T12:00:00Z'},{...p,fighter_id:'b'}]};
 assert.equal(score([bout],valid,pred).scored,1);
});

test('scores eligible historical bout with padded source ID without crashing',()=>{
 const padded={...bout,bout_id:' 1 '};
 const x=score([padded],snaps,pred);
 assert.equal(x.scored,1);
 assert.equal(x.rows[0].bout_id,'1');
 assert.equal(x.rows[0].outcome,1);
 assert.ok(Math.abs(x.brier-0.04)<1e-12);
});

test('reports honest eligibility and probability coverage without counting invalid bouts as predictions',()=>{
 const invalid={...bout,bout_id:'2',status:'scheduled'};
 const validMissing={...bout,bout_id:'3',fighter_a:'c',fighter_b:'d',winner:'c'};
 const result=score([bout,invalid,validMissing],{...snaps,'3':[{...p,fighter_id:'c'},{...p,fighter_id:'d'}]},pred);
 assert.equal(result.totalBouts,3);
 assert.equal(result.eligible,2);
 assert.equal(result.excluded,1);
 assert.equal(result.scored,1);
 assert.equal(result.missingProbability,1);
 assert.equal(result.probabilityCoverage,0.5);
 assert.equal(result.excludedByReason.no_decisive_final_result,1);
 const empty=score([],{},{});
 assert.equal(empty.probabilityCoverage,null);
});

test('separates missing frozen picks from invalid probability inputs without inflating coverage',()=>{
 const missing={...bout,bout_id:'3',fighter_a:'c',fighter_b:'d',winner:'c'};
 const invalid={...bout,bout_id:'4',fighter_a:'e',fighter_b:'f',winner:'e'};
 const profiles={...snaps,'3':[{...p,fighter_id:'c'},{...p,fighter_id:'d'}],'4':[{...p,fighter_id:'e'},{...p,fighter_id:'f'}]};
 const predictions={...pred,'4':{winner_id:'e',frozen_at:pred['1'].frozen_at,winner_probability:'0.8'}};
 const result=score([bout,missing,invalid],profiles,predictions);
 assert.equal(result.eligible,3);
 assert.equal(result.scored,1);
 assert.equal(result.missingProbability,2);
 assert.equal(result.missingFrozenPrediction,1);
 assert.equal(result.invalidFrozenProbability,1);
 assert.equal(result.missingFrozenPrediction+result.invalidFrozenProbability,result.missingProbability);
 assert.equal(result.probabilityCoverage,1/3);
 const empty=score([],{},{});assert.equal(empty.missingFrozenPrediction,0);assert.equal(empty.invalidFrozenProbability,0);
});

test('reports Wilson uncertainty for observed reliability rates without claiming calibration',()=>{
 const x=score([bout],snaps,pred);
 assert.equal(x.bins[8].count,1);
 const interval=x.bins[8].observedRateInterval95;
 assert.ok(Array.isArray(interval));
 assert.ok(interval[0]>0 && interval[0]<0.5);
 assert.equal(interval[1],1);
 assert.equal(x.bins[0].observedRateInterval95,null);
 assert.equal(score([],{},{}).bins[8].observedRateInterval95,null);
 assert.equal(x.calibrated,false);
});
