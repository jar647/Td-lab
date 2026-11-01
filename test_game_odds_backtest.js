'use strict';
const assert=require('node:assert/strict');
const e=require('./game_odds_engine.js'),{audit}=require('./game_odds_backtest.js');
const version=e.NFL_MODEL_VERSION;
const history=Array.from({length:45},(_,i)=>({game_id:'history-'+i,model_version:version,season:2024,week:5+i%3,
 home:'H',away:'A',home_games:5,away_games:5,projected_home:21,projected_away:17,actual_home:21,actual_away:17}));
const target={game_id:'target',model_version:version,season:2025,week:5,home:'H',away:'A',home_games:4,away_games:4,
 projected_home:21,projected_away:17,actual_home:21,actual_away:17};
const backtest={model_version:version,records:[...history,target]};
const market={model_version:version,records:[{game_id:'target',market_home_spread:-4,market_total:38,
 home_moneyline:-150,away_moneyline:130,home_spread_odds:-110,away_spread_odds:-110,over_odds:-110,under_odds:-110}]};
const report=audit(backtest,market,{count:1000});
const r=report.records.find(r=>r.game_id==='target');
assert.equal(r.markets.homeATS.push,1);
assert.equal(r.markets.homeATS.outcome,'push');
assert.equal(r.markets.over.outcome,'push');
assert.equal(r.markets.homeML.win,1);
assert.equal(report.holdout.markets.homeATS.brier,null,'Pushes excluded from conditional binary Brier');
assert.equal(report.holdout.markets.homeATS.threeOutcomeBrier,0,'Pushes graded in three-outcome Brier');
const changed=structuredClone(backtest);
changed.records.find(r=>r.game_id==='target').actual_home=90;
changed.records.push({...target,game_id:'same-week',actual_home:90});
changed.records.push({...target,game_id:'future-week',week:6,actual_home:90});
const altered=audit(changed,market,{count:1000}).records.find(r=>r.game_id==='target');
assert.equal(altered.markets.homeML.win,r.markets.homeML.win,'Target/same-week/future outcomes cannot affect prediction');
assert.equal(altered.sample.residualGames,r.sample.residualGames);
assert.throws(()=>audit({...backtest,model_version:'old'},market,{count:1000}),/current model/);
assert.throws(()=>audit({...backtest,records:[...backtest.records,target]},market,{count:1000}),/Duplicate/);
assert.throws(()=>e.nflGame({model_version:'old'},backtest),/unavailable|version mismatch/);
assert.equal(report.skipped.length,45,'Warm-up weeks excluded until earlier residual history exists');
console.log('Exact-engine audit: leakage exclusion, push settlement, model versions and warm-up coverage PASS');
