'use strict';
const assert=require('node:assert/strict');
const {probabilities}=require('./audit_nfl_simulator.js');
const engine=require('./game_odds_engine.js');
const game={sport:'NFL',home:'H',away:'A',projectedHome:24,projectedAway:21,
 sample:{homeGames:8,awayGames:8,residualGames:100},residuals:Array.from({length:100},(_,i)=>({homeError:Math.sin(i)*13,awayError:Math.cos(i)*12}))};
const exact=probabilities(game,-3.5,44.5);
const sim=engine.simulate(game,{homeSpread:-3.5,total:44.5},100000,647);
for(const [key,market] of [['home_win','homeML'],['home_cover','homeATS'],['over','over']]){
 const row=sim.markets.find(r=>r.key===market);
 assert.ok(Math.abs(row.win/(1-row.push)-exact[key].conditionalWin)<.01);
}
console.log('Current simulator audit: exact paired bootstrap matches production draws');
