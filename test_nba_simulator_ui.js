'use strict';
const assert=require('node:assert/strict');
const ui=require('./nba_simulator_ui.js');
const model={home:'Home',away:'Away',possessionModel:{inputTimes:{games:'2026-11-06',injuries:'2026-11-06',rosters:'2026-11-06'}}};
const result={simulated:{home:111,away:109},possession:{pace:98,baseline:{home:113,away:112},rotation:{Home:{pace:99,games:8,rest:2,venueChanged:false,minutes:{a:120,b:120},absent:[]},Away:{pace:97,games:7,rest:1,venueChanged:true,minutes:{a:120,b:120},absent:['Example Player']}},uncertain:[],overtimeRate:0,blowoutRate:0,players:[],legs:[]},market:{total:null,homeSpread:null}};
const html=ui.detail(result,model);
for(const phrase of ['Simulation audit','Modeled possessions','98.0','220.0','Historical scoring baseline','combined -5.0','Example Player','uncalibrated'])assert.ok(html.includes(phrase),phrase);
assert.ok(!html.includes('verified injury effect'));
assert.match(html,/240\.0 allocated regulation minutes/);
result.possession.rotation.Home.players=[null,{name:'Player <A>',defenderExposure:{b:{name:'Defender & B',weight:.7}},matchupSample:12}];
const tracking=ui.detail(result,model);
assert.match(tracking,/Player &lt;A&gt; · estimated defender mixture: Defender &amp; B/);

// Execute the production button handler, including its optional-odds worker path.
const fs=require('node:fs'),vm=require('node:vm');
const page=fs.readFileSync('nba.html','utf8');
const handler=page.slice(page.indexOf('async function runNBASimulation(){'),page.indexOf('\nfunction num(v)'));
const elements=new Map();
function el(id){if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',textContent:'',disabled:false});return elements.get(id)}
const state={tip:Date.now()+3600000,feedAt:Date.now(),upgraded:model};
let worker,sent,refreshFails=false;
class Worker{constructor(){worker=this}postMessage(data){sent=data}terminate(){}}
const timers=new Map();let timerId=0;
const sandbox={Date,console,$:el,esc:x=>String(x),oddsFormat:'american',fromOdds:()=>null,
 simulatorStats:state,simulatorGame:{home:'Home',away:'Away'},nbaSimBusy:false,nbaSimRequest:0,nbaSimWorker:null,
 historicalGames:[],generatedAt:new Date().toISOString(),injuryData:{},rosterData:{},nbaGameContext:{},
 CookNBAPossessions:{},CookNBASimulatorUI:ui,nbaSimulatorReport:null,Worker,
 CookNBALiveContext:{latest:async()=>{if(refreshFails)throw Error('Refresh failed');return {context:{},injuries:{}}}},
 CookGameOdds:{nbaGame:()=>model,marketInput:()=>{}},
 setTimeout:fn=>{timers.set(++timerId,fn);return timerId},clearTimeout:id=>timers.delete(id)};
vm.createContext(sandbox);vm.runInContext(handler,sandbox);
(async()=>{
 delete sandbox.CookNBASimulatorUI;
 await sandbox.runNBASimulation();
 assert.match(el('sim-results').innerHTML,/simulation display could not load/);
 sandbox.CookNBASimulatorUI=ui;refreshFails=true;
 await sandbox.runNBASimulation();
 assert.match(el('sim-results').innerHTML,/Refresh failed/);
 assert.equal(sandbox.nbaSimBusy,false,'Failed refresh must release a previous upgraded model');
 assert.equal(el('run-sim').disabled,false);
 refreshFails=false;
 await sandbox.runNBASimulation();
 assert.ok(sent,'No-odds simulation must reach the worker');
 assert.equal(sent.market.total,null);assert.equal(sent.market.homeSpread,null);
 assert.equal(sandbox.nbaSimBusy,true);assert.equal(el('run-sim').disabled,true);
 worker.onmessage({data:{requestId:sent.requestId,progress:{completed:500,total:10000}}});assert.match(el('sim-results').textContent,/500 \/ 10,000/);assert.equal(sandbox.nbaSimBusy,true,'Progress must not complete the run');
 const complete={...result,runCount:10000,markets:[],simulated:{...result.simulated,homeWin:.55,awayWin:.45,margin:{p10:-10,p90:12},total:{p10:200,p90:240}}};
 worker.onmessage({data:{requestId:sent.requestId,result:complete}});
 assert.match(el('sim-results').innerHTML,/Simulation Results · 10,000 runs/);
 assert.match(el('sim-results').innerHTML,/Simulation audit/);
 assert.equal(sandbox.nbaSimBusy,false);assert.equal(el('run-sim').disabled,false);
 await sandbox.runNBASimulation();
 worker.onerror({message:'Worker unavailable'});
 assert.match(el('sim-results').innerHTML,/Worker unavailable/);
 assert.equal(sandbox.nbaSimBusy,false);assert.equal(el('run-sim').disabled,false);
 model.rotationFallback={reason:'Team <A>: unresolved availability'};
 let saves=0;sandbox.localStorage={getItem:()=>null,setItem:()=>{saves++}};
 await sandbox.runNBASimulation();
 worker.onmessage({data:{requestId:sent.requestId,result:{...complete,possession:null}}});
 assert.match(el('sim-results').innerHTML,/Team-score history simulation/);
 assert.match(el('sim-results').innerHTML,/Team &lt;A&gt;/);
 assert.doesNotMatch(el('sim-results').innerHTML,/Possessions \+ player rotations|Your frozen simulations/);
 assert.equal(saves,0,'Team-score fallback must not enter the possession forecast archive');
 assert.equal(el('run-sim').disabled,false);
 console.log('NBA simulation UI: audit, optional tracking, no-odds button, load/refresh/worker failure recovery PASS');
})().catch(error=>{console.error(error);process.exitCode=1});


// Regression: grading cannot match a different fixture or a rescheduled tipoff.
{
 const memory={data:{},getItem(k){return this.data[k]||null},setItem(k,v){this.data[k]=v}};
 const t=Date.parse('2026-11-12T00:00:00Z');
 const make=(id,at)=>({id,gameId:'same',home:'Home',away:'Away',tipoff:'2026-11-12T00:00:00Z',lockedAt:at,projection:{home:110,away:100,homeWin:.7,margin:{p10:-20,p90:20},total:{p10:190,p90:240}},prices:[],market:{},grade:null});
 memory.setItem('nba-possession-forecast-locks-v1',JSON.stringify([make('early','2026-11-11T19:00:00Z'),make('late','2026-11-11T23:00:00Z')]));
 const game={id:'same',home:'Home',away:'Away',date:'2026-11-12T00:00:00Z',status:'STATUS_FINAL',players:[...Array.from({length:5},(_,i)=>({team:'Home',stats:{PTS:20}})),...Array.from({length:5},(_,i)=>({team:'Away',stats:{PTS:18}}))]};
 for(const altered of [{...game,home:'Other'},{...game,date:'2026-11-13T00:00:00Z'}]){
  assert.equal(ui.grade({games:[altered]},memory,t+3600000).graded,0);
  assert.ok(JSON.parse(memory.getItem('nba-possession-forecast-locks-v1')).every(x=>!x.grade));
 }
 assert.equal(ui.grade({games:[game]},memory,t+3600000).graded,1,'Multiple pretip captures count as one game');
 const graded=JSON.parse(memory.getItem('nba-possession-forecast-locks-v1'));
 assert.ok(graded.every(x=>x.grade),'Only matching fixture may be graded');
 assert.equal(graded[0].grade.home,100);
}
