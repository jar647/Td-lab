/* Run: node test_nfl_top_plays.js. Main NFL picks and public capture share this contract. */
'use strict';
const assert=require('node:assert/strict');
const api=require('./nfl_top_plays.js'),goal=require('./nfl_goal1.js');
const now=Date.parse('2026-11-13T14:00:00Z'),stamp=new Date(now).toISOString();
const fixture={game_id:'2026_10_A_B',home:'A',away:'B',kickoff_at:new Date(now+86400000).toISOString()};
const options={now,fixtures:[fixture],feedGeneratedAt:stamp,fixturesGeneratedAt:stamp};
function player(id,pos='RB',team='A',extra={}){
 const stats={passYards:300,rushYards:100,recYards:100,receptions:8,rushTDs:0,recTDs:0,passTDs:3};
 return {player:id,player_id:id,team,opp:team==='A'?'B':'A',pos,season:2026,market:'ATD',availability:'ROSTER_ACTIVE',injuryReportStatus:'NOT_REPORTED',playerAppearancesVerified:true,games:5,last5GamesPlayed:5,
  playerPassYards:300,playerPassAttempts:40,recent3PassYards:300,recent3PassAttempts:40,defPassYardsAllowed:300,defPassAttemptsAllowed:40,
  playerRushYards:100,playerCarries:20,recent3RushYards:100,recent3Carries:20,defRushYardsAllowed:100,defRushAttemptsAllowed:20,
  playerRecYards:100,playerTargets:10,recent3RecYards:100,recent3Targets:10,defRecYardsAllowed:130,defTargetsAllowed:13,
  playerReceptions:8,recent3Receptions:8,defReceptionsAllowed:9,
  tdallowed:0,rzallowed:0,playerRz:0,rzshare:0,playerAnytimeTDs:0,recent3AnytimeTDs:0,
  last5GameStats:Array.from({length:5},()=>({...stats})),seasonGameStats:Array.from({length:5},()=>({...stats})),
  defenseOpponentRatio:{PASS:1,RUSH:1,REC:1,CATCH:1},...extra};
}
function simulation(records){return {markets:records.flatMap(p=>api.defs.filter(d=>d.positions.includes(p.pos)).flatMap(d=>d.steps.map(line=>({id:p.player_id,market:d.key,line,scenarioRate:.8,modeledMean:p[d.season]}))))};}
const full=[player('rb'),player('wr','WR','B'),player('qb','QB'),player('te','TE','B'),player('rb2','RB','B')];
// Every consumer must pass the same model-input pool, including historyless
// roster/depth evidence. Verified feed rows always take precedence.
const firstUnit={sourceStatus:'ok',unit:'first',order:1,position:'QB',source:'https://example.com/depth',observedAt:stamp,season:2026};
const rosterQB=player('new-qb','QB','A',{displayOnly:true,playerAppearancesVerified:false,games:0,seasonGamesPlayed:0,last5GamesPlayed:0,
 playerPassYards:null,recent3PassYards:null,playerPassAttempts:null,seasonGameStats:[],last5GameStats:[],depthChart:firstUnit});
const staleSidecar={...full[0],displayOnly:true,playerAppearancesVerified:false,playerRushYards:null};
const namedSidecar={...rosterQB,player_id:null,player:'Name-only roster identity'};
const extras=[staleSidecar,rosterQB,{...rosterQB,player:'Duplicate metadata'},namedSidecar,{...namedSidecar},
 {...rosterQB,team:'C',opp:'D'}];
const preservedFeed=JSON.stringify(full),preservedExtras=JSON.stringify(extras);
const merged=api.mergeRecords(full,extras);
assert.notEqual(merged,full,'merging returns a new array');
assert.equal(merged.length,full.length+3,'verified identities win and repeated extra identities are appended once');
assert.equal(merged.find(r=>r.player_id==='rb'),full[0]);
assert.equal(merged.find(r=>r.player_id==='new-qb'&&r.team==='A'),rosterQB);
assert.equal(merged.find(r=>r.player_id==='new-qb'&&r.team==='A').depthChart,firstUnit,'sourced first-unit metadata is retained without alteration');
assert.deepEqual(merged.find(r=>r.player_id==='new-qb'&&r.team==='A').seasonGameStats,[]);
assert.equal(merged.find(r=>r.player_id==='new-qb'&&r.team==='A').playerAppearancesVerified,false);
assert.equal(JSON.stringify(full),preservedFeed);assert.equal(JSON.stringify(extras),preservedExtras);
assert.deepEqual(api.mergeRecords(null,null),[]);
const rosterModel=simulation(merged);
for(const d of api.defs)for(const line of d.steps)rosterModel.markets.push({id:'new-qb',market:d.key,line,scenarioRate:.9,modeledMean:300});
const mergedBuild=api.build(merged,fixture,rosterModel,options);
assert(!mergedBuild.candidates.some(c=>c.p.player_id==='new-qb'),'depth evidence cannot fabricate player history or make a historyless QB recommendable');
const built=api.build(full,fixture,simulation(full),options);
assert.equal(built.ready,true);assert.equal(built.status,'ok');assert(built.candidates.length>3);
assert.equal(built.topThree.length,3);assert.equal(new Set(built.topThree.map(c=>c.p.player_id)).size,3);
assert.equal(built.bestSingle.key,built.topThree[0].key);
assert(built.candidates.every(c=>c.researchScore>=60&&c.researchScore<=100&&c.side==='at_least'));
assert(built.candidates.every((c,i,a)=>!i||a[i-1].researchScore>=c.researchScore));
for(const category of ['ALL','PASS','RUSH','REC','CATCH']){
 const selected=api.select(built,category);assert(selected.length,category+' has supported plays');
 assert(selected.every(c=>category==='ALL'||c.category===category));
 assert.equal(new Set(selected.map(c=>c.p.player_id)).size,selected.length);
}
assert.deepEqual(api.select(built,'PTD'),[],'passing-TD recommendations have no supported engine/settlement path');
assert.equal(api.select(built,'ALL',1).length,1);assert.deepEqual(api.select(built,'ALL',0),[]);
assert.deepEqual(api.select({candidates:[null,{},false]}),[],'unknown candidate shapes cannot produce a selection');
assert.deepEqual(new Set(built.visible.map(c=>c.key)),new Set(api.categories.flatMap(category=>api.select(built,category)).map(c=>c.key)));
assert(built.visible.some(c=>c.category==='PASS'),'capture includes reachable market-filter plays outside the overall top three');
assert.equal(new Set(built.visible.map(c=>c.key)).size,built.visible.length);
const ranked=api.select({candidates:[{...built.candidates[0],p:{...full[0],player_id:'one'},key:'one',researchScore:60,score:9999},{...built.candidates[0],p:{...full[1],player_id:'two'},key:'two',researchScore:61,score:1}]});
assert.equal(ranked[0].key,'two','bounded matchup score takes precedence over line utility');

// Exact score boundary stays independent of the old unbounded line-selection score.
const boundary=player('boundary','RB','A',{playerRushYards:50,playerCarries:5,recent3RushYards:50,recent3Carries:5,defRushAttemptsAllowed:10,
 playerRecYards:null,playerReceptions:null,playerTargets:null,recent3Targets:null,
 last5GameStats:[40,50,60,70,0].map(rushYards=>({rushYards}))});
assert.equal(goal.matchupScore(boundary,'RUSH'),60);
const boundaryBuilt=api.build([boundary],fixture,simulation([boundary]),options);
assert.equal(boundaryBuilt.candidates.length,1);assert.equal(boundaryBuilt.bestSingle.researchScore,60);
const below={...boundary,playerRushYards:48};assert.equal(goal.matchupScore(below,'RUSH'),59);
assert.equal(api.build([below],fixture,simulation([below]),options).candidates.length,0);
const alt=boundaryBuilt.bestSingle.alternatives;
assert(alt.some(a=>a.default&&a.line===boundaryBuilt.bestSingle.line));
assert(alt.every(a=>Number.isFinite(a.scenarioRate)&&Number.isFinite(a.modeledMean)&&a.sample===5));
assert.equal(alt.find(a=>a.line===40).hits,4,'alternate history uses actual >= threshold outcomes');
const changedSimulation=simulation([boundary]);changedSimulation.markets.find(r=>r.market==='rushYards'&&r.line===60).scenarioRate=.3;
const supported=api.build([boundary],fixture,changedSimulation,options).bestSingle.alternatives;
assert.equal(supported.find(a=>a.line===60).scenarioRate,.3,'alternate frequency comes from the matching actual simulation market');

for(const update of [{feedGeneratedAt:'2026-11-11T13:59:59Z'},{fixturesGeneratedAt:'2026-11-11T13:59:59Z'},{feedGeneratedAt:'2026-11-13'},{feedGeneratedAt:new Date(now+300001).toISOString()},{fixtures:[]},{fixtures:[fixture,{...fixture}]},{now:NaN}]){
 const r=api.build(full,fixture,simulation(full),{...options,...update});assert.equal(r.ready,false);assert.deepEqual(r.candidates,[]);
}
assert(api.build(full,fixture,simulation(full),{...options,feedGeneratedAt:new Date(now-48*3600000).toISOString()}).ready,'exactly 48-hour feed remains within its explicit limit');
for(const update of [{kickoff_at:new Date(now).toISOString()},{kickoff_at:'2026-11-14'},{kickoff_at:new Date(now+7*86400000+1).toISOString()},{game_id:''},{game_id:true},{game_id:{}},{home:{}},{home:'A',away:'A'}]){
 const f={...fixture,...update};assert.equal(api.build(full,f,simulation(full),{...options,fixtures:[f]}).ready,false);
}
assert.equal(api.build(full,{...fixture,game_id:'different'},simulation(full),options).ready,false,'fixture identity must match its authoritative schedule entry');
assert.equal(api.build(full,{...fixture,kickoff_at:new Date(now+2*86400000).toISOString()},simulation(full),options).ready,false);

// Availability and actual roster role are independent of high descriptive scores.
const reserve={sourceStatus:'ok',unit:'reserve',order:2,position:'QB',source:'https://example.com/depth',observedAt:stamp,season:2026};
const excludedRecords=[player('out','WR','A',{availability:'OUT'}),player('backup','QB','A',{qbRole:'BACKUP'}),player('reserve','QB','A',{depthChart:reserve}),player('unknown','WR','A',{playerAppearancesVerified:false}),player('short','WR','A',{games:2,last5GamesPlayed:2}),player('blank','WR','A',{playerTargets:''}),player('other','WR','C',{opp:'D'}),player('bad-number','WR','A',{playerTargets:true})];
assert.deepEqual(api.build(excludedRecords,fixture,simulation(excludedRecords),options).candidates,[]);
const manual=api.build(full,fixture,simulation(full),{...options,excluded:p=>p.player_id==='wr'});assert(!manual.candidates.some(c=>c.p.player_id==='wr'));
const excludedMarket=api.build(full,fixture,simulation(full),{...options,excluded:new Set(['qb|passYards'])});assert(!excludedMarket.candidates.some(c=>c.p.player_id==='qb'&&c.market==='passYards'));
const duplicateRecord=api.build([...full,full[0]],fixture,simulation(full),options);assert.equal(duplicateRecord.candidates.length,built.candidates.length);
const malformed=simulation([boundary]);for(const r of malformed.markets)r.scenarioRate=1.5;assert.equal(api.build([boundary],fixture,malformed,options).candidates.length,0);

// Anytime TD research survives a failed simulation and never borrows passing TDs.
const tdPlayer=player('td','RB','A',{tdallowed:1.2,rzallowed:3.5,playerRz:2.5,rzshare:35,goalLine5:.8,snapShare:.85,playerAnytimeTDs:1,recent3AnytimeTDs:1,
 last5GameStats:[{rushTDs:1,recTDs:0,passTDs:9},{rushTDs:0,recTDs:1,passTDs:9},{rushTDs:0,recTDs:0,passTDs:9}]});
const tdOnly=api.build([tdPlayer],fixture,null,options);assert.equal(tdOnly.ready,true);assert.equal(tdOnly.status,'partial');assert.equal(tdOnly.candidates.length,1);
const tdPick=tdOnly.bestSingle;assert.equal(tdPick.market,'anytime_td');assert.equal(tdPick.category,'TD');assert.equal(tdPick.side,'winner');assert.equal(tdPick.line,null);assert.equal(tdPick.scenarioRate,null);assert.equal(tdPick.hits,2);assert.equal(tdPick.sample,3);assert.deepEqual(tdPick.alternatives,[]);
assert.equal(api.select(tdOnly,'TD').length,1);assert.match(tdOnly.reason,/independently supported/);
const unknownTD=api.build([{...tdPlayer,last5GameStats:[{passTDs:9},{rushTDs:null,recTDs:0}]}],fixture,null,options).bestSingle;
assert.equal(unknownTD.hits,null);assert.equal(unknownTD.sample,0);assert.match(unknownTD.reasons.join(' '),/no historical hit rate is inferred/);
const zeroTD=api.build([{...tdPlayer,last5GameStats:[{rushTDs:0,recTDs:0,passTDs:9},{rushTDs:0,recTDs:0,passTDs:9}]}],fixture,null,options).bestSingle;
assert.equal(zeroTD.hits,0);assert.equal(zeroTD.sample,2,'known zero TDs remain observed zero outcomes');

const noisy=full.map(p=>({...p,americanOdds:999,odds:-999,impliedWinProbability:.999,expectedValue:999}));
const summarize=r=>r.candidates.map(c=>({key:c.key,line:c.line,researchScore:c.researchScore,score:c.score,hits:c.hits,scenarioRate:c.scenarioRate}));
assert.deepEqual(summarize(api.build(noisy,fixture,simulation(noisy),options)),summarize(built),'prices and betting-value metadata never change matchup scores or default lines');
const original=JSON.stringify(full);api.build(full,fixture,simulation(full),options);assert.equal(JSON.stringify(full),original,'building never mutates sourced records');
console.log('NFL game-first top plays: score boundaries, supported lines, unique ranks, reachable capture union, fresh/future fixtures, availability, TD fallback and price independence passed');
