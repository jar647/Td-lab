/* Dedicated game-odds page: markup, executable controller and 100k flow. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const engine=require('./game_odds_engine.js');
const html=fs.readFileSync('game-odds.html','utf8');
assert.ok(html.includes('<script src="./game_odds_engine.js"></script>'));
assert.ok(html.includes("new Worker('./game_odds_worker.js')"));
for(const field of ['game','homeML','awayML','homeSpread','homeATS','awayATS','total','over','under','run','results','sportNFL','sportNBA'])
 assert.ok(html.includes('id="'+field+'"'),'Missing '+field);
assert.ok(html.indexOf('id="game"')<html.indexOf('id="homeML"'),'Game selector must appear before odds');
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).filter(Boolean);
assert.equal(scripts.length,1,'The controller must exist');
new vm.Script(scripts[0],{filename:'game-odds-controller.js'});
const elements=new Map(),store=new Map();
function el(id){if(!elements.has(id))elements.set(id,{
 value:'',innerHTML:'',textContent:'',hidden:false,disabled:false,onclick:null,onchange:null,
 classList:{toggle(){}},addEventListener(){},scrollIntoView(){}
});return elements.get(id);}
const backtest={records:Array.from({length:135},(_,i)=>({
 season:i<110?2024:2025,week:5+i%10,projected_home:22,projected_away:20,
 actual_home:22+Math.round(8*Math.sin(i)),actual_away:20+Math.round(9*Math.cos(i))
}))};
const feed={season:2026,week:8,generated_at:new Date().toISOString(),model_version:'score-baseline-v1',games:[{
 game_id:'2026_08_A_B',home:'B',away:'A',gameday:'2099-11-01',
 projected_home_points:25,projected_away_points:22,
 model_inputs:{home:{games:7,offense:25,defense_allowed:23},away:{games:7,offense:22,defense_allowed:26}}
}]};
feed.games[0].model_inputs.research_context={teams:{},rest_days:{home:7,away:7},
 venue:{name:'Lambeau Field',roof:'outdoors',surface:'grass'},
 travel:{available:true,air_distance_miles:600,estimated_flight_hours:2.2,warning:'Estimate only.'},
 weather:{available:true,source:'National Weather Service hourly forecast',forecast_time:'2026-11-01T13:00:00-06:00',
  temperature_f:45,wind_mph:12,wind_direction:'NW',precipitation_probability:20,condition:'Light Rain'},source_note:'Public feeds.'};
const sandbox={document:{getElementById:el},location:{search:'?sport=NFL'},URLSearchParams,Intl,Date,setTimeout,console,
 CookGameOdds:engine,
 localStorage:{getItem:key=>store.get(key)||null,setItem:(key,v)=>store.set(key,v)},
 fetch:async url=>({ok:true,json:async()=>String(url).includes('game_picks_backtest')?backtest:
 String(url).includes('game_picks')?feed:String(url).includes('nba_injuries')?null:{games:[]}})
};
vm.createContext(sandbox);vm.runInContext(scripts[0],sandbox,{timeout:5000});
(async()=>{
 await new Promise(resolve=>setTimeout(resolve,60));
 assert.match(el('game').innerHTML,/A @ B/,'NFL should load from current slate');
 el('game').value='2026_08_A_B';el('game').onchange();
 assert.equal(el('marketCard').hidden,false,'The sportsbook fields must open after game selection');
 el('homeML').value='-125';el('awayML').value='+110';
 el('homeSpread').value='-3.5';el('homeATS').value='-110';el('awayATS').value='-110';
 el('total').value='45.5';el('over').value='-115';el('under').value='-105';
 el('run').onclick();
 for(let attempt=0;attempt<30&&el('results').hidden;attempt++)await new Promise(resolve=>setTimeout(resolve,100));
 assert.equal(el('results').hidden,false,'The 100k simulation must render');
 assert.match(el('results').innerHTML,/100,000 full-game simulations/);
 assert.match(el('results').innerHTML,/Over 45.5/);
 assert.match(el('results').innerHTML,/RESEARCH ONLY/);
 assert.match(el('results').innerHTML,/No bet is verified/);
 assert.match(el('results').innerHTML,/Spread warning/);
 assert.match(el('results').innerHTML,/no verified historical spread outcomes for an ATS backtest/i);
 assert.match(el('results').innerHTML,/PASS · ATS NOT BACKTESTED/);
 assert.match(el('results').innerHTML,/National Weather Service hourly forecast/);
 assert.match(el('results').innerHTML,/Light Rain/);
 console.log('Game Odds UI: game -> book lines -> 100k simulations -> research-only results PASS');
})().catch(err=>{console.error(err);process.exitCode=1});
