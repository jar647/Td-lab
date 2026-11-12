'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const engine=require('../nba_game_first.js');

const read=name=>JSON.parse(fs.readFileSync('data/'+name+'.json','utf8'));
const feed=read('nba_games'),injuries=read('nba_injuries'),rosters=read('nba_rosters'),context=read('nba_game_context');
const now=Math.max(...[feed,injuries,rosters].map(v=>Date.parse(v.generated_at)))+1000;
const game=feed.games.find(g=>g.status==='STATUS_SCHEDULED'&&Date.parse(g.date)-now>90*60000&&engine.analyze(g,feed,injuries,rosters,context,now).reason===null);

test('observed NBA matchup evidence is attributable to its position, sample and rating',()=>{
 assert(game,'Need a fresh pregame fixture with supported inputs');
 const analysis=engine.analyze(game,feed,injuries,rosters,context,now);
 const supported=analysis.rows.filter(r=>r.matchupRating&&r.matchupEvidence?.length);
 assert(supported.length,'Expected supported position history evidence');
 for(const r of supported){
  const evidence=r.matchupEvidence,limiting=evidence.reduce((lowest,x)=>x.componentScore<lowest.componentScore?x:lowest);
  assert.equal(r.matchupRating.score,limiting.componentScore);
  assert.equal(r.matchupRating.limitingMarket,limiting.market);
  assert.equal(r.matchupRating.factors.reduce((s,x)=>s+x.points,0),r.matchupRating.score,'Shown factors must reconcile with the ranking');
  assert.equal(evidence.length,r.market==='PRA'?3:r.market.includes(' + ')?2:1);
  for(const x of evidence){
   assert.equal(x.opponent,r.opponent);
   assert(x.opponentGames>=5&&x.playerGames>=5);
   assert(Number.isFinite(x.allowed)&&Number.isFinite(x.leagueAverage)&&x.leagueAverage>0);
   assert(Number.isFinite(x.playerAverage)&&Number.isFinite(x.peerAverage)&&x.peerAverage>0);
   assert(Number.isFinite(x.baseline));
   assert(x.last5.games>=1&&x.last5.games<=5);
   assert(x.last5.hits<=x.last5.games);
  }
 }
});

test('NBA UI shows sourced position samples rather than pretending the score is a probability',()=>{
 const html=fs.readFileSync('nba.html','utf8');
 assert(html.includes('Why this prop? Observed matchup evidence'));
 assert(html.includes('Position totals combine players')||html.includes('position totals combine players'));
 assert(html.includes('evidenceCard(r)'));
 assert(html.includes('Score components: '));
});
