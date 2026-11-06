'use strict';
const assert=require('node:assert/strict');
const ui=require('./nba_simulator_ui.js');
const model={home:'Home',away:'Away',possessionModel:{inputTimes:{games:'2026-11-06',injuries:'2026-11-06',rosters:'2026-11-06'}}};
const result={simulated:{home:111,away:109},possession:{pace:98,baseline:{home:113,away:112},rotation:{Home:{pace:99,games:8,rest:2,venueChanged:false,minutes:{a:120,b:120},absent:[]},Away:{pace:97,games:7,rest:1,venueChanged:true,minutes:{a:120,b:120},absent:['Example Player']}},uncertain:[],overtimeRate:0,blowoutRate:0,players:[],legs:[]},market:{total:null,homeSpread:null}};
const html=ui.detail(result,model);
for(const phrase of ['Simulation audit','Modeled possessions','98.0','220.0','Historical scoring baseline','combined -5.0','Example Player','uncalibrated'])assert.ok(html.includes(phrase),phrase);
assert.ok(!html.includes('verified injury effect'));
console.log('NBA simulation audit UI passed');
