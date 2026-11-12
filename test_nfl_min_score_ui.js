/* Run: node test_nfl_min_score_ui.js. Exercise deployed NFL gates at 59/60. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const goal=require('./nfl_goal1.js'),returns=require('./nfl_roster_overrides.js');
const html=fs.readFileSync('index.html','utf8');
const section=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));
const nodes=new Map(),picks=[];
const el=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',value:'ALL',querySelectorAll:()=>[],prepend(){}});return nodes.get(id)};
const high={player_id:'high',player:'Boundary qualifier',team:'A',opp:'B',pos:'RB',market:'ATD',availability:'ROSTER_ACTIVE',playerAppearancesVerified:true,games:5,
 playerRushYards:50,playerCarries:5,defRushYardsAllowed:100,defRushAttemptsAllowed:10,recent3Carries:5,recent3RushYards:50,
 last5GameStats:Array.from({length:5},()=>({rushYards:50})),tdallowed:1,rzallowed:4,playerRz:2,rzshare:40};
const low={...high,player_id:'low',player:'Below minimum',playerRushYards:48};
assert.equal(goal.matchupScore(high,'RUSH'),60);assert.equal(goal.matchupScore(low,'RUSH'),59);
const context={PropVaultGoal1:goal,CookItUpNFLReturns:returns,propCategory:'RUSH',autoRecords:[low,high],propLines:{},activeFeedWeek:'test',
 document:{getElementById:el},num:Number,gameKey:()=>'A|B',gameMatches:()=>true,inactiveOrBackup:()=>false,playerDisplay:r=>r.player,escapeHTML:s=>String(s??''),
 propLineKey:(r,c)=>r.player_id+'|'+c,lastFiveChart:()=>'',suggestAltLine:()=>null,
 CookItUpQuickSlip:{button(pick){picks.push(pick);return '<button>Add</button>'}},simplePosition:'ALL',
 alignmentScore:r=>r.player_id==='high'?60:59,alignmentLabel:()=> '🔥 PRIME MATCHUP',hardRockPrice:()=>''};
vm.createContext(context);
vm.runInContext(section('function matchupGrade(','\nfunction lastFiveChart(')+';renderPropMatchups()',context);
assert.match(el('propRankings').innerHTML,/Boundary qualifier/);
assert.doesNotMatch(el('propRankings').innerHTML,/Below minimum/);
assert.equal(picks.length,1);assert.equal(picks[0].researchScore,60);
// The line-comparison function enforces the same gate before choosing a side.
vm.runInContext(section('function propDecision(','\n// Research thresholds'),context);
const cfg=goal.SPECS.RUSH;
context.entry={r:high,score:60};context.cfg=cfg;
for(const [line,side] of [[20,'OVER'],[100,'UNDER']]){
 context.propLines['high|RUSH']=line;
 assert.match(vm.runInContext("propDecision(entry,cfg,'RUSH').label",context),new RegExp(side));
 context.entry.score=59.99;
 assert.match(vm.runInContext("propDecision(entry,cfg,'RUSH').label",context),/PASS.*60\/100/);
 context.entry.score=60;
}
// The public TD radar and its Top Dawg panels also withhold 59-point rows.
vm.runInContext(section('function renderSimpleMatchups(){','\nlet propVaultGameFeed=' )+';renderSimpleMatchups()',context);
for(const id of ['simpleRankings','topDawgs','tdCategoryTop']){
 assert.match(el(id).innerHTML,/Boundary qualifier/);
 assert.doesNotMatch(el(id).innerHTML,/Below minimum/);
}
context.autoRecords=[low];picks.length=0;
vm.runInContext('renderPropMatchups();renderSimpleMatchups()',context);
assert.match(el('propRankings').innerHTML,/PASS.*60\/100/);
assert.match(el('simpleRankings').innerHTML,/PASS.*60\/100/);
assert.equal(picks.length,0,'empty qualified pools have no add actions');
console.log('NFL primary board, OVER/UNDER verdicts, TD radar and empty-state score gates passed');
