/* Run: node test_nfl_player_board.js. Player visibility is not a recommendation filter. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const board=require('./nfl_player_board.js'),goal=require('./nfl_goal1.js');
const player=(id,pos='RB',extra={})=>({player_id:id,player:id,team:'A',opp:'B',market:'ATD',pos,
 availability:'ROSTER_ACTIVE',injuryReportStatus:'NOT_REPORTED',games:5,playerAppearancesVerified:true,
 playerPassAttempts:30,recent3PassAttempts:30,playerCarries:10,recent3Carries:10,playerTargets:6,recent3Targets:6,
 tdallowed:1,defRushYardsAllowed:100,testScore:75,...extra});
const ratingFor=r=>r.testScore===null?null:{score:r.testScore,performanceScore:50,opponentScore:100};
const options={game:'A|B',ratingFor};
const records=[player('high'),player('low','RB',{testScore:59}),player('zero','RB',{testScore:0}),
 player('out','WR',{testScore:98,injuryReportStatus:'OUT'}),player('backup','QB',{qbRole:'BACKUP',testScore:95}),
 player('unverified','TE',{playerAppearancesVerified:false,testScore:100}),
 player('new-starter','QB',{games:0,playerAppearancesVerified:false,testScore:100}),
 player('missing','RB',{testScore:null}),player('other-team','TE',{team:'B',opp:'A'}),
 player('other-game','WR',{team:'C',opp:'D'}),player('wrong-market','RB',{market:'RUSH'})];
const original=JSON.stringify(records),rows=board.rows(records,'TD',options),byId=new Map(rows.map(x=>[x.record.player_id,x]));
assert.equal(rows.length,9,'all selected-game players remain, independently of score and availability');
assert.deepEqual([...new Set(rows.map(x=>x.record.team))],['A','B']);
assert.equal(byId.get('high').recommendable,true);
assert.equal(byId.get('low').score,59);assert.equal(byId.get('low').recommendable,false);
assert.match(byId.get('low').reasons.join(' '),/Below 60\/100/);
assert.equal(byId.get('zero').score,0,'true zero is distinct from missing performance');
assert.equal(byId.get('missing').score,null);assert.equal(byId.get('missing').rating,null);
assert.equal(byId.get('out').score,98);assert.equal(byId.get('out').recommendable,false);
assert.match(byId.get('out').statusLabel,/OUT/);
assert.equal(byId.get('backup').score,95);assert.equal(byId.get('backup').recommendable,false);
assert.match(byId.get('backup').statusLabel,/Backup QB/);
assert.equal(byId.get('unverified').score,null);assert.equal(byId.get('new-starter').score,null);
assert.match(byId.get('new-starter').reasons.join(' '),/No recorded player appearances/);
assert.equal(JSON.stringify(records),original,'board rendering never changes source records');
assert.equal(board.rows(records,'TD',{...options,position:'TE'}).length,2);
assert.equal(board.rows(records,'TD',{...options,game:'ALL'}).length,10);
assert.deepEqual(board.rows(records,'UNSUPPORTED',options),[]);
assert.deepEqual(board.rows(null,'TD',options),[]);

const allPositions=['QB','RB','WR','TE'].map(pos=>player(pos,pos));
for(const category of ['PASS','PTD'])assert.deepEqual(board.rows(allPositions,category,options).map(x=>x.record.pos),['QB']);
for(const category of ['REC','CATCH'])assert.deepEqual(board.rows(allPositions,category,options).map(x=>x.record.pos).sort(),['RB','TE','WR']);
assert.equal(board.rows(allPositions,'RUSH',options).length,4);
const many=Array.from({length:100},(_,i)=>player('p'+i,'WR',{testScore:i}));
assert.equal(board.rows(many,'TD',options).length,100,'there is no hidden top-15 or top-40 roster cap');

for(const [category,min] of [['PASS',1],['PTD',1],['TD',2],['RUSH',3],['REC',3],['CATCH',3]]){
 const pos=category==='PASS'||category==='PTD'?'QB':category==='REC'||category==='CATCH'?'WR':'RB';
 const valid=board.rows([player('sample',pos,{games:min})],category,options)[0];
 assert(valid.recommendable,category+' qualifies at its existing sample minimum');
 const short=board.rows([player('sample',pos,{games:min-1})],category,options)[0];
 assert(!short.recommendable);assert(short.reasons.some(r=>/sample|appearances/.test(r)));
}
for(const testScore of [-1,100.1,NaN,Infinity,'','   ',true,{valueOf:()=>75},[75]]){
 const row=board.rows([player('bad','RB',{testScore})],'TD',options)[0];
 assert.equal(row.score,null);assert.equal(row.recommendable,false);
}
assert.equal(board.rows([player('max','RB',{testScore:100})],'TD',options)[0].recommendable,true);
const manual=board.rows([player('manual')],'TD',{...options,excluded:()=>true})[0];
assert.equal(manual.score,75);assert.equal(manual.recommendable,false);assert.match(manual.reasons.join(' '),/Excluded/);
assert.match(board.rows([player('named')],'TD',{...options,excluded:()=>'Manually confirmed inactive'})[0].reasons.join(' '),/Manually confirmed inactive/);

const noEvidence=player('unproven','QB',{qbRole:'EXPECTED_STARTER'});
assert.doesNotMatch(board.rows([noEvidence],'PASS',options)[0].roleLabel,/Sourced/);
for(const source of ['','#','http://team.example/news','https://','https://bad host/news',{},true]){
 const invalid=player('invalid-source','QB',{qbRole:'EXPECTED_STARTER',starterContext:{source,note:'Starter announcement'}});
 assert.doesNotMatch(board.rows([invalid],'PASS',options)[0].roleLabel,/Sourced/);
}
assert.doesNotMatch(board.rows([player('blank-note','QB',{qbRole:'EXPECTED_STARTER',starterContext:{source:'https://team.example/news',note:'  '}})],'PASS',options)[0].roleLabel,/Sourced/);
const sourced=player('starter','QB',{recent3PassAttempts:15,qbRole:'EXPECTED_STARTER',starterContext:{source:'https://team.example/announcement',note:'Team announcement'}});
const roles=[player('prior-qb','QB',{playerPassAttempts:40,recent3PassAttempts:35}),sourced,
 player('prior-rb','RB',{playerCarries:20,recent3Carries:3}),player('current-rb','RB',{playerCarries:5,recent3Carries:15}),
 player('injured-leader','WR',{recent3Targets:40,injuryReportStatus:'OUT'}),player('current-wr','WR',{recent3Targets:8})];
const roleRows=board.rows(roles,'TD',options);
assert.equal(roleRows[0].record.player_id,'starter');assert.equal(roleRows[0].roleLabel,'Sourced expected starter');
assert.match(roleRows.find(x=>x.record.player_id==='current-rb').roleLabel,/Recent usage leader.*starter unconfirmed/);
assert.match(roleRows.find(x=>x.record.player_id==='current-wr').roleLabel,/Recent usage leader/);
assert.doesNotMatch(roleRows.find(x=>x.record.player_id==='injured-leader').roleLabel,/usage leader/);

const depth={order:1,unit:'first',position:'WR',source:'https://www.espn.com/nfl/team/depth/_/name/nyg',observedAt:'2026-11-12T16:00:00Z',season:2026,sourceStatus:'ok'};
const firstUnit=board.rows([
 sourced,
 player('depth-qb','QB',{season:2026,depthChart:{...depth,position:'QB'}}),
 ...['left','slot','right'].map((slot,i)=>player('first-'+slot,'WR',{season:2026,testScore:40+i*10,recent3Targets:12,depthChart:{...depth,slot}})),
 player('reserve-2','WR',{season:2026,testScore:30,recent3Targets:3,depthChart:{...depth,unit:'reserve',order:2}}),
 player('reserve-3','WR',{season:2026,testScore:99,recent3Targets:4,depthChart:{...depth,unit:'reserve',order:3}}),
 player('B-first-qb','QB',{team:'B',opp:'A',season:2026,depthChart:{...depth,position:'QB'}}),
 player('B-first-rb','RB',{team:'B',opp:'A',season:2026,depthChart:{...depth,position:'RB'}})
],'TD',options);
assert.equal(firstUnit[0].record.player_id,'starter','cited QB announcement outranks depth-chart first unit');
assert.equal(firstUnit.filter(x=>x.record.player_id.startsWith('first-')).length,3,'all first-unit WR slots remain visible');
for(const row of firstUnit.filter(x=>x.record.player_id.startsWith('first-')||x.record.player_id.startsWith('B-first')))
 assert.equal(row.roleLabel,'Depth-chart first unit · game-day status unconfirmed');
assert(firstUnit.findIndex(x=>x.record.player_id==='reserve-2')<firstUnit.findIndex(x=>x.record.player_id==='reserve-3'),
 'known reserve order precedes score when neither player leads recent usage');
assert.match(firstUnit.find(x=>x.record.player_id==='reserve-2').roleLabel,/Depth-chart reserve/);
const reserveOrder=[player('depth-second','WR',{recent3Targets:0,testScore:30,depthChart:{...depth,unit:'reserve',order:2}}),
 player('unranked','WR',{recent3Targets:0,testScore:80}),
 player('depth-third','WR',{recent3Targets:0,testScore:99,depthChart:{...depth,unit:'reserve',order:3}})];
for(const ordered of [reserveOrder,[...reserveOrder].reverse(),[reserveOrder[1],reserveOrder[2],reserveOrder[0]]])
 assert.deepEqual(board.rows(ordered,'TD',options).map(x=>x.record.player_id),['depth-second','depth-third','unranked'],
  'known reserve ordering is deterministic even with unranked roster entries');
for(const invalid of [
 {...depth,sourceStatus:'error'},{...depth,source:'#'},{...depth,source:'http://team.example/depth'},
 {...depth,source:{}},{...depth,observedAt:'not-a-date'},{...depth,observedAt:''},
 {...depth,season:2025},{...depth,season:null},{...depth,unit:'unknown'}
]){
 const row=board.rows([player('invalid-depth','WR',{season:2026,depthChart:invalid})],'TD',options)[0];
 assert.doesNotMatch(row.roleLabel,/Depth-chart/,'invalid evidence cannot claim a first-unit role');
}
const protectedRoster=[
 player('depth-out','WR',{season:2026,injuryReportStatus:'OUT',depthChart:{...depth}}),
 player('depth-backup','QB',{season:2026,qbRole:'BACKUP',depthChart:{...depth,position:'QB'}}),
 player('depth-new','RB',{season:2026,games:0,playerAppearancesVerified:false,depthChart:{...depth,position:'RB'}})
];
const protectedBefore=JSON.stringify(protectedRoster),protectedRows=board.rows(protectedRoster,'TD',options);
assert(protectedRows.every(x=>x.roleLabel==='Depth-chart first unit · game-day status unconfirmed'));
assert(protectedRows.every(x=>!x.recommendable),'first-unit evidence never overrides unavailable status, backups or missing history');
assert.match(protectedRows.find(x=>x.record.player_id==='depth-out').statusLabel,/OUT/);
assert.match(protectedRows.find(x=>x.record.player_id==='depth-backup').statusLabel,/Backup QB/);
assert.equal(protectedRows.find(x=>x.record.player_id==='depth-new').score,null);
assert.equal(JSON.stringify(protectedRoster),protectedBefore,'role evidence never overwrites source QB/availability flags');

const dedup=board.rows([player('duplicate','RB',{playerAppearancesVerified:false,games:0}),player('duplicate'),player('duplicate')],'TD',options);
assert.equal(dedup.length,1);assert.equal(dedup[0].record.playerAppearancesVerified,true);
const sameIdDifferentTeams=board.rows([player('same'),player('same','RB',{team:'B',opp:'A'})],'TD',options);
assert.equal(sameIdDifferentTeams.length,2,'identity never merges players across teams');

const defenses=[player('A-RB','RB',{opp:'B',tdallowed:1}),player('A-RB-duplicate','RB',{opp:'B',tdallowed:1}),
 player('C-RB','RB',{team:'C',opp:'D',tdallowed:2}),player('E-RB','RB',{team:'E',opp:'F',tdallowed:.5}),
 player('different-position','TE',{team:'G',opp:'H',tdallowed:10})];
const context=board.opponentContext(defenses,defenses[0],'TD');
assert.equal(context.total,3,'teammate copies and different positions do not distort ranks');
assert.equal(context.rank,2);assert.equal(context.easeScore,50);assert.equal(context.value,1);
assert.match(context.label,/#2 of 3 feed defenses vs RB/);
assert.equal(board.opponentContext(defenses,defenses[2],'TD').easeScore,100);
assert.equal(board.opponentContext(defenses,defenses[3],'TD').easeScore,0);
const rosterOnly=player('new','RB',{tdallowed:null,playerAppearancesVerified:false,games:0});
assert.equal(board.opponentContext(defenses,rosterOnly,'TD').value,1,'roster-only player can show position allowance from same defense');
assert.equal(board.rows([...defenses,rosterOnly],'TD',options).find(x=>x.record.player_id==='new').score,null,'borrowing opponent context does not invent player performance');
assert.equal(board.opponentContext([],rosterOnly,'TD'),null);
const tie=board.opponentContext([player('a'),player('b','RB',{team:'C',opp:'D'})],player('a'),'TD');
assert.equal(tie.rank,1);assert.equal(tie.tied,2);assert.equal(tie.easeScore,50);assert.match(tie.label,/tied/);

const reserveQB=player('depth-reserve-qb','QB',{testScore:95,depthChart:{unit:'reserve',order:2,position:'QB',sourceStatus:'ok',source:'https://www.espn.com/nfl/team/depth/_/name/nyg',observedAt:new Date().toISOString(),season:2026}});
const reserveRow=board.rows([reserveQB],'PASS',{ratingFor})[0];
assert.equal(reserveRow.score,95);assert.equal(reserveRow.recommendable,false);assert.match(reserveRow.statusLabel,/Depth-chart reserve QB/);
assert.equal(board.isReserveQuarterback(reserveQB),true);
const announced={...reserveQB,qbRole:'EXPECTED_STARTER',starterContext:{source:'https://www.giants.com/news/starting-quarterback',note:'Team announcement supersedes the depth chart'}};
assert.equal(board.isReserveQuarterback(announced),false);assert.equal(board.rows([announced],'PASS',{ratingFor})[0].recommendable,true);

const ratingRow=player('real','RB',{playerRushYards:50,playerCarries:10,defRushYardsAllowed:50,defRushAttemptsAllowed:10,recent3Carries:10});
assert.equal(board.rows([ratingRow],'RUSH')[0].score,goal.matchupScore(ratingRow,'RUSH'));
const browser={PropVaultGoal1:goal};vm.createContext(browser);vm.runInContext(fs.readFileSync('nfl_player_board.js','utf8'),browser);
assert.equal(typeof browser.PropShopNFLBoard.rows,'function');
assert.equal(browser.PropShopNFLBoard.rows([ratingRow],'RUSH')[0].score,goal.matchupScore(ratingRow,'RUSH'));
console.log('NFL complete boards retain all players, enforce recommendations separately, identify sourced roles and rank position matchups correctly');
