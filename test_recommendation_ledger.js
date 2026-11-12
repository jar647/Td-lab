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
