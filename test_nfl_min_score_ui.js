/* Run: node test_nfl_min_score_ui.js. Visibility and recommendation gates are separate. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const goal=require('./nfl_goal1.js'),returns=require('./nfl_roster_overrides.js');
const board=require('./nfl_player_board.js'),td=require('./nfl_td_matchup.js');
const html=fs.readFileSync('index.html','utf8');
const section=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));
const nodes=new Map(),picks=[];
const el=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',value:id==='gameFilter'?'A|B':'ALL',querySelectorAll:()=>[],prepend(){}});return nodes.get(id)};
const high={player_id:'high',player:'Boundary qualifier',team:'A',opp:'B',pos:'RB',market:'ATD',availability:'ROSTER_ACTIVE',playerAppearancesVerified:true,games:5,
 playerRushYards:50,playerCarries:5,defRushYardsAllowed:100,defRushAttemptsAllowed:10,recent3Carries:5,recent3RushYards:50,
 last5GameStats:Array.from({length:5},()=>({rushYards:50})),tdallowed:1,rzallowed:4,playerRz:2,rzshare:40};
const low={...high,player_id:'low',player:'Below minimum',playerRushYards:48,tdallowed:.1,rzallowed:.3,playerRz:.1,rzshare:1};
assert.equal(goal.matchupScore(high,'RUSH'),60);assert.equal(goal.matchupScore(low,'RUSH'),59);
assert(td.score(high)>=60);assert(td.score(low)<60,'TD uses its own observed role metrics, not the rushing-yard score');
const roster=[low,high,
 {...high,player_id:'out',player:'Unavailable player',team:'B',opp:'A',availability:'OUT'},
 {...high,player_id:'backup',player:'Backup quarterback',team:'B',opp:'A',pos:'QB',qbRole:'BACKUP'},
 {...high,player_id:'short',player:'One-game player',games:1,last5GameStats:[{rushYards:50}]},
 {...low,player_id:'wr',player:'Receiver',team:'B',opp:'A',pos:'WR',playerRushYards:0,playerCarries:0,recent3Carries:0},
 {...low,player_id:'te',player:'Tight end',pos:'TE',playerRushYards:0,playerCarries:0,recent3Carries:0},
 {...high,player_id:'missing',player:'Roster-only player',games:0,playerAppearancesVerified:false,displayOnly:true},
 {...high,player_id:'manual',player:'Manually excluded player'},
 {...high,player_id:'other-game',player:'Other matchup',team:'C',opp:'D'}];
const context={PropVaultGoal1:goal,PropShopNFLBoard:board,PropShopNFLTD:td,CookItUpNFLReturns:returns,propCategory:'RUSH',autoRecords:roster,propLines:{},activeFeedWeek:'test',
 document:{getElementById:el},num:Number,gameKey:r=>[r.team,r.opp].sort().join('|'),gameMatches:()=>true,inactiveOrBackup:()=>false,manuallyInactive:r=>r.player_id==='manual',playerDisplay:r=>r.player,escapeHTML:s=>String(s??''),
 propLineKey:(r,c)=>r.player_id+'|'+c,lastFiveChart:()=>'',suggestAltLine:()=>null,
 CookItUpQuickSlip:{button(pick){picks.push(pick);return '<button>Add</button>'}},simplePosition:'ALL',
 hardRockPrice:()=>''};
vm.createContext(context);
vm.runInContext(section('function matchupGrade(','\nfunction lastFiveChart(')+';renderPropMatchups()',context);
assert.match(el('propRankings').innerHTML,/Boundary qualifier/);
for(const player of roster.filter(r=>r.player_id!=='other-game'))assert(el('propRankings').innerHTML.includes(player.player),player.player+' remains visible');
assert.doesNotMatch(el('propRankings').innerHTML,/Other matchup/);
assert.match(el('propRankings').innerHTML,/A offense vs B defense/);
assert.match(el('propRankings').innerHTML,/B offense vs A defense/);
assert.match(el('propRankings').innerHTML,/Player performance \/ usage/);
assert.match(el('propRankings').innerHTML,/Opponent vs RB/);
assert.match(el('propRankings').innerHTML,/Below 60\/100 recommendation minimum/);
assert.match(el('propRankings').innerHTML,/Backup QB/);
assert.match(el('propRankings').innerHTML,/OUT/);
assert.match(el('propRankings').innerHTML,/Limited sample/);
const card=(id,html=el('propRankings').innerHTML)=>{const start=html.indexOf('data-player-id="'+id+'"');return html.slice(start,html.indexOf('</article>',start))};
assert.match(card('missing'),/N\/A/);
assert.doesNotMatch(card('missing'),/>0\/100/,'missing history must not become a zero score');
assert.equal(picks.length,1);assert.equal(picks[0].researchScore,60);
assert.equal(picks[0].player,'Boundary qualifier','visible below-floor, OUT, backup, manual and short-sample rows cannot be added');
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
// The full TD board includes weak/unavailable rows; recommendation panels remain gated.
vm.runInContext(section('function renderSimpleMatchups(){','\nlet propVaultGameFeed=' )+';renderSimpleMatchups()',context);
for(const player of roster.filter(r=>r.player_id!=='other-game'))assert(el('simpleRankings').innerHTML.includes(player.player),player.player+' remains in the TD roster');
for(const id of ['topDawgs','tdCategoryTop']){
 assert.match(el(id).innerHTML,/Boundary qualifier/);
 assert.doesNotMatch(el(id).innerHTML,/Below minimum/);
 assert.doesNotMatch(el(id).innerHTML,/Unavailable player|Backup quarterback|One-game player|Roster-only player|Manually excluded player/);
}
context.simplePosition='TE';vm.runInContext('renderSimpleMatchups()',context);assert.match(el('topDawgs').innerHTML,/Boundary qualifier/,'position filter must not erase other-position summary recommendations');assert.doesNotMatch(el('simpleRankings').innerHTML,/Boundary qualifier/);context.simplePosition='ALL';
context.autoRecords=[low];picks.length=0;
vm.runInContext('renderPropMatchups();renderSimpleMatchups()',context);
assert.match(el('propRankings').innerHTML,/Below minimum/);
assert.match(el('propRankings').innerHTML,/RESEARCH ONLY.*Below 60\/100/);
assert.match(el('simpleRankings').innerHTML,/Below minimum/);
assert.match(el('topDawgs').innerHTML,/PASS.*No TD recommendation/);
assert.equal(picks.length,0,'a visible research-only pool has no recommendation add actions');
context.autoRecords=[];
vm.runInContext('renderPropMatchups();renderSimpleMatchups()',context);
assert.match(el('propRankings').innerHTML,/No roster records/);
assert.match(el('simpleRankings').innerHTML,/No roster records/);
console.log('NFL full-player boards, both-team components and gated OVER/UNDER/TD recommendations passed');
