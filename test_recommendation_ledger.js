'use strict';
const assert=require('node:assert/strict'),api=require('./recommendation_ledger'),ui=require('./results');
const now=Date.parse('2026-11-12T18:00:00Z'),before=new Date(now).toISOString(),tip=new Date(now+3600000).toISOString();
const base={sport:'NBA',board:'Best Props',gameId:'g',playerId:'p',player:'Player',team:'A',market:'points',side:'at_least',line:20,score:85,scoreKind:'Matchup /100',modelVersion:'v1',startsAt:tip,label:'Player 20+ points'};
let c=api.capture(null,[base],now);assert.equal(c.added,1);const original=structuredClone(c.ledger.picks[0]);
c=api.capture(c.ledger,[{...base,line:10,score:99,label:'Changed line'}],now+1000);assert.equal(c.added,0);assert.equal(c.ledger.picks[0].line,20);assert.equal(c.ledger.picks[0].score,85);assert.equal(c.ledger.picks[0].capturedAt,before);assert.equal(c.ledger.picks[0].revisions.length,1);
assert.equal(api.capture(c.ledger,[base],now+3600000).added,0,'No tipoff or post-tip capture');assert.equal(api.capture(null,[{...base,startsAt:'not a time'}],now).rejected,1);
assert.equal(api.capture(null,[{...base,modelVersion:'v2'}],now).added,1,'Model versions remain separate');
const box={id:'g',status:'STATUS_FINAL',players:[{id:'p',team:'A',starter:true,stats:{MIN:'30:00',PTS:'20',REB:'4',AST:'3','3PT':'2-7'}}],first_basket:{available:true,first_game:{player_id:'p',team:'A'}}};
const data={nba:{games:[box]}},p=c.ledger.picks[0],after=now+4*3600000;
assert.equal(api.gradeOne(p,data,now).status,'pending','Future results must never settle a pre-start selection');assert.equal(api.gradeOne(p,data,after).status,'win');assert.equal(api.gradeOne({...p,side:'over'},data,after).status,'push');assert.equal(api.gradeOne({...p,side:'under'},data,after).status,'push');assert.equal(api.gradeOne({...p,side:'under',line:19.5},data,after).status,'loss');assert.equal(api.gradeOne({...p,side:'under',line:20.5},data,after).status,'win');
assert.equal(api.gradeOne({...p,market:'PRA',line:27},data,after).status,'win');
const missing=structuredClone(data);delete missing.nba.games[0].players[0].stats.PTS;assert.equal(api.gradeOne(p,missing,after).status,'awaiting_result');
const dnp=structuredClone(data);dnp.nba.games[0].players[0].stats.MIN='0';assert.equal(api.gradeOne(p,dnp,after).status,'void');
const live=structuredClone(data);live.nba.games[0].status='STATUS_IN_PROGRESS';assert.equal(api.gradeOne(p,live,after).status,'live','A live count must not settle a pick');
const fb={...p,market:'first_basket',side:'winner'};assert.equal(api.gradeOne(fb,data,after).status,'win');const bench=structuredClone(data);bench.nba.games[0].players[0].starter=false;assert.equal(api.gradeOne(fb,bench,after).status,'void');const noOpening=structuredClone(data);delete noOpening.nba.games[0].first_basket;assert.equal(api.gradeOne(fb,noOpening,after).status,'awaiting_result');
assert.equal(api.gradeOne({...p,capturedAt:tip},data,after).status,'excluded');
const nfl={...p,sport:'NFL',market:'rushYards',line:40};assert.equal(api.gradeOne(nfl,{nfl:{games:[{gameId:'g',final:true,players:[]}]}},after).status,'awaiting_result');assert.equal(api.gradeOne(nfl,{nfl:{games:[{gameId:'g',final:true,players:[{playerId:'p',team:'A',participationVerified:true,rushYards:0}]}]}},after).status,'loss');
const ufc={...p,sport:'UFC',market:'winner',side:'winner'},ufcData={ufc:{bouts:[{bout_id:'g',status:'final',winner:'p',method:'kotko',end_round:2,end_clock:'2:30'}]}};
assert.equal(api.gradeOne(ufc,ufcData,after).status,'win');assert.equal(api.gradeOne({...ufc,market:'method',method:'ko'},ufcData,after).status,'win');assert.equal(api.gradeOne({...ufc,market:'total',side:'under',line:1.5},ufcData,after).status,'push');assert.equal(api.gradeOne({...ufc,market:'total',side:'under',line:2.5},ufcData,after).status,'win');const nc=structuredClone(ufcData);nc.ufc.bouts[0].winner=null;assert.equal(api.gradeOne(ufc,nc,after).status,'awaiting_result');nc.ufc.bouts[0].method='no contest';assert.equal(api.gradeOne(ufc,nc,after).status,'void');
const graded=api.grade(c.ledger,data,after);let s=api.summarize(graded,after);assert.equal(s.overall.wins,1);assert.equal(s.overall.roi,null);assert.equal(s.groups[0].scoreTest.status,'INSUFFICIENT_EVIDENCE');assert.equal(s.groups[0].bands[0].band,'85–89');
const priced={...p,americanOdds:150,priceObservedAt:before,outcome:{status:'win'}};assert.equal(api.stats([priced]).units,1.5);assert.equal(api.stats([{...priced,priceObservedAt:tip}]).priced,0);assert.equal(api.stats([{...priced,americanOdds:-110,outcome:{status:'loss'}}]).roi,-1);assert.deepEqual(api.wilson(0,0),null);assert(api.wilson(10,10)[0]<1);
const html=ui.rows([{...p,label:'<script>alert(1)</script>',outcome:{status:'win'}}]);assert(html.includes('&lt;script&gt;'));assert(!html.includes('<script>'));assert(ui.scores(s.groups).includes('Not enough results'));assert(ui.csv([{...priced,label:'=BAD()'}]).includes("'=BAD()"));
// Scores cannot be pooled across market, side, source or version.
const split=api.summarize({picks:[...graded.picks,{...graded.picks[0],side:'under',id:'u'},{...graded.picks[0],modelVersion:'v2',id:'v'}]});assert.equal(split.groups.length,3);
// The source adapters execute the deployed NFL and UFC selection functions,
// not an independently rewritten scoring approximation. Stale inputs are explicit.
const sources=require('./scripts/recommendation_sources.cjs').captureSources();assert(!sources.coverage.some(c=>c.status==='error'),JSON.stringify(sources.coverage));assert(sources.coverage.some(c=>c.sport==='NBA'));assert(sources.coverage.some(c=>c.sport==='NFL'));assert(sources.coverage.some(c=>c.sport==='UFC'));
console.log('Forward public recommendation capture, immutable line/score, all-sport grading, missing outcomes, score groups, ROI and dashboard contracts PASS');
const testCutoff=(scoreKind,cutoff)=>{const r=api.summarize({picks:[{...graded.picks[0],scoreKind}]}).groups[0];assert.equal(r.scoreTest.cutoff,cutoff)};
testCutoff('TD opportunity /100',60);testCutoff('NFL analyst raw rank (not /100)',100);testCutoff('Matchup score /100',90);
assert.equal(api.summarize({picks:[{...graded.picks[0],score:null,probability:.2}]}).groups[0].scoreTest.status,'NOT_NUMERIC_SCORE');

// Contract: every market emitted by either deployed NBA recommendation engine
// must have a supported settlement path, including the short combo keys.
const expectedNBA={points:20,rebounds:4,assists:3,threes:2,pr:24,pa:23,ra:7,pra:27,'Points + Rebounds':24,'Points + Assists':23,'Rebounds + Assists':7,PRA:27};
for(const market of new Set([...require('./nba_matchup_discovery').markets,...require('./nba_game_first').markets])){
 assert(Object.hasOwn(expectedNBA,market),'New NBA market needs an explicit grading contract: '+market);
 const record={...p,market,line:expectedNBA[market],side:'at_least'};
 assert.equal(api.gradeOne(record,data,after).status,'win',market);
 assert.equal(api.gradeOne({...record,side:'under'},data,after).status,'push',market);
 assert.equal(api.gradeOne({...record,side:'over'},data,after).status,'push',market);
 const missingPart=structuredClone(data);delete missingPart.nba.games[0].players[0].stats.REB;
 if(['rebounds','pr','ra','pra','Points + Rebounds','Rebounds + Assists','PRA'].includes(market))assert.equal(api.gradeOne(record,missingPart,after).status,'awaiting_result',market);
}
assert(ui.rows([{...p,market:'pr',label:'Player 24+ pr',line:24,outcome:{status:'pending'}}]).includes('24+ points + rebounds'));

// A scoreboard clock may be time remaining, not elapsed finish time. Total-round
// grading needs verified historical finish fields, and rejects invalid values.
for(const bad of [{end_round:0},{end_round:6},{end_clock:'6:00'},{end_clock:'2:60'}]){
 const badTiming=structuredClone(ufcData);Object.assign(badTiming.ufc.bouts[0],bad);
 assert.equal(api.gradeOne({...ufc,market:'total',side:'under',line:2.5},badTiming,after).status,'awaiting_result');
}
const unknownTiming=structuredClone(ufcData);delete unknownTiming.ufc.bouts[0].end_clock;
assert.equal(api.gradeOne({...ufc,market:'total',side:'under',line:2.5},unknownTiming,after).status,'awaiting_result');
const negativeNBA=structuredClone(data);negativeNBA.nba.games[0].players[0].stats.PTS=-1;
assert.equal(api.gradeOne(p,negativeNBA,after).status,'awaiting_result');
// A late tracker launch must never be presented as a full-day results record.
const day='2026-11-12',fixtureList=[{id:'early',date:new Date(now-3600000).toISOString(),home:'Earlier home',away:'Earlier away'},{id:'g',date:tip,home:'A',away:'B'}];
const coverage=api.captureCoverage(graded.picks,fixtureList,day);
assert(coverage.partialFirstDay);assert.equal(coverage.captureStartedAt,before);assert.equal(coverage.recorded,1);assert.equal(coverage.boards['Best Props'],1);assert.equal(coverage.scheduledGames,2);assert.equal(coverage.gamesWithPicks,1);assert.equal(coverage.earlierStartsWithoutPicks,1);
assert(ui.coverageHTML([coverage]).includes('Partial-day record'));assert(ui.coverageHTML([coverage]).includes('not the full slate'));
assert.equal(api.captureCoverage(graded.picks,[], '2026-11-13').partialFirstDay,false,'Later dates are not automatically marked partial just because tracking started yesterday');
// The actual source adapter must save an entire 40+ candidate slate; no top-8
// or top-three limit may leak from a different recommendation section.
const fortyFive=Array.from({length:45},(_,i)=>({playerId:'full-slate-'+i,name:'Player '+i,team:'A',opponent:'B',market:'points',side:'over',baseline:20,researchScore:85,eligible:true,matchupRating:{factors:[]}}));
const fullSource=require('./scripts/recommendation_sources.cjs').captureSources(now,{onlySport:'NBA',nbaInputs:{feed:{generated_at:before,games:[{id:'whole-slate',home:'A',away:'B',date:new Date(now+6*3600000).toISOString(),status:'STATUS_SCHEDULED'}]},rosters:{generated_at:before,teams:{A:[],B:[]}},injuries:{generated_at:before,status:'ok',injuries:[]}},nbaMatchups:{labels:{points:'points'},analyze:()=>({ready:true,candidates:[...fortyFive,...['over','under'].flatMap(side=>[84,84.99,100.01,NaN,null].map(researchScore=>({...fortyFive[0],playerId:'low-'+side+'-'+researchScore,side,researchScore}))),{...fortyFive[0],playerId:'three',market:'threes',researchScore:85},{...fortyFive[0],playerId:'under-high',side:'under',researchScore:100}]})}});
assert(!fullSource.coverage.some(c=>c.status==='error'),JSON.stringify(fullSource.coverage));
assert.equal(fullSource.picks.filter(p=>p.board==='Best Props').length,46);assert.equal(api.capture(null,fullSource.picks,now).added,46);assert.equal(fullSource.coverage.find(c=>c.sport==='NBA'&&!c.gameId).bestPropsCandidates,46);

assert(api.captureCoverage(graded.picks,coverage.fixtures,day).partialFirstDay,'Stored fixture evidence preserves the partial-day warning when the live feed rolls over');

const oldBelowFloor={...base,score:80,modelVersion:'older-policy'};const retained=api.capture({schema:1,picks:[{...oldBelowFloor,id:'saved-old',day:'2026-11-12',capturedAt:before,outcome:{status:'pending'}}]},[],now);assert.equal(retained.ledger.picks[0].score,80,'Saved original lower-score plays are never removed or upgraded by the new policy');

// Every newly captured scored NBA/NFL recommendation must satisfy the live floor.
for(const pick of sources.picks.filter(p=>['NBA','NFL'].includes(p.sport)&&p.score!==null))assert(pick.score>=(pick.sport==='NFL'?60:85)&&pick.score<=100,JSON.stringify(pick));
const qb=(id,team,opp,quality)=>({player_id:id,player:id,team,opp,pos:'QB',availability:'ROSTER_ACTIVE',playerAppearancesVerified:true,games:5,last5GamesPlayed:5,playerPassYards:quality,playerPassAttempts:40,defPassYardsAllowed:quality,defPassAttemptsAllowed:40,recent3PassYards:quality,last5GameStats:Array.from({length:5},()=>({passYards:quality})),defenseOpponentRatio:{PASS:1}});
const nflPlayers=[qb('qualified','A','B',300),qb('boundary-60','A','B',100),qb('below-60','B','A',95),qb('below-floor','B','A',90)];
const nflSource=require('./scripts/recommendation_sources.cjs').captureSources(now,{onlySport:'NFL',nflInputs:{feed:nflPlayers,status:{generated_at:before},games:{generated_at:before,games:[{game_id:'nfl-g',home:'A',away:'B',kickoff_at:new Date(now+6*3600000).toISOString()}]}},nflEngine:{simulate:()=>({markets:nflPlayers.flatMap(p=>[150,175,200,225,250,275,300].map(line=>({id:p.player_id,market:'passYards',line,scenarioRate:.99,modeledMean:300})))})}});
assert(!nflSource.coverage.some(c=>c.status==='error'),JSON.stringify(nflSource.coverage));assert(nflSource.picks.some(p=>p.playerId==='qualified'));assert(nflSource.picks.some(p=>p.playerId==='boundary-60'&&p.score===60));assert(!nflSource.picks.some(p=>['below-floor','below-60'].includes(p.playerId)));assert(nflSource.picks.every(p=>p.scoreKind==='NFL matchup score /100'&&p.score>=60&&p.score<=100));
// The compact page captures the actual category leaders it displays. The
// retired full TD roster board must no longer inflate new recommendation counts.
const topPlays=require('./nfl_top_plays');
const tdPlayers=Array.from({length:50},(_,i)=>({player_id:'td-'+i,player:'TD Player '+i,team:i%2?'B':'A',opp:i%2?'A':'B',pos:'RB',market:'ATD',availability:'ROSTER_ACTIVE',playerAppearancesVerified:true,games:5,last5GamesPlayed:5,tdallowed:1.2,rzallowed:3.5,playerRz:2.5,rzshare:35,goalLine5:.8,snapShare:.85,playerAnytimeTDs:1,recent3AnytimeTDs:1}));
const tdWithheld=[{...tdPlayers[0],player_id:'td-out',availability:'OUT'},{...tdPlayers[0],player_id:'td-low',tdallowed:0,rzallowed:0,playerRz:0,rzshare:0,goalLine5:0,snapShare:0,playerAnytimeTDs:0,recent3AnytimeTDs:0}];
const tdSource=require('./scripts/recommendation_sources.cjs').captureSources(now,{onlySport:'NFL',nflInputs:{feed:[...tdPlayers,...tdWithheld],status:{generated_at:before},games:{generated_at:before,games:[{game_id:'td-game',home:'A',away:'B',kickoff_at:new Date(now+6*3600000).toISOString()}]}},nflEngine:{simulate:()=>({markets:[]})}});
assert(!tdSource.coverage.some(c=>c.status==='error'),JSON.stringify(tdSource.coverage));
assert.equal(tdSource.picks.length,10,'the TD-only board shows and freezes its ten category leaders');
assert(tdSource.picks.every(p=>p.board==='Game top plays'&&p.score===100));
const tdDisplayed=topPlays.build([...tdPlayers,...tdWithheld],{game_id:'td-game',home:'A',away:'B',kickoff_at:new Date(now+6*3600000).toISOString()},{markets:[]},{now,fixtures:[{game_id:'td-game',home:'A',away:'B',kickoff_at:new Date(now+6*3600000).toISOString()}],feedGeneratedAt:before,fixturesGeneratedAt:before});
assert.deepEqual(tdSource.picks.map(p=>p.playerId),tdDisplayed.visible.map(c=>String(c.p.player_id)),'capture matches the exact displayed TD leaders');
assert(!tdSource.picks.some(p=>['td-out','td-low'].includes(p.playerId)));
assert(!sources.picks.some(p=>p.board==='Anytime TD research'),'the retired public board emits no new records');
const legacyTD={...base,sport:'NFL',board:'Anytime TD research',market:'anytime_td',side:'winner',line:null,score:69,scoreKind:'Anytime TD matchup /100',modelVersion:'nfl-td-role-retired-production',label:'Original legacy TD pick',inputs:{scoringVersion:'nfl-td-role-v1',performanceScore:74,opponentScore:64,scoreFactors:[{key:'tds',value:.5}],depthChart:{unit:'first',source:'https://example.com/depth'}}};
const legacyTDLedger=api.capture(null,[legacyTD],now).ledger,legacyTDOriginal=structuredClone(legacyTDLedger.picks[0]);
const legacyRetained=api.capture(legacyTDLedger,tdSource.picks,now+1000).ledger;
assert.deepEqual(legacyRetained.picks.find(p=>p.id===legacyTDOriginal.id),legacyTDOriginal,'retiring a producer preserves every original legacy pick field and its evidence');
const captureTDPrices=tdPrices=>require('./scripts/recommendation_sources.cjs').captureSources(now,{onlySport:'NFL',nflInputs:{feed:tdPlayers,status:{generated_at:before},games:{generated_at:before,games:[{game_id:'td-game',home:'A',away:'B',kickoff_at:new Date(now+6*3600000).toISOString()}]},tdPrices},nflEngine:{simulate:()=>({markets:[]})}}).picks;
const offeredTD={source:'Verified test book',retrieved_at_utc:before,games:[{fixture_id:'td-fixture',fixture_metadata:{startTime:new Date(now+6*3600000).toISOString(),participant1Abbr:'A',participant2Abbr:'B'},selections:tdPlayers.map(p=>({player_name:p.player,american_odds:200}))}]};
assert(captureTDPrices(offeredTD).every(p=>p.board==='Game top plays'&&p.americanOdds===200&&p.priceObservedAt===before&&p.priceFixture==='td-fixture'),'fresh identity-matched prices attach to the current TD board');
assert(captureTDPrices({...offeredTD,retrieved_at_utc:new Date(now-3600001).toISOString()}).every(p=>p.americanOdds===undefined),'stale quotes never attach to current TD plays');
const wrongTD=structuredClone(offeredTD);wrongTD.games[0].fixture_metadata.participant2Abbr='C';
assert(captureTDPrices(wrongTD).every(p=>p.americanOdds===undefined),'quotes from a different fixture never attach to current TD plays');
// TD capture is independent of QB/game-model availability and later games
// still get a chance to publish supported research.
const nextTD={...tdPlayers[0],player_id:'next-game-td',player:'Next Game TD',team:'C',opp:'D'};
const isolatedTD=require('./scripts/recommendation_sources.cjs').captureSources(now,{onlySport:'NFL',nflInputs:{feed:[...tdPlayers,nextTD],status:{generated_at:before},games:{generated_at:before,games:[{game_id:'qb-unavailable',home:'A',away:'B',kickoff_at:new Date(now+6*3600000).toISOString()},{game_id:'next-game',home:'C',away:'D',kickoff_at:new Date(now+7*3600000).toISOString()}]}},nflEngine:{simulate:records=>{if(records.some(r=>r.team==='A'))throw Error('QB model unavailable');return {markets:[]}}}});
assert.equal(isolatedTD.picks.length,11,'ten first-game TD leaders survive a model failure and later-game picks are not globally truncated');
assert(isolatedTD.picks.every(p=>p.board==='Game top plays'),'only the current public TD recommendation board emits new records');
assert(isolatedTD.picks.some(p=>p.board==='Game top plays'&&p.gameId==='qb-unavailable'&&p.market==='anytime_td'),'main-game TD plays remain capturable without the game simulation');
assert(isolatedTD.picks.some(p=>p.playerId==='next-game-td'),'later games still process');
assert(isolatedTD.coverage.some(c=>c.gameId==='qb-unavailable'&&c.status==='partial'));

// The full-board TD tab now exposes ten scorers. Its fourth through tenth
// selections must reach frozen capture with their own fixture and score.
const tenFixtures=[
 {game_id:'ten-a',home:'A',away:'B',kickoff_at:new Date(now+6*3600000).toISOString()},
 {game_id:'ten-b',home:'C',away:'D',kickoff_at:new Date(now+7*3600000).toISOString()}
];
const tenRecords=tenFixtures.flatMap((fixture,game)=>Array.from({length:12},(_,i)=>({
 ...tdPlayers[0],player_id:'board-'+game+'-'+i,player:'Board TD '+game+' '+i,
 team:i%2?fixture.away:fixture.home,opp:i%2?fixture.home:fixture.away,
 tdallowed:i<6?1.2:game===0?.8:.7,
 last5GameStats:Array.from({length:5},()=>({rushTDs:1,recTDs:0,passTDs:7}))
})));
const tenInputs=[...tenRecords,{...tenRecords[0]},...tdWithheld];
const tenSimulations=new Map(tenFixtures.map(fixture=>[fixture.game_id,{markets:[]}]));
const tenBoard=topPlays.slate(tenInputs,tenFixtures,tenSimulations,{now,feedGeneratedAt:before,fixturesGeneratedAt:before});
const tenDisplayed=topPlays.select(tenBoard,'TD');
assert.equal(tenDisplayed.length,10,'full-board anytime TD shows ten distinct eligible scorers');
assert.equal(new Set(tenDisplayed.map(r=>r.p.player_id)).size,10,'duplicate player rows cannot fill extra slots');
assert.equal(new Set(tenDisplayed.map(r=>r.fixture.game_id)).size,2,'global top ten draws from both games without a per-game display restriction');
assert(tenDisplayed.every((r,i)=>r.researchScore>=60&&(!i||r.researchScore<=tenDisplayed[i-1].researchScore)),'the expanded board remains score ordered and above the recommendation floor');
const tenCapture=require('./scripts/recommendation_sources.cjs').captureSources(now,{onlySport:'NFL',nflInputs:{feed:tenInputs,status:{generated_at:before},games:{generated_at:before,games:tenFixtures}},nflEngine:{simulate:()=>({markets:[]})}});
assert(!tenCapture.coverage.some(c=>c.status==='error'),JSON.stringify(tenCapture.coverage));
const tenSaved=tenCapture.picks.filter(p=>p.board==='Game top plays'&&p.market==='anytime_td');
assert.equal(tenSaved.length,20,"capture retains each game filter's ten reachable scorers");
const tenSavedKeys=new Set(tenSaved.map(p=>JSON.stringify([p.gameId,p.playerId,p.side,p.line,p.score])));
for(const [index,row]of tenDisplayed.entries()){
 assert(tenSavedKeys.has(JSON.stringify([row.fixture.game_id,String(row.p.player_id),'winner',null,row.researchScore])),'global TD rank '+(index+1)+' is frozen with its actual default score and fixture');
 const saved=tenSaved.find(p=>p.gameId===row.fixture.game_id&&p.playerId===String(row.p.player_id));
 assert.equal(saved.startsAt,row.fixture.kickoff_at,'TD rank '+(index+1)+' keeps its own kickoff');
}
const tenFrozen=api.capture(legacyTDLedger,tenSaved,now).ledger;
assert.deepEqual(tenFrozen.picks.find(p=>p.id===legacyTDOriginal.id),legacyTDOriginal,'expanding the board leaves all retired historical TD evidence intact');
const tenthRow=tenDisplayed[9],tenthFrozen=tenFrozen.picks.find(p=>p.gameId===tenthRow.fixture.game_id&&p.playerId===String(tenthRow.p.player_id));
assert(tenthFrozen,'the tenth displayed scorer is persisted, not lost at a former top-three cap');
const tenthOriginal=structuredClone(tenthFrozen),tenthRevision={...tenSaved.find(p=>p.gameId===tenthFrozen.gameId&&p.playerId===tenthFrozen.playerId),score:60,label:'Later top-ten update'};
const tenthAgain=api.capture(tenFrozen,[tenthRevision],now+1000).ledger.picks.find(p=>p.id===tenthFrozen.id);
assert.equal(tenthAgain.score,tenthOriginal.score);assert.equal(tenthAgain.capturedAt,tenthOriginal.capturedAt);assert.deepEqual(tenthAgain.inputs,tenthOriginal.inputs);
assert.equal(tenthAgain.revisions.length,1,'a later tenth-place display change becomes a revision, not a rewritten prediction');
assert.equal(api.gradeOne(tenthFrozen,{nfl:{games:[{gameId:tenthFrozen.gameId,final:true,players:[{playerId:tenthFrozen.playerId,team:tenthFrozen.team,participationVerified:true,scoredTD:true}]}]}},now+8*3600000).status,'win','the tenth-place saved TD can be settled from verified offensive TD results');

// The compact game page exposes the union of category leaders, not only the
// All-props top three. Its exact default lines/scores must all be captured.
const gameFixture={game_id:'main-game',home:'A',away:'B',kickoff_at:new Date(now+6*3600000).toISOString()};
const mainPlayer=(id,pos,team)=>({
 player_id:id,player:id,market:'ATD',pos,team,opp:team==='A'?'B':'A',
 availability:'ROSTER_ACTIVE',playerAppearancesVerified:true,games:5,last5GamesPlayed:5,
 playerPassYards:300,playerPassAttempts:40,recent3PassYards:300,
 playerRushYards:100,playerCarries:20,recent3RushYards:100,
 playerRecYards:100,playerTargets:10,recent3RecYards:100,
 playerReceptions:8,recent3Receptions:8,
 defPassYardsAllowed:300,defPassAttemptsAllowed:40,
 defRushYardsAllowed:100,defRushAttemptsAllowed:20,
 defRecYardsAllowed:130,defTargetsAllowed:13,defReceptionsAllowed:9,
 defenseOpponentRatio:{PASS:1,RUSH:1,REC:1,CATCH:1},
 tdallowed:1.2,rzallowed:3.5,playerRz:2.5,rzshare:35,goalLine5:.8,snapShare:.85,
 playerAnytimeTDs:1,recent3AnytimeTDs:1,
 last5GameStats:Array.from({length:5},()=>({passYards:300,rushYards:100,recYards:100,receptions:8,rushTDs:1,recTDs:0}))
});
const mainPlayers=['QB','RB','WR','TE'].flatMap((pos,i)=>['A','B'].map(team=>mainPlayer(i+'-'+team,pos,team)));
const mainSimulation={markets:mainPlayers.flatMap(p=>topPlays.defs.flatMap(d=>d.steps.map(line=>({id:p.player_id,market:d.key,line,scenarioRate:.8,modeledMean:p[d.season]}))))};
const displayed=topPlays.build(mainPlayers,gameFixture,mainSimulation,{now,fixtures:[gameFixture],feedGeneratedAt:before,fixturesGeneratedAt:before});
assert(displayed.visible.length>3,'category leaders beyond All-props top three are visible');
const mainCapture=require('./scripts/recommendation_sources.cjs').captureSources(now,{onlySport:'NFL',nflInputs:{feed:mainPlayers,status:{generated_at:before},games:{generated_at:before,games:[gameFixture]}},nflEngine:{simulate:(_pool,count,seed)=>{assert.equal(count,10000);assert.equal(seed,982451653);return mainSimulation;}}});
assert(!mainCapture.coverage.some(c=>c.status==='error'||c.status==='partial'),JSON.stringify(mainCapture.coverage));
const compactSaved=mainCapture.picks.filter(p=>p.board==='Game top plays');
const defaults=c=>[String(c.p.player_id),c.market,c.side,c.market==='anytime_td'?null:c.line,c.researchScore];
const savedDefaults=p=>[p.playerId,p.market,p.side,p.line,p.score];
assert.deepEqual(compactSaved.map(savedDefaults).sort(),displayed.visible.map(defaults).sort(),'every displayed category default is frozen exactly once with the same score/line');
for(const category of ['PASS','RUSH','REC','CATCH','TD'])assert(compactSaved.some(p=>p.inputs.category===category),'category captured: '+category);
assert(compactSaved.every(p=>p.modelVersion.startsWith('nfl-top-plays-')&&p.score>=60&&p.score<=100&&p.side!=='under'));
const frozenCompact=api.capture(c.ledger,compactSaved,now).ledger;
assert.deepEqual(frozenCompact.picks.find(x=>x.id===original.id).inputs,original.inputs,'adding the game board preserves earlier input evidence');
const compactOriginal=structuredClone(frozenCompact.picks.find(x=>x.board==='Game top plays'));
const changedCompact={...compactSaved.find(x=>x.playerId===compactOriginal.playerId&&x.market===compactOriginal.market),line:compactOriginal.market==='anytime_td'?null:compactOriginal.line+5,score:99,label:'Later display revision'};
const compactAgain=api.capture(frozenCompact,[changedCompact],now+1000).ledger.picks.find(x=>x.id===compactOriginal.id);
assert.equal(compactAgain.score,compactOriginal.score);assert.equal(compactAgain.line,compactOriginal.line);assert.equal(compactAgain.capturedAt,compactOriginal.capturedAt);
assert.deepEqual(compactAgain.inputs,compactOriginal.inputs,'frozen main-game evidence is never replaced by a later display');
assert.equal(compactAgain.revisions.length,1);

// Main page, dedicated analyst and capture must send the same raw roster cues
// into the engine. A sourced current QB with missing history forces a team
// volume fallback; omitting that identity silently substitutes an old QB.
const engine=require('./nfl_game_engine');
const rosterNow=Date.now(),rosterStamp=new Date(rosterNow).toISOString();
const rosterFixture={game_id:'roster-qb-game',home:'A',away:'B',kickoff_at:new Date(rosterNow+6*3600000).toISOString()};
const rosterVerified=mainPlayers.map(p=>{
 const qb=p.pos==='QB',rb=p.pos==='RB',wr=p.pos==='WR';
 const values={passYards:qb?300:0,passAttempts:qb?40:0,rushYards:rb?90:qb?15:0,rushAttempts:rb?18:qb?3:0,recYards:rb?22:wr?100:qb?0:65,targets:rb?4:wr?12:qb?0:8,receptions:rb?3:wr?8:qb?0:6,rushTDs:0,recTDs:0};
 const history=Array.from({length:5},(_,i)=>({...values,week:i+1,gameId:'past-'+i}));
 return {...p,season:2026,teamPassAttemptsPerGame:40,playerPassYards:values.passYards,playerPassAttempts:values.passAttempts,recent3PassYards:values.passYards,playerRushYards:values.rushYards,playerCarries:values.rushAttempts,recent3RushYards:values.rushYards,playerRecYards:values.recYards,playerTargets:values.targets,recent3RecYards:values.recYards,playerReceptions:values.receptions,recent3Receptions:values.receptions,seasonGameStats:history,last5GameStats:history,tdallowed:0,rzallowed:0,playerRz:0,rzshare:0,goalLine5:0,playerAnytimeTDs:0,recent3AnytimeTDs:0};
});
const rosterQB={player_id:'current-qb-without-history',player:'Sourced current QB',team:'A',opp:'B',pos:'QB',market:'ATD',season:2026,availability:'ROSTER_ACTIVE',displayOnly:true,playerAppearancesVerified:false,games:0,last5GamesPlayed:0,seasonGameStats:[],last5GameStats:[],depthChart:{order:1,unit:'first',position:'QB',sourceStatus:'ok',season:2026,observedAt:rosterStamp,source:'https://example.com/team/depth'}};
const mergedRoster=topPlays.mergeRecords(rosterVerified,[rosterQB]);
assert.equal(engine.build(rosterVerified).teams.find(t=>t.team==='A').outlook.quarterbackPlayerPropsAvailable,true,'omitting the current QB would select earlier player history');
const rosterSimulation=engine.simulate(mergedRoster,10000,982451653,[]),fallback=rosterSimulation.teams.find(t=>t.team==='A');
assert.equal(fallback.quarterbackSelection,'TEAM_VOLUME_FALLBACK');assert.equal(fallback.quarterbackPlayerPropsAvailable,false);
assert(!rosterSimulation.markets.some(m=>m.team==='A'&&m.market==='passYards'),'neither the current historyless QB nor an old named QB receives a passing market');
const rosterOptions={now:rosterNow,fixtures:[rosterFixture],feedGeneratedAt:rosterStamp,fixturesGeneratedAt:rosterStamp};
const rosterDisplayed=topPlays.build(mergedRoster,rosterFixture,rosterSimulation,rosterOptions);
const rosterCapture=require('./scripts/recommendation_sources.cjs').captureSources(rosterNow,{onlySport:'NFL',nflInputs:{feed:rosterVerified,status:{generated_at:rosterStamp,rosterPlayers:[rosterQB]},games:{generated_at:rosterStamp,games:[rosterFixture]}},nflEngine:{simulate:(pool,count,seed)=>{assert(pool.some(p=>p.player_id===rosterQB.player_id&&p.playerAppearancesVerified===false),'source-only QB cue reaches the capture engine unchanged');assert.equal(count,10000);assert.equal(seed,982451653);assert.equal(engine.build(pool).teams.find(t=>t.team==='A').outlook.quarterbackSelection,'TEAM_VOLUME_FALLBACK');return rosterSimulation;}}});
assert(!rosterCapture.coverage.some(c=>c.status==='error'||c.status==='partial'),JSON.stringify(rosterCapture.coverage));
assert.deepEqual(rosterCapture.picks.filter(p=>p.board==='Game top plays').map(savedDefaults).sort(),rosterDisplayed.visible.map(defaults).sort(),'capture freezes exactly the main page default scores and lines under current QB fallback');
assert(!rosterCapture.picks.some(p=>p.playerId===rosterQB.player_id||p.team==='A'&&p.market==='passYards'),'no source-only or silently substituted QB recommendation is captured');

// A made-three count of zero is known; absent/malformed/conflicting evidence is not zero.
for(const [stats,actual] of [[{'3PT':'0-7'},0],[{'3PT':'3-7'},3],[{'3PM':'3'},3],[{'3PTM':3},3],[{'3PM':3,'3PT':'3-7'},3],[{},null],[{'3PT':'8-7'},null],[{'3PT':'3-7','3PM':2},null],[{'3PM':null},null]]){
 const source=structuredClone(data);source.nba.games[0].players[0].stats={MIN:'30',...stats};const result=api.gradeOne({...p,market:'threes',line:2.5,side:'over'},source,after);
 assert.equal(result.status,actual===null?'awaiting_result':actual>2.5?'win':'loss');if(actual!==null)assert.equal(result.actual,actual);
}
const oldUnder=api.capture(null,[{...base,market:'threes',side:'under',line:2.5,label:'Old saved UNDER'}],now).ledger;
const underOriginal=structuredClone(oldUnder.picks[0]);const oldGraded=api.grade(oldUnder,data,after);assert.equal(oldGraded.picks[0].outcome.status,'win');assert.equal(oldGraded.picks[0].side,'under');assert.equal(oldGraded.picks[0].capturedAt,underOriginal.capturedAt);assert.equal(oldGraded.picks[0].line,2.5);
