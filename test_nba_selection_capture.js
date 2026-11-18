'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const source=require('./scripts/recommendation_sources.cjs');
const lines=require('./nba_prop_lines'),gameFirst=require('./nba_game_first');
const parlay=require('./nba_parlay');
const ledger=require('./recommendation_ledger'),validation=require('./nba_prop_validation');

const now=Date.parse('2026-11-18T18:00:00Z'),stamp=new Date(now).toISOString();
const game={id:'capture-game',home:'B',away:'A',date:'2026-11-18T23:00:00Z',status:'STATUS_SCHEDULED'};
const historical=[15,19,22,24,26,28,30,32],outcomes=[8,10,15,19,20,22,24,28];
const simulatedOutcomes=Array.from({length:1000},(_,i)=>outcomes[i%outcomes.length]);
const role={eligible:true,roleStatus:'SUPPORTED',projectedMinutes:32,minutesLow:31,minutesHigh:33,
 historyGames:8,status:'ACTIVE',holdReasons:[],sampleKind:'role_adjusted_history',selectionSamples:{points:historical}};
const selected=lines.select({market:'points',samples:historical,sampleKind:role.sampleKind});
assert.equal(selected.milestone,20);
assert.equal(selected.line,19.5);
assert.equal(selected.frequency,.75);
const weakness={allowanceBasis:'per_100_possessions_per_48_position_minutes',normalizedAllowed:29.1,
 normalizedLeagueAverage:25.3,shrinkage:8/16};
const rows=Array.from({length:8},(_,i)=>({key:game.id+'|p'+i+'|points',gameId:game.id,game,
 playerId:'p'+i,name:'Capture Player '+i,team:'A',opponent:'B',market:'points',side:'over',
 samples:simulatedOutcomes,forecast:20,eligible:true,matchupGames:8,matchupBoost:.1,
 matchupRating:{side:'over',score:85+i,factors:[]},reason:'Observed workload and normalized opponent allowance.',
 roleEvidence:{...role,playerId:'p'+i,team:'A'},selectedLineEvidence:selected,weakness,
 inputTimes:{games:stamp,rosters:stamp,injuries:stamp},outcomeSetId:'shared-capture-outcomes'}));
const best=rows.map(r=>({...r,baseline:selected.milestone,researchScore:r.matchupRating.score}));
const firstBasket={id:'opening-player',name:'Opening Player',team:'B',game,probability:.12,
 firstGame:2,games:8,firstTeam:3};
const inputs={feed:{generated_at:stamp,games:[game]},rosters:{generated_at:stamp,teams:{A:[],B:[]}},
 injuries:{generated_at:stamp,status:'ok',injuries:[]},context:{generated_at:stamp},odds:{markets:[]}};
function capture(options={},adapter=source){
 const {candidates=best,simulationRows=rows,ready=true,quotes=[],...extra}=options;
 const result=adapter.captureSources(now,{onlySport:'NBA',
  nbaInputs:{...inputs,odds:{markets:quotes}},
  nbaMatchups:{labels:{points:'points',threes:'threes',pr:'points + rebounds'},
   analyze:()=>({ready,reason:ready?null:'PASS: verified role data are unavailable.',candidates})},
  nbaGameFirst:{...gameFirst,analyze:()=>({rows:simulationRows,inputTimes:{feed:stamp,rosters:stamp,injuries:stamp}})},
  nbaFirstBasket:{slate:()=>({picks:[firstBasket],reason:null})},...extra});
 assert(!result.coverage.some(c=>c.status==='error'),JSON.stringify(result.coverage));
 return result;
}
const result=capture(),bestPicks=result.picks.filter(p=>p.board==='Best Props');
const gamePicks=result.picks.filter(p=>p.board==='Game-first recommendations');
assert.equal(bestPicks.length,8);
assert.equal(gamePicks.length,8,'all qualified default parlay candidates are frozen, including players outside top three/default ticket');
assert(gameFirst.build(rows).topThree.length<gamePicks.length);
assert(gameFirst.build(rows).picks.length<gamePicks.length);
assert.deepEqual(gamePicks.map(p=>p.playerId).sort(),rows.map(r=>r.playerId).sort());
const draft=parlay.generate(rows.map(r=>gameFirst.candidate(r)),{count:3,mode:'sgp',gameId:game.id,now});
assert.equal(draft.available,true,'the tested universe is actually eligible for the shared-outcome parlay generator');
assert(draft.legs.every(leg=>gamePicks.some(p=>p.playerId===leg.playerId&&p.market===leg.market&&p.line===leg.line)),
 'every generated default leg has a frozen exact-line individual prediction');
const expected={role:{projectedMinutes:32,minutesLow:31,minutesHigh:33,historyGames:8,roleStatus:'SUPPORTED'},
 line:{policy:lines.POLICY,sampleKind:'role_adjusted_history',frequency:.75,milestone:20,strictOverLine:19.5},
 defense:{basis:weakness.allowanceBasis,normalizedAllowed:29.1,normalizedLeagueAverage:25.3,shrinkage:.5}};
for(const pick of bestPicks){
 assert.equal(pick.side,'at_least');assert.equal(pick.line,20);
 assert.deepEqual(pick.inputs.selectionEvidence,expected);
 assert(!Object.hasOwn(pick,'probability'),'constructed role-history line frequency is never presented as a predictive probability');
}
for(const pick of gamePicks){
 assert.equal(pick.side,'over');assert.equal(pick.line,19.5);
 assert.equal(pick.probability,.5,'capture freezes actual shared-game outcome frequency at the selected strict line');
 assert.notEqual(pick.probability,pick.inputs.selectionEvidence.line.frequency);
 assert.deepEqual(pick.inputs.selectionEvidence,expected);
}
const saved=ledger.capture(null,result.picks,now);
assert.equal(saved.added,17,'both complete prop boards and the separate first-basket pick survive capture');
const validGroups=validation.analyze(saved.ledger.picks,{now});
assert.equal(validGroups.counts.eligibleProps,16);
assert(validGroups.groups.every(g=>g.metadataComplete===8),'both milestone and strict-over metadata satisfy forward validation');

// The adapter must independently preserve the public 85/100 OVER policy.
const invalidScores=[84,84.999,100.001,NaN,null,undefined,'90'];
const rejectedBest=invalidScores.map((researchScore,i)=>({...best[0],playerId:'bad-best-'+i,researchScore}));
const rejectedRows=invalidScores.map((score,i)=>({...rows[0],key:'bad-game-'+i,playerId:'bad-game-'+i,
 matchupRating:{...rows[0].matchupRating,score}}));
const qualifiedThree={...best[0],playerId:'three-85',market:'threes',researchScore:85};
const gates=capture({candidates:[...rejectedBest,qualifiedThree,
 {...best[0],playerId:'best-under',side:'under',researchScore:100},
 {...best[0],playerId:'not-eligible',eligible:false,researchScore:100}],
 simulationRows:[...rejectedRows,{...rows[0],playerId:'game-under',side:'under',matchupRating:{side:'under',score:100}},rows[0]]});
assert.deepEqual(gates.picks.filter(p=>p.board==='Best Props').map(p=>p.playerId),['three-85']);
assert.deepEqual(gates.picks.filter(p=>p.board==='Game-first recommendations').map(p=>p.playerId),['p0']);
assert.equal(capture({ready:false}).picks.filter(p=>p.board==='Best Props').length,0,'PASS cannot publish candidates left in an unavailable analysis');
assert(capture({ready:false}).coverage.some(c=>c.status==='withheld'&&c.gameId===game.id));

// Exact observed quotes attach after selection. They cannot change scores,
// selected lines, evidence or which players get captured.
const quote={game_id:game.id,player_id:'p0',market:'points',side:'over',line:19.5,
 american_odds:-110,bookmaker:'Observed test book',observed_at:stamp};
const noPrice=result.picks.map(({americanOdds,priceObservedAt,bookmaker,quotedLine,...p})=>p);
for(const american_odds of [-1000,-110,110,1000]){
 const priced=capture({quotes:[{...quote,american_odds}]}).picks;
 const identityOnly=priced.map(({americanOdds,priceObservedAt,bookmaker,quotedLine,...p})=>p);
 assert.deepEqual(identityOnly,noPrice,'ratings and recommendations are independent of sportsbook prices');
 for(const pick of priced.filter(p=>p.playerId==='p0')){
  assert.equal(pick.americanOdds,american_odds);assert.equal(pick.priceObservedAt,stamp);
  assert.equal(pick.quotedLine,19.5);assert.equal(pick.bookmaker,quote.bookmaker);
 }
 assert(priced.filter(p=>p.playerId!=='p0').every(p=>!Object.hasOwn(p,'americanOdds')));
}
for(const change of [{game_id:'different-game'},{player_id:'different-player'},{market:'rebounds'},
 {side:'under'},{line:20},{line:20.5},{line:'19.5'},
 {observed_at:new Date(now-3600001).toISOString()},
 {observed_at:new Date(now+1000).toISOString()},{observed_at:'unverified'},
 {american_odds:NaN},{american_odds:90},{american_odds:'-110'}]){
 const picks=capture({quotes:[{...quote,...change}]}).picks;
 assert(picks.every(p=>!Object.hasOwn(p,'americanOdds')),'mismatched, stale, future or invalid quote must not attach: '+JSON.stringify(change));
}
const combo={...best[0],playerId:'combo',market:'pr'};
const comboQuoted=capture({candidates:[combo],simulationRows:[],quotes:[{...quote,player_id:'combo',market:'points_rebounds'}]});
assert.equal(comboQuoted.picks.find(p=>p.playerId==='combo').americanOdds,-110,'canonical combo quote maps to the exact captured milestone');

// Unknown evidence remains unknown, including after JSON persistence. The
// producer must not infer old role or line-policy fields from today's model.
const unknown=[{...best[0],playerId:'missing-all',roleEvidence:undefined,selectedLineEvidence:undefined},
 {...best[0],playerId:'missing-fields',roleEvidence:{projectedMinutes:'32'},selectedLineEvidence:{frequency:NaN},weakness:{}}];
const unknownPicks=capture({candidates:unknown,simulationRows:[]}).picks.filter(p=>p.board==='Best Props');
assert.equal(unknownPicks[0].inputs.selectionEvidence,null);
assert.deepEqual(JSON.parse(JSON.stringify(unknownPicks[1].inputs.selectionEvidence)),{
 role:{projectedMinutes:null,minutesLow:null,minutesHigh:null,historyGames:null,roleStatus:null},
 line:{policy:null,sampleKind:null,frequency:null,milestone:null,strictOverLine:null},
 defense:{basis:null,normalizedAllowed:null,normalizedLeagueAverage:null,shrinkage:null}});
const old=structuredClone(saved.ledger);
delete old.picks[0].inputs.selectionEvidence;
const original=structuredClone(old.picks[0]);
assert.deepEqual(ledger.capture(old,result.picks,now+1000).ledger.picks[0],original,'a newer producer does not backfill a previously frozen pick');
const legacy={...original,id:'legacy-original',modelVersion:'old-policy',score:80,line:10,
 inputs:{feed:'older-input-time'}};
const after=ledger.capture({schema:1,picks:[legacy]},result.picks,now+1000).ledger;
assert.deepEqual(after.picks.find(p=>p.id==='legacy-original'),legacy,'earlier lower scores, lines and missing metadata remain unchanged');

// Model identity includes every shared selection dependency. A code change
// starts a new forward cohort without changing first-basket model identity.
const filename=path.join(__dirname,'scripts/recommendation_sources.cjs');
function withChangedSource(file){
 const patchedFS=Object.create(fs);
 patchedFS.readFileSync=(target,...args)=>{
  const value=fs.readFileSync(target,...args);
  return path.resolve(String(target))===path.join(__dirname,file)?value+'\n/* selection-version test */':value;
 };
 const actualRequire=createRequire(filename),sandbox={module:{exports:{}},__dirname:path.dirname(filename),
  require:name=>name==='node:fs'?patchedFS:actualRequire(name)};
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),sandbox,{filename});
 return sandbox.module.exports;
}
for(const file of ['nba_prop_evidence.js','nba_prop_lines.js','nba_matchup_discovery.js','nba_possession_engine.js','nba_game_context.js']){
 const changed=capture({},withChangedSource(file)).picks;
 for(const board of ['Best Props','Game-first recommendations']){
  assert.notEqual(changed.find(p=>p.board===board).modelVersion,result.picks.find(p=>p.board===board).modelVersion,file+' must version '+board);
 }
 assert.equal(changed.find(p=>p.market==='first_basket').modelVersion,result.picks.find(p=>p.market==='first_basket').modelVersion);
}
const changedGameFirst=capture({},withChangedSource('nba_game_first.js')).picks;
assert.notEqual(changedGameFirst.find(p=>p.board==='Game-first recommendations').modelVersion,gamePicks[0].modelVersion);
assert.equal(changedGameFirst.find(p=>p.board==='Best Props').modelVersion,bestPicks[0].modelVersion);
const opening=result.picks.find(p=>p.market==='first_basket');
assert.equal(opening.probability,.12);assert.equal(opening.score,null);
assert.equal(opening.houseRule,'Must start; first field goal only; free throws excluded');
assert.deepEqual(opening.inputs,{feed:stamp,rosters:stamp,injuries:stamp});
console.log('NBA frozen selection capture: exact lines, all qualified candidates, 85 OVER gate, independent scores, observed quotes and immutable evidence PASS');
