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
assert.equal(bestPicks.length,8,'all displayed Best Props default lines remain tracked');
assert.equal(gamePicks.length,0,'the same player-market cannot be tracked twice across NBA boards');
assert(!result.picks.some(p=>p.market==='first_basket'||p.board==='Automatic OVER alternate lines'),
 'First Basket and alternate-line menus are never captured as independent recommendations');
const issued=gameFirst.build(rows),gameOnly=capture({candidates:[]}).picks.filter(p=>p.board==='Game-first recommendations');
const issuedKeys=new Set([...issued.picks,...issued.topThree,...(issued.bestSingle?[issued.bestSingle]:[])].map(p=>p.key));
assert(issuedKeys.size>0&&issuedKeys.size<rows.length,'game-first offers selected recommendations, not every candidate');
assert.deepEqual(gameOnly.map(p=>p.playerId).sort(),[...issuedKeys].map(key=>rows.find(r=>r.key===key).playerId).sort());
assert(gameOnly.every(p=>p.inputs.recommendationScope==='game-first-visible'));
const draft=parlay.generate(rows.map(r=>gameFirst.candidate(r)),{count:3,mode:'sgp',gameId:game.id,now});
assert.equal(draft.available,true,'the tested universe is actually eligible for the shared-outcome parlay generator');
assert(draft.legs.every(leg=>gameOnly.some(p=>p.playerId===leg.playerId&&p.market===leg.market&&p.line===leg.line)),
 'each real game-first default ticket leg is frozen at its exact recommended line');
const expected={role:{projectedMinutes:32,minutesLow:31,minutesHigh:33,historyGames:8,roleStatus:'SUPPORTED'},
 line:{policy:lines.POLICY,sampleKind:'role_adjusted_history',frequency:.75,milestone:20,strictOverLine:19.5},
 defense:{basis:weakness.allowanceBasis,normalizedAllowed:29.1,normalizedLeagueAverage:25.3,shrinkage:.5}};
for(const pick of bestPicks){
 assert.equal(pick.side,'at_least');assert.equal(pick.line,20);
 assert.equal(pick.inputs.recommendationScope,'best-props-visible');
 assert.deepEqual(pick.inputs.selectionEvidence,expected);
 assert(!Object.hasOwn(pick,'probability'),'constructed role-history line frequency is never presented as a predictive probability');
}
for(const pick of gameOnly){
 assert.equal(pick.side,'over');assert.equal(pick.line,19.5);
 assert.equal(pick.probability,.5,'capture freezes shared-game outcome frequency at only the selected strict line');
 assert.notEqual(pick.probability,pick.inputs.selectionEvidence.line.frequency);
 assert.deepEqual(pick.inputs.selectionEvidence,expected);
}
const saved=ledger.capture(null,result.picks,now);
assert.equal(saved.added,8,'one exact line per issued player prop, no First Basket or alternate sweeps');
assert.equal(ledger.capture(saved.ledger,gameOnly,now+1000).added,0,
 'the equivalent game-first selections must not generate duplicate player-market trials');
const validGroups=validation.analyze(saved.ledger.picks,{now});
assert.equal(validGroups.counts.eligibleProps,8);
assert(validGroups.groups.every(g=>g.metadataComplete===8),'frozen role/line evidence supports forward validation');

// Context availability can be newer than the published injury snapshot. Freeze
// the source actually selected by the shared context/role model, not the older
// snapshot merely because it was the adapter's injuries argument.
const published={...inputs.injuries,generated_at:new Date(now-2*3600000).toISOString()};
const latestReport={...inputs.injuries,generated_at:new Date(now-2*60000).toISOString()};
const latestContext={generated_at:new Date(now-60000).toISOString(),availability:latestReport};
const activeTimes={games:stamp,rosters:stamp,injuries:latestReport.generated_at};
const refreshed=capture({nbaInputs:{...inputs,injuries:published,context:latestContext},
 nbaMatchups:{labels:{points:'points'},analyze:(g,feed,rosters,injuries,at,{context})=>{
  const active=require('./nba_game_context').availability(context,g,injuries,at);
  assert.equal(active.generated_at,latestReport.generated_at);
  return {ready:true,candidates:best.map(r=>({...r,roleEvidence:{...r.roleEvidence,inputTimes:{games:feed.generated_at,rosters:rosters.generated_at,injuries:active.generated_at}}}))};
 }},
 nbaGameFirst:{...gameFirst,analyze:()=>({rows,inputTimes:activeTimes})}});
for(const pick of refreshed.picks.filter(p=>['Best Props','Game-first recommendations'].includes(p.board))){
 assert.equal(pick.inputs.games,stamp);
 assert.equal(pick.inputs.rosters,stamp);
 assert.equal(pick.inputs.injuries,latestReport.generated_at,'fresher selected context injury provenance must replace the published stamp');
 assert.equal(pick.inputs.context,latestContext.generated_at);
}
const historicalPick={...refreshed.picks[0],inputs:{feed:stamp,rosters:stamp,injuries:published.generated_at}};
const priorCapture=ledger.capture(null,[historicalPick],now).ledger;
assert.deepEqual(ledger.capture(priorCapture,refreshed.picks,now+1000).ledger.picks[0],priorCapture.picks[0],
 'fresher source provenance is recorded only on new captures; saved original inputs never change');

// Capture only the actual issued NBA market and side at the uniform 80/100 minimum.
const invalidScores=[74,79.999,100.001,NaN,null,undefined,'90'];
const rejectedBest=invalidScores.map((researchScore,i)=>({...best[0],playerId:'bad-best-'+i,researchScore}));
const rejectedRows=invalidScores.map((score,i)=>({...rows[0],key:'bad-game-'+i,playerId:'bad-game-'+i,
 matchupRating:{...rows[0].matchupRating,score}}));
const qualifiedThree={...best[0],playerId:'three-80',market:'threes',researchScore:80};
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

// Selected recommendations preserve model dependency hashes; unselected
// candidate universes and the retired First Basket board are not emitted.
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
 const changedGameOnly=capture({candidates:[]},withChangedSource(file)).picks;
 assert.notEqual(changed.find(p=>p.board==='Best Props').modelVersion,bestPicks[0].modelVersion,file+' must version Best Props');
 assert.notEqual(changedGameOnly.find(p=>p.board==='Game-first recommendations').modelVersion,gameOnly[0].modelVersion,file+' must version visible Game-first');
 assert(!changed.some(p=>p.market==='first_basket'||p.board==='Automatic OVER alternate lines'),
  'retired predictions must not reappear on model changes');
}
const changedGameFirst=capture({candidates:[]},withChangedSource('nba_game_first.js')).picks;
assert.notEqual(changedGameFirst.find(p=>p.board==='Game-first recommendations').modelVersion,gameOnly[0].modelVersion);
assert.equal(capture({},withChangedSource('nba_game_first.js')).picks.find(p=>p.board==='Best Props').modelVersion,bestPicks[0].modelVersion);
assert(!result.picks.some(p=>p.market==='first_basket'));
console.log('NBA frozen selection capture: one issued exact line, no First Basket/automatic alternates, OVER gate, observed quotes and immutable evidence PASS');
const newMinimumCapture=capture({candidates:[{...best[0],playerId:'regular-79',researchScore:79},{...best[0],playerId:'three-79',market:'threes',researchScore:79.99},{...best[0],playerId:'three-85',market:'threes',researchScore:85}],simulationRows:[{...rows[0],matchupRating:{...rows[0].matchupRating,score:79}}]});
assert.deepEqual(newMinimumCapture.picks.filter(p=>p.board==='Best Props').map(p=>p.playerId),['three-80']);
assert(!newMinimumCapture.picks.some(p=>p.board==='Game-first recommendations'&&p.score<80),'Sub-80 simulated research must not be captured');
assert(newMinimumCapture.picks.filter(p=>p.sport==='NBA'&&p.market!=='first_basket').every(p=>p.inputs.recommendationMinimum===80));
