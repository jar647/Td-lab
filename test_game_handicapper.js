'use strict';
const assert=require('node:assert/strict');
const e=require('./game_odds_engine'),h=require('./game_handicapper');
const now=Date.parse('2026-11-01T12:00Z');
const rates={games:7,plays:400,neutral_early_down_pass_rate:.62,fourth_down_go_rate:.4,redzone_td_drive_rate:.6,
 samples:{fourth_down_decisions:10,redzone_drives:20}};
const team=name=>({coach:'Coach '+name,scoring:{season:{games:7,points_per_game:24,points_allowed_per_game:20},last_three:{points_per_game:26},home:{games:4},road:{games:3}},
 usage:{quarterback:{name:'QB '+name}},injuries:{reports:[],official_inactives_confirmed:false},
 injury_news:{current:true,source_updated_at:'2026-11-01T11:30Z',reports:[]},deep_stats:{offense:{season:rates}}});
const model={sport:'NFL',home:'HOME',away:'AWAY',projectedHome:26,projectedAway:22,
 forecastMeta:{modelVersion:e.NFL_MODEL_VERSION,generatedAt:'2026-11-01T11:00Z',kickoffAt:'2026-11-01T18:00Z'},
 scoreInputs:{baselineHome:25,baselineAway:21,homeAdjustment:1,awayAdjustment:1},
 pregameContext:{teams:{HOME:team('HOME'),AWAY:team('AWAY')},research:{season:2026,through_week:7},venue:{roof:'dome'},rest_days:{home:7,away:7}},
 residuals:Array.from({length:100},(_,i)=>({homeError:Math.round(8*Math.sin(i)),awayError:Math.round(7*Math.cos(i))})),
 sample:{homeGames:7,awayGames:7,residualGames:100}};
const market={homeSpread:-3,total:49.5,homeML:-140,awayML:125,homeATS:-110,awayATS:-110,over:-110,under:-110};
const result=e.simulate(model,market,100000,6472026);
const audit={model_version:e.NFL_MODEL_VERSION,status:'EXACT_ENGINE_WALK_FORWARD_UNCALIBRATED',holdout:{markets:{
 homeML:{marketComparison:{games:200,modelBrier:.24,noVigMarketBrier:.22}},homeATS:{marketComparison:{games:200,modelBrier:.26,noVigMarketBrier:.25}},over:{marketComparison:{games:200,modelBrier:.26,noVigMarketBrier:.25}}}}};
const report=h.build(model,result,{audit,now});
assert.equal(report.markets.length,3);
assert.ok(report.markets.every(m=>m.lean&&m.status==='PASS · BENCHMARK NOT BEATEN'));
assert.equal(report.attribution.homeMatchupChange,1);
assert.ok(report.findings.some(f=>f.topic==='Coaching tendencies'));
assert.equal(report.fairHomeSpread,-result.simulated.margin.median);
const changed=e.simulate(model,{...market,homeML:150,awayML:-170},100000,6472026);
const priced=h.build(model,changed,{audit,now});
assert.equal(report.markets[0].lean,priced.markets[0].lean,'Price must not manufacture a new sporting forecast');
assert.notEqual(report.markets[0].bestQuotedEV,priced.markets[0].bestQuotedEV);
const unavailable=structuredClone(model);
unavailable.pregameContext.teams.HOME.injury_news.reports=[{player:'QB HOME',position:'QB',designation:'Out'}];
const qb=h.build(unavailable,result,{audit,now});
assert.ok(qb.risks.some(r=>r.code==='qb-HOME'&&r.severity==='block'));
assert.ok(qb.markets.every(m=>m.status==='PASS · DATA NEEDS REVIEW'));
const future=h.build({...model,forecastMeta:{...model.forecastMeta,generatedAt:'2026-11-02T00:00Z'}},result,{audit,now});
assert.ok(future.risks.some(r=>r.code==='forecast-stale'));
const inplay=h.build(model,result,{audit,now:Date.parse('2026-11-01T19:00Z')});
assert.ok(inplay.risks.some(r=>r.code==='game-started'));
const baseline=h.sensitivity(model,result,0,0);
for(const m of result.markets)assert.ok(Math.abs(baseline[m.key].win-m.win)<.01,'Exact residual enumeration should agree with 100k Monte Carlo');
const shift=h.sensitivity(model,result,2,-2);
assert.ok(shift.homeATS.win>=baseline.homeATS.win);
assert.ok(shift.awayATS.win<=baseline.awayATS.win);
const missing=e.simulate(model,{},1000,1);
assert.equal(h.build(model,missing,{now}).markets[1].status,'LINE NEEDED');
const conflict=structuredClone(model);
conflict.pregameContext.teams.HOME.injuries.reports=[{player:'Some Player',designation:'Questionable',source_updated_at:'2026-11-01T11:00Z'}];
conflict.pregameContext.teams.HOME.injury_news.reports=[{player:'Some Player',designation:'Out'}];
assert.ok(h.build(conflict,result,{now}).risks.some(r=>r.code.startsWith('conflict-')));
console.log('Game handicapper: independent predictions/pricing, sourced uncertainty, benchmark gates, injury conflicts and sensitivity PASS');
