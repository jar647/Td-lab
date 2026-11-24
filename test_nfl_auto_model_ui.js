/* NFL game models are internal: one Simulate action chooses best sourced analysis. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('game-odds.html','utf8');
assert.doesNotMatch(html,/id="nflModelMode"|nflModelMode|<option value="matchup-lineup">/,'No manual NFL engine selector should remain');
assert.match(html,/\['matchup-lineup','matchup','lineup','baseline'\]\.find/,'Prefer combined matchup + verified QB scenario');
const controller=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).find(Boolean);
const elements=new Map();
function el(id){
 if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',textContent:'',hidden:false,disabled:false,
  onclick:null,onchange:null,classList:{toggle(){}},addEventListener(){},scrollIntoView(){}});
 return elements.get(id);
}
const modes=[
 {id:'both',type:'both',supports:['matchup','lineup','matchup-lineup'],expected:'Passing/rushing EPA matchups + supported QB and lineup scenario'},
 {id:'epa',type:'epa',supports:['matchup'],expected:'Passing/rushing EPA matchups; QB/lineup adjustment unavailable'},
 {id:'qb',type:'qb',supports:['lineup'],expected:'Supported QB/lineup scenario; full passing/rushing matchup inputs unavailable'},
 {id:'base',type:'base',supports:[],expected:'Historical team scoring only'}
];
const games=modes.map((g,i)=>({game_id:g.id,home:'H'+i,away:'A'+i,gameday:'2099-11-01',kickoff_at:'2099-11-01T18:00:00Z',supports:g.supports}));
function fakeNflGame(g,history,meta={}){
 const mode=meta.modelMode||'baseline';
 if(mode!=='baseline'&&!g.supports.includes(mode))throw Error('Missing supported '+mode+' source evidence');
 const hasMatchup=mode.includes('matchup'),hasLineup=mode.includes('lineup');
 const rush={matchupYards:90,baselineYards:110,offenseYpc:3.4,opponentAllowedYpc:3.1};
 const home={team:g.home,pointsShift:-.2,rushYards:rush},away={team:g.away,pointsShift:+.2,rushYards:rush};
 return {sport:'NFL',home:g.home,away:g.away,projectedHome:23,projectedAway:20,
  matchupScenario:hasMatchup?{home,away}:null,
  lineupScenario:hasLineup?{reason:'Sourced starter',generated_at:'2026-11-24',quarterbacks:{},
    before_absence_adjustment:{home:23,away:20},injuries:{},limits:[]}:null,
  trust:null,matchupResearch:null,matchupAnalysis:null,method:'Test fixture'};
}
const sandbox={document:{getElementById:el},location:{search:'?sport=NFL'},URLSearchParams,Intl,Date,setTimeout,console,
 localStorage:{getItem(){return null},setItem(){}},
 CookGameOdds:{nflGame:fakeNflGame},
 fetch:async path=>({ok:true,json:async()=>String(path).includes('game_picks_backtest')?{records:[{}]}:
  String(path).includes('game_picks.json')?{season:2026,week:12,generated_at:new Date().toISOString(),games}:
  String(path).includes('nba_games.json')?{games:[]}:{games:[]}})};
vm.createContext(sandbox);vm.runInContext(controller,sandbox,{timeout:5000});
(async()=>{
 await new Promise(resolve=>setTimeout(resolve,80));
 for(const g of modes){
  el('game').value=g.id;el('game').onchange();
  assert.equal(el('marketCard').hidden,false,'Simulate control visible for '+g.type);
  assert.match(el('trustPreview').innerHTML,new RegExp(g.expected.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')),'Automatic coverage report for '+g.type);
 }
 console.log('NFL automatic model: combined -> EPA -> supported QB -> explicit historical fallback, no selector PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
