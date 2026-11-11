'use strict';
const assert=require('node:assert/strict');
const ui=require('./nba_simulator_ui.js');
const values=new Map(),storage={getItem:key=>values.get(key)||null,setItem:(key,val)=>values.set(key,val)};
const tip='2026-12-10T23:00:00.000Z',pregame=Date.parse(tip)-3600000;
const model={sport:'NBA',id:'ledger-test-game',home:'Home',away:'Away',date:tip,
 baseline:{home:112,away:99},possessionModel:{teams:{Home:{points:112},Away:{points:99}},pace:98,inputTimes:{games:'2026-12-10T18:00Z'}}};
const result={possession:{model:'nba-possession-audit-v3',baseline:{home:112,away:99}},
 simulated:{home:118,away:100,homeWin:.65,margin:{p10:-8,p90:25},total:{p10:200,p90:245}},
 market:{homeSpread:-5.5,total:222.5},
 markets:[{key:'homeML',price:-175},{key:'awayML',price:150},{key:'homeATS',price:-105},{key:'awayATS',price:-115},{key:'over',price:-110},{key:'under',price:-110}]};
assert.equal(ui.capture(result,model,storage,pregame).saved,true);
const original=JSON.parse(storage.getItem(ui.KEY))[0];
assert.equal(original.ensemble.version,'nba-device-forward-ensemble-v1');
assert.deepEqual(original.ensemble.scores.map(x=>x.baselineWeight),[0,.5,.75,1]);
assert.equal(original.ensemble.scores[1].home,115);
assert.equal(original.ensemble.scores[2].home,113.5);
assert.equal(original.market.total,222.5);
assert.equal(original.prices.find(x=>x.key==='homeML').price,-175);
assert.equal(ui.capture(result,model,storage,pregame+3000).existing,true);
assert.deepEqual(JSON.parse(storage.getItem(ui.KEY))[0],original,'A duplicate cannot rewrite a frozen quote or projection');
assert.equal(ui.capture(result,model,storage,Date.parse(tip)+1000).saved,false,'No post-tipoff capture');

const makePlayers=(team,points)=>Array.from({length:5},(_,i)=>({team,stats:{PTS:String(i===4?points-4*10:10)}}));
const game={id:model.id,home:model.home,away:model.away,date:tip,status:'STATUS_FINAL',
 players:[...makePlayers('Home',110),...makePlayers('Away',105)]};
const feed={games:[game],generated_at:'2026-12-11T06:00:00.000Z'};
assert.equal(ui.grade(feed,storage,pregame).graded,0,'No final score before tipoff');
const graded=ui.grade(feed,storage,Date.parse(tip)+7*3600000);
assert.equal(graded.graded,1);
assert.equal(graded.ensemble.games,1);
assert.equal(graded.ensemble.quotedGames,1);
const w50=graded.ensemble.weights.find(x=>x.baselineWeight===.5),w75=graded.ensemble.weights.find(x=>x.baselineWeight===.75);
assert.equal(w50.games,1);
assert.equal(w50.ats.losses,1);
assert.equal(w50.total.wins,1);
assert.equal(w75.total.wins,1);
assert.equal(w75.ats.losses,1);
assert.equal(w50.marginMAE,10.5);
assert.equal(w50.totalMAE,.5);
assert.equal(w50.total.hitRate,1);
assert.deepEqual(JSON.parse(storage.getItem(ui.KEY))[0].ensemble,original.ensemble,'Grading must not modify frozen predictions');

const csv=ui.exportCSV(storage);
assert.match(csv,/"ledger-test-game"/);
assert.match(csv,/222\.5/);
assert.match(csv,/-175/);
assert.match(csv,/blend75_home/);
assert.match(csv,/"LOSS","WIN"/);
assert.equal(csv.trim().split('\n').length,2,'One capture must export exactly one data row');

const noMarket={...result,market:{homeSpread:null,total:null},markets:[]};
const model2={...model,id:'ledger-no-lines',possessionModel:{...model.possessionModel,pace:97}};
ui.capture(noMarket,model2,storage,pregame);
const secondGame={...game,id:model2.id};
const graded2=ui.grade({games:[game,secondGame],generated_at:feed.generated_at},storage,Date.parse(tip)+8*3600000);
assert.equal(graded2.ensemble.games,2);
assert.equal(graded2.ensemble.quotedGames,1,'Missing spread and total cannot be treated as zero lines');
assert.equal(graded2.ensemble.weights[1].ats.gamesWithLean,1);
assert.equal(graded2.ensemble.weights[1].total.gamesWithLean,1);
assert.equal(ui.marketGrade({market:{homeSpread:null,total:null},grade:{home:110,away:105}},{home:115,away:99.5}).ats,'NO LINE');
assert.equal(ui.marketGrade({market:{homeSpread:-5,total:215},grade:{home:110,away:105}},{home:115,away:99.5}).ats,'PUSH');
assert.equal(ui.marketGrade({market:{homeSpread:-5,total:215},grade:{home:110,away:105}},{home:115,away:99.5}).total,'PUSH');
assert.match(ui.localValidation(graded2),/hypothetical spread leans/);
assert.match(ui.localValidation(graded2),/2 completed games|2 graded frozen games/i);
const tampered=JSON.parse(storage.getItem(ui.KEY));tampered[0].ensemble.scores[1].home=999;
assert.equal(ui.frozenBlend(tampered[0]),null,'Tampered on-device blends are never credited as genuinely frozen');
assert.equal(ui.gradedEnsemble([tampered[0]]).games,0);
console.log('NBA forward market ledger: pregame quotes, two model blends, outcome grading, missing prices, pushes, immutable capture and CSV PASS');
