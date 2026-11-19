'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const engine=require('../nba_game_first.js');
const possessions=require('../nba_possession_engine.js');
const matchups=require('../nba_matchup_discovery.js');
const propLines=require('../nba_prop_lines.js');

function fixture(){
 const game={id:'fixture',away:'A',home:'B',date:'2026-11-15T23:00:00Z',status:'STATUS_SCHEDULED'};
 const factors=n=>[{label:'Supported matchup components',points:n,max:100}];
 const comps=[
  {market:'points',score:92,allowed:26,leagueAverage:21,playerAverage:23,peerAverage:18,baseline:15},
  {market:'rebounds',score:85,allowed:15,leagueAverage:11,playerAverage:11,peerAverage:8,baseline:8},
  {market:'assists',score:80,allowed:9,leagueAverage:7,playerAverage:8,peerAverage:6,baseline:5}
 ];
 const historical=Array.from({length:8},()=>({minutes:30,points:25,rebounds:11,assists:8}));
 const player={id:'P1',name:'Fixture Player',team:'A',sample:8,pending:false,baseline:30,fga:.45,tpa:.12,orb:.06,drb:.2,ast:.25,statHistory:historical};
 const team=(players,minutes)=>({players,minutes,absent:[],twoDefense:.04,threeDefense:.04,orb:.2,games:8});
 const inputTimes={games:'2026-11-12T17:00:00Z',injuries:'2026-11-12T17:30:00Z',rosters:'2026-11-12T16:00:00Z'};
 const model={version:'fixture',teams:{A:team([player],{P1:30}),B:team([],{})},league:{pace:100,orb:.25},pace:100,context:{tracking:'unavailable'},warnings:[],inputTimes,uncertain:['Questionable teammate']};
 const fakeSimulation={players:[{id:'P1',minutes:30,points:21,rebounds:10,assists:7}],playerOutcomes:{P1:{points:Array(8).fill(21),rebounds:Array(8).fill(10),assists:Array(8).fill(7)}},blowoutRate:0};
 const selectionSamples={points:[12,15,20,22,24,26,28,30],rebounds:[4,5,6,8,10,12,14,16],assists:[1,2,3,4,5,6,7,8]};
 for(const [market,keys]of Object.entries({pr:['points','rebounds'],pa:['points','assists'],ra:['rebounds','assists'],pra:['points','rebounds','assists']}))selectionSamples[market]=selectionSamples.points.map((_,i)=>keys.reduce((sum,key)=>sum+selectionSamples[key][i],0));
 const role={playerId:'P1',team:'A',name:player.name,eligible:true,roleStatus:'SUPPORTED',status:'NOT LISTED',projectedMinutes:30,minutesLow:29,minutesHigh:31,historyGames:8,holdReasons:[],selectionSamples,sampleKind:'role_adjusted_history',observedHistory:historical,inputTimes};
 const candidates=comps.map(c=>({
   playerId:'P1',market:c.market,side:'over',researchScore:c.score,
   matchupRating:{side:'over',score:c.score,factors:factors(c.score)},
   position:'SG',opponent:'B',weakness:{allowed:c.allowed,leagueAverage:c.leagueAverage,games:8,normalizedAllowed:30,normalizedLeagueAverage:24,allowanceBasis:'per_100_possessions_per_48_position_minutes',shrinkage:.5},
   playerAverage:c.playerAverage,peerAverage:c.peerAverage,history:Array(8).fill(c.playerAverage),
   baseline:c.baseline,last5:{hits:4,games:5,rate:.8},last10:{hits:7,games:8,rate:.875},roleEvidence:role,
   selectedLineEvidence:propLines.select({market:c.market,samples:selectionSamples[c.market],sampleKind:role.sampleKind})
 }));
 return {game,model,simulation:fakeSimulation,role,candidates,context:{generated_at:'2026-11-12T17:45:00Z'},now:Date.parse('2026-11-12T18:00Z')};
}
function mockAnalyze(f,body){
 const priorBuild=possessions.build,priorDraws=possessions.draws,priorMatchups=matchups.analyze;
 const calls={build:0,draws:0,matchups:0};
 try{
  possessions.build=(game,feed,injuries,rosters,now,options)=>{calls.build++;assert.equal(game,f.game);assert.equal(options.context,f.context);return f.model};
  possessions.draws=(model,count,seed,options)=>{calls.draws++;assert.equal(model,f.model);assert.equal(count,8);assert.equal(seed,6472026);assert.equal(options.collectPlayerOutcomes,true);return f.simulation};
  matchups.analyze=(game,feed,rosters,injuries,now,options)=>{calls.matchups++;assert.equal(options.model,f.model);assert.equal(options.simulation,f.simulation);assert.equal(options.context,f.context);return {candidates:f.candidates,roleEvidence:{players:f.role?{P1:f.role}:{}}}};
  const a=engine.analyze(f.game,{},null,null,f.context,f.now,{count:8});
  body(a,calls);
 }finally{
  possessions.build=priorBuild;possessions.draws=priorDraws;matchups.analyze=priorMatchups;
 }
}
test('observed NBA matchup evidence reconciles with weakest combo stat and score factors',()=>{
 mockAnalyze(fixture(),a=>{
  assert.equal(a.reason,null);
  const rows=a.rows.filter(r=>r.matchupRating&&r.side==='over');
  assert.equal(rows.length,7,'Three singles and four combination markets');
  for(const r of rows){
   const evidence=r.matchupEvidence,limiting=evidence.reduce((lowest,x)=>x.componentScore<lowest.componentScore?x:lowest);
   assert.equal(r.matchupRating.score,limiting.componentScore);
   assert.equal(r.matchupRating.limitingMarket,limiting.market);
   assert.equal(r.matchupRating.factors.reduce((s,x)=>s+x.points,0),r.matchupRating.score);
   assert.equal(evidence.length,r.market==='PRA'?3:r.market.includes(' + ')?2:1);
   for(const x of evidence){
    assert.equal(x.opponent,'B');assert.equal(x.opponentGames,8);assert.equal(x.playerGames,8);
    assert(x.allowed>x.leagueAverage);assert(x.playerAverage>x.peerAverage);
    assert(Number.isFinite(x.baseline));assert.equal(x.last5.hits,4);assert.equal(x.last5.games,5);
    assert.equal(x.allowanceBasis,'per_100_possessions_per_48_position_minutes');assert.equal(x.shrinkage,.5);
   }
   assert.equal(r.weakness.allowed,limiting.allowed,'Frozen weakness must use the same limiting stat as the rating');
  }
  const combo=rows.find(r=>r.market==='PRA');
  assert.equal(combo.matchupRating.score,80);
  assert.equal(combo.matchupRating.limitingMarket,'assists');
  assert.equal(engine.candidate(combo),null,'The existing 85-point gate remains unchanged');
 });
});

test('NBA game-first and matchup recommendations share one model, draw batch and role-based line policy',()=>{
 const f=fixture();mockAnalyze(f,(analysis,calls)=>{
  assert.deepEqual(calls,{build:1,draws:1,matchups:1});assert.equal(analysis.reason,null);
  assert(analysis.rows.length>0);assert.equal(new Set(analysis.rows.map(r=>r.outcomeSetId)).size,1);
  for(const r of analysis.rows){
   assert.deepEqual(r.inputTimes,f.model.inputTimes);assert.notEqual(r.inputTimes,f.model.inputTimes);
   assert.equal(r.roleEvidence,f.role);assert.equal(r.roleEvidence.observedHistory[0].points,25);
   assert.deepEqual(r.availabilitySensitivity,{type:'equal_weight_in_out',players:['Questionable teammate'],probabilityValidated:false});
  }
  const row=analysis.rows.find(r=>r.market==='points'),candidate=engine.candidate(row),fromMatchups=f.candidates.find(r=>r.market==='points');
  assert(candidate);assert.equal(candidate.line,fromMatchups.selectedLineEvidence.line);assert.equal(candidate.line,19.5);
  assert.equal(candidate.selectedLineEvidence.sampleKind,'role_adjusted_history');assert.equal(candidate.selectedLineEvidence.frequency,.75);
  assert.equal(candidate.probability,1,'Displayed simulation frequency uses shared simulated outcomes, not constructed historical frequency');
  assert.equal(candidate.matchupEvidence[0].last5.hits,4,'Recorded hit labels retain observed results');
  const exact=engine.candidate({...row,samples:[19,20,20,21,21,22,23,24]},[],{[row.key]:20});
  assert.equal(exact.line,20);assert.equal(exact.probability,5/8);assert.equal(exact.selectedLineEvidence.line,20);
  assert.equal(exact.selectedLineEvidence.pushFrequency,2/8);assert.equal(exact.selectedLineEvidence.sampleKind,'simulation_outcomes');
  assert.equal(exact.defaultLineEvidence.line,19.5);assert.equal(exact.score,candidate.score);
 });
 const changed=fixture();changed.now++;mockAnalyze(changed,analysis=>{assert(analysis.rows.every(r=>r.outcomeSetId.includes(String(changed.now))))});
});

test('real NBA recommendation producer fails closed for missing or unsupported role evidence',()=>{
 for(const change of [f=>{f.role=null;for(const c of f.candidates)delete c.roleEvidence},f=>{f.role.eligible=false;f.role.roleStatus='HELD';f.role.holdReasons=['Teammate scenarios change minutes by more than six.']},f=>{f.role.minutesHigh=38},f=>{f.role.historyGames=4}]){
  const f=fixture();change(f);mockAnalyze(f,analysis=>{
   assert.equal(analysis.reason,null);assert(analysis.rows.length>0);
   assert(analysis.rows.every(r=>r.eligible===false&&r.reviewRequired&&r.reviewReasons.length));
   assert.equal(engine.build(analysis.rows).bestSingle,null);assert.deepEqual(engine.build(analysis.rows).picks,[]);
  });
 }
});

test('NBA UI displays observed position samples without presenting a research rank as win probability',()=>{
 const html=fs.readFileSync('nba.html','utf8');
 assert(html.includes('Why this prop? Observed matchup evidence'));
 assert(html.includes('position totals combine players'));
 assert(html.includes('evidenceCard(r)'));
 assert(html.includes('Score components: '));
});
