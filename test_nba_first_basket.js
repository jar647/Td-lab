'use strict';
const assert=require('node:assert/strict'),{analyze}=require('./nba_first_basket.js');
const now=Date.parse('2026-10-30T12:00Z'),game={id:'target',away:'A',home:'B',date:'2026-10-31T00:00Z',status:'STATUS_SCHEDULED'};
const starters=Object.fromEntries(['A','B'].map(t=>[t,Array.from({length:5},(_,i)=>({id:t+i,name:t+i,injury:{status:'NOT LISTED'}}))]));
const history=Array.from({length:6},(_,i)=>({id:''+i,home:'A',away:'B',date:'2026-10-'+(20+i)+'T00:00Z',status:'STATUS_FINAL',season_type:2,first_basket:{available:true,first_game:{team:i%2?'A':'B',player_id:i%2?'A0':'B0'},first_by_team:{A:{player_id:'A0'},B:{player_id:i%2?'B0':'B1'}}}}));
let r=analyze(game,history,starters,{now,injuryFresh:true,rosterFresh:true});
assert(r.available);assert.equal(r.rows[0].name,'A0');assert.equal(r.rows.length,10);assert(r.otherProbability>0);assert(r.rows.reduce((s,p)=>s+p.probability,0)<=1);
assert.equal(analyze(game,[...history,...history],starters,{now}).rows[0].games,6);
assert(!analyze(game,history.slice(0,2),starters,{now}).available);
assert(!analyze({...game,status:'STATUS_FINAL'},history,starters,{now}).available);
assert(!analyze(game,history.map(x=>({...x,date:'2027-01-01'})),starters,{now}).available);
starters.A[0].injury.status='OUT';r=analyze(game,history,starters,{now});assert(!r.rows.some(p=>p.id==='A0'));assert.match(r.reason,/stale/);
console.log('NBA first-basket evidence, normalization, injuries, duplicate games and pregame cutoff PASS');

// Daily top-five board: current rosters, opening sequences and strict data gates.
const fs=require('node:fs'),vm=require('node:vm'),engine=require('./nba_first_basket.js');
const boardNow=Date.parse('2026-11-11T17:00:00Z'),iso=x=>new Date(x).toISOString();
const boardRosters={generated_at:iso(boardNow),teams:{},players:{}},boardInjuries={generated_at:iso(boardNow),status:'ok',injuries:[]},boardGames=[];
for(let pair=0;pair<3;pair++){
 const home='H'+pair,away='V'+pair;
 for(const team of [home,away]){boardRosters.teams[team]=Array.from({length:5},(_,i)=>team+i);for(const id of boardRosters.teams[team])boardRosters.players[id]={name:id,team,position:'PG'};}
 for(let i=0;i<6;i++)boardGames.push({id:'past-'+pair+'-'+i,home,away,date:iso(boardNow-(i+1)*86400000),status:'STATUS_FINAL',season_type:2,
  players:[home,away].flatMap(team=>boardRosters.teams[team].map(id=>({id,name:id,team,starter:true,stats:{MIN:'30'}}))),
  first_basket:{available:true,first_game:{team:i%2?home:away,player_id:(i%2?home:away)+'0'},first_by_team:{[home]:{player_id:home+'0'},[away]:{player_id:away+'0'}}}});
 boardGames.push({id:'next-'+pair,home,away,date:iso(boardNow+6*3600000),status:'STATUS_SCHEDULED'});
}
const boardFeed={generated_at:iso(boardNow),games:boardGames};
const board=engine.slate(boardFeed,boardRosters,boardInjuries,boardNow);
assert.equal(board.upcomingGames,3);assert.equal(board.analyzedGames,3);assert.equal(board.picks.length,5);assert.equal(new Set(board.picks.map(p=>p.id)).size,5);
assert(board.picks.every((p,i,a)=>p.firstGame===3&&p.firstTeam===6&&p.games===6&&(!i||a[i-1].probability>=p.probability)));
assert.deepEqual(engine.slate({...boardFeed,odds:999,impliedProbability:.99},boardRosters,boardInjuries,boardNow),board,'Prices never change first-basket rankings');
assert.deepEqual(engine.slate({...boardFeed,games:[...boardGames,...boardGames]},boardRosters,boardInjuries,boardNow),board,'Duplicate games never inflate samples or ranks');
for(const input of [null,{...boardInjuries,generated_at:'2000-01-01'},{...boardInjuries,status:'unavailable'}])assert.equal(engine.slate(boardFeed,boardRosters,input,boardNow).picks.length,0);
assert.equal(engine.slate({...boardFeed,generated_at:'2000-01-01'},boardRosters,boardInjuries,boardNow).picks.length,0);
assert.equal(engine.slate(boardFeed,{...boardRosters,generated_at:'2000-01-01'},boardInjuries,boardNow).picks.length,0);
const futureTip={...boardFeed,games:boardGames.map(g=>g.status==='STATUS_SCHEDULED'?{...g,date:iso(boardNow+30*3600000)}:g)};
assert.equal(engine.slate(futureTip,boardRosters,boardInjuries,boardNow).upcomingGames,0,'Tomorrow does not enter today’s board');
const started={...boardFeed,games:boardGames.map(g=>g.status==='STATUS_SCHEDULED'?{...g,date:iso(boardNow-1)}:g)};
assert.equal(engine.slate(started,boardRosters,boardInjuries,boardNow).picks.length,0);
const close={...boardFeed,games:boardGames.map(g=>g.status==='STATUS_SCHEDULED'?{...g,date:iso(boardNow+3600000)}:g)};
assert.equal(engine.slate(close,boardRosters,{...boardInjuries,generated_at:iso(boardNow-16*60000)},boardNow).picks.length,0);
const questionable={...boardInjuries,injuries:[{player_id:'H00',status:'QUESTIONABLE'}]};
const held=engine.slate(boardFeed,boardRosters,questionable,boardNow);assert.equal(held.analyzedGames,2);assert(!held.picks.some(p=>p.game.id==='next-0'));
const unverified={...boardFeed,games:boardGames.map(g=>g.status==='STATUS_FINAL'?{...g,first_basket:{available:true}}:g)};
assert.equal(engine.slate(unverified,boardRosters,boardInjuries,boardNow).picks.length,0,'Corrupt opening evidence fails closed');
const thin={...boardFeed,games:boardGames.filter(g=>g.status!=='STATUS_FINAL'||g.id.endsWith('-0')||g.id.endsWith('-1'))};
assert.equal(engine.slate(thin,boardRosters,boardInjuries,boardNow).picks.length,0,'Two games never invent sufficient samples');
const easternNow=Date.parse('2026-11-12T02:00:00Z'),easternGames=boardGames.map(g=>g.status==='STATUS_SCHEDULED'?{...g,date:iso(easternNow+(g.id==='next-0'?1:10)*3600000)}:g);
assert.equal(engine.slate({generated_at:iso(easternNow),games:easternGames},{...boardRosters,generated_at:iso(easternNow)},{...boardInjuries,generated_at:iso(easternNow)},easternNow).upcomingGames,1,'Use the Eastern calendar day across UTC midnight');

// Scan button and Quick Slip behavior use the same real board builder.
const source=fs.readFileSync('nba.html','utf8'),script=source.match(/<script>([\s\S]*?)<\/script>/)[1],elements=new Map();
const el=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',value:'',disabled:false});return elements.get(id)};
let saved;
class FixedDate extends Date{static now(){return boardNow}}
const context={Date:FixedDate,document:{getElementById:el},fetch:async()=>({ok:false}),console,CookNBAFirstBasket:engine,CookItUpQuickSlip:{add:p=>{saved=p}}};vm.createContext(context);vm.runInContext(script,context);
context.fixtureFeed=boardFeed;context.fixtureRosters=boardRosters;context.fixtureInjuries=boardInjuries;
vm.runInContext('historicalGames=fixtureFeed.games;generatedAt=fixtureFeed.generated_at;rosterData=fixtureRosters;injuryData=fixtureInjuries;scanNBAFirstBasket()',context);
assert(source.includes('onclick="scanNBAFirstBasket()"'));assert.equal((el('first-basket-results').innerHTML.match(/<article/g)||[]).length,5);assert(!el('scan-first-basket').disabled);
context.pickKey=board.picks[0].key;vm.runInContext('addNBAFirstBasketPick(pickKey)',context);
assert.equal(saved.market,'First basket');assert.equal(saved.player,board.picks[0].name);assert.equal(saved.gameId,board.picks[0].game.id);assert(saved.firstBasketProbability>0);
saved=null;vm.runInContext('injuryData={...fixtureInjuries,generated_at:"2000-01-01"};addNBAFirstBasketPick(pickKey)',context);assert.equal(saved,null,'Expired board entries cannot be added');assert(el('first-basket-results').innerHTML.includes('PASS'));
console.log('NBA top-five first-basket board: ranking, current starters, freshness, ET day, duplicates, strict cutoff, scan and Quick Slip PASS');
