'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const engine=require('../nba_game_first.js');
const possessions=require('../nba_possession_engine.js');
const matchups=require('../nba_matchup_discovery.js');

test('observed NBA matchup evidence reconciles with weakest combo stat and score factors',()=>{
 const priorBuild=possessions.build,priorDraws=possessions.draws,priorMatchups=matchups.analyze;
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
 const model={version:'fixture',teams:{A:team([player],{P1:30}),B:team([],{})},league:{pace:100,orb:.25},pace:100,context:{tracking:'unavailable'},warnings:[],inputTimes:{}};
 const fakeSimulation={players:[{id:'P1',minutes:30,points:21,rebounds:10,assists:7}],playerOutcomes:{P1:{points:Array(8).fill(21),rebounds:Array(8).fill(10),assists:Array(8).fill(7)}},blowoutRate:0};
 const candidates=comps.map(c=>({
   playerId:'P1',market:c.market,side:'over',researchScore:c.score,
   matchupRating:{side:'over',score:c.score,factors:factors(c.score)},
   position:'SG',opponent:'B',weakness:{allowed:c.allowed,leagueAverage:c.leagueAverage,games:8},
   playerAverage:c.playerAverage,peerAverage:c.peerAverage,history:Array(8).fill(c.playerAverage),
   baseline:c.baseline,last5:{hits:4,games:5,rate:.8},last10:{hits:7,games:8,rate:.875}
 }));
 try{
  possessions.build=()=>model;possessions.draws=()=>fakeSimulation;matchups.analyze=()=>({candidates});
  const a=engine.analyze(game,{},null,null,null,Date.parse('2026-11-12T18:00Z'),{count:8});
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
   }
  }
  const combo=rows.find(r=>r.market==='PRA');
  assert.equal(combo.matchupRating.score,80);
  assert.equal(combo.matchupRating.limitingMarket,'assists');
  assert.equal(engine.candidate(combo),null,'The existing 85-point gate remains unchanged');
 }finally{
  possessions.build=priorBuild;possessions.draws=priorDraws;matchups.analyze=priorMatchups;
 }
});

test('NBA UI displays observed position samples without presenting a research rank as win probability',()=>{
 const html=fs.readFileSync('nba.html','utf8');
 assert(html.includes('Why this prop? Observed matchup evidence'));
 assert(html.includes('position totals combine players'));
 assert(html.includes('evidenceCard(r)'));
 assert(html.includes('Score components: '));
});
