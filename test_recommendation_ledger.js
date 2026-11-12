'use strict';
const assert=require('node:assert/strict'),api=require('./recommendation_ledger'),ui=require('./results');
const now=Date.parse('2026-11-12T18:00:00Z'),before=new Date(now).toISOString(),tip=new Date(now+3600000).toISOString();
const base={sport:'NBA',board:'Best Props',gameId:'g',playerId:'p',player:'Player',team:'A',market:'points',side:'at_least',line:20,score:85,scoreKind:'Matchup /100',modelVersion:'v1',startsAt:tip,label:'Player 20+ points'};
let c=api.capture(null,[base],now);assert.equal(c.added,1);const original=structuredClone(c.ledger.picks[0]);
c=api.capture(c.ledger,[{...base,line:10,score:99,label:'Changed line'}],now+1000);assert.equal(c.added,0);assert.equal(c.ledger.picks[0].line,20);assert.equal(c.ledger.picks[0].score,85);assert.equal(c.ledger.picks[0].capturedAt,before);assert.equal(c.ledger.picks[0].revisions.length,1);
assert.equal(api.capture(c.ledger,[base],now+3600000).added,0,'No tipoff or post-tip capture');assert.equal(api.capture(null,[{...base,startsAt:'not a time'}],now).rejected,1);
assert.equal(api.capture(null,[{...base,modelVersion:'v2'}],now).added,1,'Model versions remain separate');
const box={id:'g',status:'STATUS_FINAL',players:[{id:'p',team:'A',starter:true,stats:{MIN:'30:00',PTS:'20',REB:'4',AST:'3'}}],first_basket:{available:true,first_game:{player_id:'p',team:'A'}}};
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
const expectedNBA={points:20,rebounds:4,assists:3,pr:24,pa:23,ra:7,pra:27,'Points + Rebounds':24,'Points + Assists':23,'Rebounds + Assists':7,PRA:27};
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
const fullSource=require('./scripts/recommendation_sources.cjs').captureSources(now,{onlySport:'NBA',nbaInputs:{feed:{generated_at:before,games:[{id:'whole-slate',home:'A',away:'B',date:new Date(now+6*3600000).toISOString(),status:'STATUS_SCHEDULED'}]},rosters:{generated_at:before,teams:{A:[],B:[]}},injuries:{generated_at:before,status:'ok',injuries:[]}},nbaMatchups:{labels:{points:'points'},analyze:()=>({ready:true,candidates:[...fortyFive,...['over','under'].flatMap(side=>[84,84.99,100.01,NaN,null].map(researchScore=>({...fortyFive[0],playerId:'low-'+side+'-'+researchScore,side,researchScore}))),{...fortyFive[0],playerId:'three',market:'threes',researchScore:100}]})}});
assert(!fullSource.coverage.some(c=>c.status==='error'),JSON.stringify(fullSource.coverage));
assert.equal(fullSource.picks.filter(p=>p.board==='Best Props').length,45);assert.equal(api.capture(null,fullSource.picks,now).added,45);assert.equal(fullSource.coverage.find(c=>c.sport==='NBA'&&!c.gameId).bestPropsCandidates,45);

assert(api.captureCoverage(graded.picks,coverage.fixtures,day).partialFirstDay,'Stored fixture evidence preserves the partial-day warning when the live feed rolls over');

const oldBelowFloor={...base,score:80,modelVersion:'older-policy'};const retained=api.capture({schema:1,picks:[{...oldBelowFloor,id:'saved-old',day:'2026-11-12',capturedAt:before,outcome:{status:'pending'}}]},[],now);assert.equal(retained.ledger.picks[0].score,80,'Saved original lower-score plays are never removed or upgraded by the new policy');

// Every newly captured scored NBA/NFL recommendation must satisfy the live floor.
for(const pick of sources.picks.filter(p=>['NBA','NFL'].includes(p.sport)&&p.score!==null))assert(pick.score>=85&&pick.score<=100,JSON.stringify(pick));
const qb=(id,team,opp,quality)=>({player_id:id,player:id,team,opp,pos:'QB',availability:'ROSTER_ACTIVE',playerAppearancesVerified:true,games:5,last5GamesPlayed:5,playerPassYards:quality,playerPassAttempts:40,defPassYardsAllowed:quality,defPassAttemptsAllowed:40,recent3PassYards:quality,last5GameStats:Array.from({length:5},()=>({passYards:quality})),defenseOpponentRatio:{PASS:1}});
const nflPlayers=[qb('qualified','A','B',300),qb('below-floor','B','A',100)];
const nflSource=require('./scripts/recommendation_sources.cjs').captureSources(now,{onlySport:'NFL',nflInputs:{feed:nflPlayers,status:{generated_at:before},games:{generated_at:before,games:[{game_id:'nfl-g',home:'A',away:'B',kickoff_at:new Date(now+6*3600000).toISOString()}]}},nflEngine:{simulate:()=>({markets:nflPlayers.flatMap(p=>[150,175,200,225,250,275,300].map(line=>({id:p.player_id,market:'passYards',line,scenarioRate:.99,modeledMean:300})))})}});
assert(!nflSource.coverage.some(c=>c.status==='error'),JSON.stringify(nflSource.coverage));assert(nflSource.picks.some(p=>p.playerId==='qualified'));assert(!nflSource.picks.some(p=>p.playerId==='below-floor'));assert(nflSource.picks.every(p=>p.scoreKind==='NFL matchup score /100'&&p.score>=85&&p.score<=100));
