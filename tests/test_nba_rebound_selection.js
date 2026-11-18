'use strict';
const assert=require('node:assert/strict');
const {compare}=require('../scripts/compare_nba_projection_audits');
const {summarize}=require('../scripts/audit_nba_rebound_selection');
function fixture(error=1){
 const observations=[];
 for(const fold of ['development','validation'])for(let g=0;g<12;g++)for(let p=0;p<2;p++)for(const market of ['points','rebounds','assists','minutes']){
  observations.push({game:fold+'-'+g,playerId:'p-'+p,player:'Player '+p,market,fold,active:true,actual:10,prediction:10+error,baseline:10+.5});
 }
 return {model:'fixture-v1',runs:1000,splitDate:'2026-11-01',sourceGeneratedAt:'2026-11-17T00:00:00Z',observations,
  folds:{validation:{gameTotals:{points:{predicted:220,actual:220}}}},limitations:'Fixture audit'};
}
const before=fixture(),same=fixture();
assert.equal(compare(before,same).passed,false,'Equality must not become historic rebound improvement');
const equal=compare(before,same,{mode:'non_regression'});assert(equal.passed);assert.equal(equal.promotionEligible,false);
assert.equal(equal.comparisonMode,'non_regression');assert.match(equal.engineeringLimits,/equality does not establish historical superiority/);
assert(compare(before,fixture(.9)).passed,'The original strict improvement mode remains usable');
for(const [market,regressedError] of [['points',1.11],['assists',1.06],['minutes',1.11]]){
 const strictRegression=fixture(.9);strictRegression.observations.filter(r=>r.fold==='validation'&&r.market===market).forEach(r=>{r.prediction=10+regressedError});
 assert(!compare(before,strictRegression).passed,'The original '+market+' tolerance must remain enforced');
}
for(const market of ['points','rebounds','assists','minutes']){
 const worse=structuredClone(same);worse.observations.find(r=>r.fold==='validation'&&r.market===market).prediction+=.00001;
 assert.equal(compare(before,worse,{mode:'non_regression'}).passed,false,'Even a small '+market+' regression must fail');
}
const bad=structuredClone(same);bad.observations.find(r=>r.fold==='validation').prediction=NaN;assert(!compare(before,bad,{mode:'non_regression'}).passed);
const duplicate=structuredClone(same);duplicate.observations.push(duplicate.observations.find(r=>r.fold==='validation'));assert(!compare(before,duplicate,{mode:'non_regression'}).passed);
const mismatch=structuredClone(same);mismatch.observations.find(r=>r.fold==='validation').actual=20;assert(!compare(before,mismatch,{mode:'non_regression'}).passed);
const missing=structuredClone(same);missing.observations.splice(missing.observations.findIndex(r=>r.fold==='validation'),1);assert(!compare(before,missing,{mode:'non_regression'}).passed,'Dropping a difficult prediction cannot pass as unchanged coverage');
assert(!compare(before,{...same,runs:2000},{mode:'non_regression'}).passed,'Compare the same number of seeded draws');
assert.throws(()=>compare(before,same,{mode:'relaxed'}),/Unknown/);
const sparse=fixture();sparse.observations=sparse.observations.filter(r=>r.fold==='development'||r.game==='validation-0');assert(!compare(sparse,sparse,{mode:'non_regression'}).passed);
const sparseRebounds=fixture();sparseRebounds.observations=sparseRebounds.observations.filter(r=>r.market!=='rebounds'||r.fold==='development'||r.game==='validation-0');assert(!compare(sparseRebounds,sparseRebounds,{mode:'non_regression'}).passed,'Other markets cannot supply the missing rebound game count');
const source=JSON.stringify(before),report=summarize(before,same,{sourceEvidence:{baseSha:'base',headSha:'head'}});
assert.equal(report.status,'UNVALIDATED_NO_CONFIDENCE_PROMOTION');assert.equal(report.recommendationChangesApproved,false);assert.equal(report.probabilitiesCalibrated,false);
assert.equal(report.markets.rebounds.validation.beatsRecentAverage,false);assert.equal(report.markets.rebounds.validation.evidenceStatus,'RECENT_AVERAGE_BASELINE_NOT_BEATEN');
assert.equal(report.legacyComparison.strictBenchmarkPassed,false);assert.equal(report.legacyComparison.reboundMaeImproved,false);
assert.deepEqual(report.sourceEvidence,{baseSha:'base',headSha:'head'});assert.equal(JSON.stringify(before),source);
assert.deepEqual(report.markets,summarize(before,same).markets,'Cluster resampling is reproducible');
const larger=fixture();larger.observations=larger.observations.concat(structuredClone(larger.observations).map(r=>({...r,playerId:r.playerId+'-other'})));
const grouped=summarize(larger,same);assert.equal(grouped.markets.rebounds.validation.games,12);assert.equal(grouped.markets.rebounds.validation.playerGames,48);
assert.deepEqual(grouped.markets.rebounds.validation.gameClusterInterval95,report.markets.rebounds.validation.gameClusterInterval95,'Duplicated exposure within games is not an independent game sample');
const developmentMutation=structuredClone(before);developmentMutation.observations.filter(r=>r.fold==='development').forEach(r=>{r.prediction=999});
assert.deepEqual(summarize(developmentMutation,same).markets.rebounds.validation,report.markets.rebounds.validation,'Validation statistics remain separate from development observations');
console.log('NBA rebound audit: strict historical gate, zero-tolerance base regression, market baselines, game-cluster uncertainty and no confidence promotion PASS');
