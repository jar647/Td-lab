'use strict';
const assert=require('node:assert/strict');
const e=require('./scripts/nba_ensemble_audit');
const version='nba-possession-audit-v3';
const base=Date.parse('2026-10-01T19:00:00Z'),day=24*3600000;
const make=(id,adjust={})=>({
 game_id:String(id),model:version,locked_at:new Date(base+id*day-3600000).toISOString(),
 tipoff:new Date(base+id*day).toISOString(),home:120,away:100,
 baseline:{home:110,away:108,homeWin:.55},
 grade:{home:108,away:110},
 ...adjust
});
const games=Array.from({length:20},(_,i)=>make(i));
const input=JSON.stringify(games);
assert.deepEqual(e.WEIGHTS,[0,.25,.5,.75,1]);
const values=e.variants(games[0]);
assert.equal(values.status,'SHADOW_ONLY');
assert.equal(values.approved,false);
assert.deepEqual(values.scores.map(x=>x.baseline_weight),e.WEIGHTS);
assert.deepEqual(values.scores.map(x=>x.home),[120,117.5,115,112.5,110]);
assert.deepEqual(values.scores.map(x=>x.away),[100,102,104,106,108]);
assert.equal(JSON.stringify(games),input,'The recipe must not mutate the frozen record');
assert.deepEqual(e.variants({...games[0],grade:{home:999,away:0}}),values,'No outcome can enter a pregame blend');
assert.equal(e.variants({...games[0],rotation_fallback:{reason:'short lineup'}}),null);
assert.equal(e.variants({...games[0],locked_at:games[0].tipoff}),null);
assert.equal(e.variants({...games[0],baseline:{home:null,away:100}}),null);

const report=e.evaluate(games,version);
assert.equal(report.approved,false);
assert.equal(report.graded_games,20);
assert.equal(report.retrospective.weights.length,5);
assert.equal(report.retrospective.weights[0].games,20);
assert.equal(report.frozen.weights[0].games,0,'Historical arithmetic must NOT claim prospective validation');
assert.equal(report.retrospective.weights[0].margin_mae,22);
assert.equal(report.retrospective.weights[4].margin_mae,4);
assert(report.retrospective.weights[2].margin_mae<report.retrospective.weights[0].margin_mae);
assert(report.retrospective.weights[2].total_mae<report.retrospective.weights[0].total_mae);
assert.equal(report.disagreement.reduce((s,x)=>s+x.raw.games,0),20);
assert.equal(JSON.stringify(games),input,'Evaluation never rewrites prior game records');

const latest={...games[0],locked_at:new Date(base-1800000).toISOString(),home:122};
assert.equal(e.onePerGame([...games,latest],version).length,20,'Revisions count once per matchup');
assert.equal(e.onePerGame([...games,latest],version).find(x=>x.game_id==='0').home,122,'Use latest valid pregame revision');
assert.equal(e.onePerGame([...games,{...games[0],model:'previous-v1',game_id:'old-model'}],version).length,20);
assert.equal(e.onePerGame([...games,{...games[0],game_id:'late',locked_at:games[0].tipoff}],version).length,20);

const frozen=games.map(x=>({...x}));
frozen[19]={...frozen[19],ensemble_shadow:e.variants(frozen[19])};
let withProspective=e.evaluate(frozen,version);
assert.equal(withProspective.frozen.weights[2].games,1);
assert.equal(withProspective.frozen.weights[2].margin_mae,13);
assert.equal(withProspective.frozen.weights[2].total_mae,1);
assert.equal(withProspective.frozen.weights[0].total_mae,2);
assert.equal(withProspective.frozen.weights[0].margin_mae,22);
const modified=structuredClone(frozen);
modified[19].ensemble_shadow.scores[2].home=999;
assert.equal(e.evaluate(modified,version).frozen.weights[0].games,0,'Reject tampered or inconsistently generated variants');
assert.equal(e.evaluate([...games,{...make(20),rotation_fallback:{reason:'unsure'}}],version).graded_games,20);
console.log('NBA frozen ensemble: static weights, no outcome leakage, pregame-only locks, revision dedup, fixed-series MAE, disagreement segments and prospective capture verification PASS');
