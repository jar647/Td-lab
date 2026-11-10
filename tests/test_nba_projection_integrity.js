'use strict';const assert=require('node:assert/strict'),fs=require('node:fs'),p=require('../nba_possession_engine'),research=require('../nba_game_first'),{audit}=require('../scripts/audit_nba_projections');
const read=n=>JSON.parse(fs.readFileSync('data/'+n+'.json')),feed=read('nba_games'),injuries=read('nba_injuries'),rosters=read('nba_rosters'),context=read('nba_game_context');
const now=Math.max(...[feed,injuries,rosters].map(d=>Date.parse(d.generated_at)))+1000;
const game=feed.games.find(g=>g.status==='STATUS_SCHEDULED'&&Date.parse(g.date)>now+90*60000);
assert(game,'A current pregame fixture outside the strict near-tipoff injury window is required');

const recovered=feed.games.find(g=>g.id==='401909095'),ny=recovered.players.filter(p=>p.team==='New York Knicks');assert(p.box(ny),'A fully documented zero-minute placeholder must not discard Towns valid game');
const incomplete=structuredClone(ny),placeholder=incomplete.find(p=>p.stats?.MIN==='--'&&!p.didNotPlay);assert(placeholder);delete placeholder.stats.MIN;assert.equal(p.box(incomplete),null,'Missing minutes remain unknown, even with zero production');
const invalid=structuredClone(ny),bad=invalid.find(p=>p.stats?.MIN==='--'&&!p.didNotPlay);bad.stats.AST='1';assert.equal(p.box(invalid),null,'A placeholder with any production must fail closed');

const model=p.build(game,feed,injuries,rosters,now,{context});
for(const t of Object.values(model.teams)){assert(t.liveRebound>0&&t.liveRebound<=1);assert(t.allowLiveRebound>0&&t.allowLiveRebound<=1)}
const noPlayerRebounds=structuredClone(model);for(const t of Object.values(noPlayerRebounds.teams)){t.liveRebound=0;t.allowLiveRebound=0}
assert(p.draws(noPlayerRebounds,1000,123,{availability:'in'}).players.every(p=>p.rebounds===0),'Dead-ball misses must never produce player rebounds even when all questionable players are available');
const a=research.analyze(game,feed,injuries,rosters,context,now);
// The real upcoming NBA slate changes hourly. When uncertain rotations cannot
// support six players, the correct behavior is NO invented player picks.
if(a.reason){
 assert.match(a.reason,/in\/out scenario lacks six supported rotation players|availability|Fresh|closed/i);
 assert.equal(a.rows.length,0,'Unsupported live availability cannot produce player research');
}else{
 assert(a.rows.length,'Successful current-game research must contain supported opportunities');
}
// Check the workload gate independently with a fully eligible synthetic
// research row rather than tying the test to whichever players happen to be
// questionable on the next scheduled fixture.
const row={key:'fixture|p|rebounds',gameId:'fixture',playerId:'p',name:'Fixture Player',
 market:'rebounds',forecast:10,minutes:30,matchupBoost:.12,matchupGames:8,
 eligible:true,matchupRating:{score:80,factors:[]},samples:[4,8,9,10,11,12,13,14],reviewRequired:false};
assert(research.candidate(row),'Healthy research fixture must otherwise be eligible');
const held={...row,reviewRequired:true,reviewReasons:['Unsupported projected workload jump']};
assert.equal(research.candidate({...held,line:1,probability:.99}),null,'An unsupported workload must not be ranked regardless of simulated hit rate');
assert.equal(research.build([held]).picks.length,0);
const final=feed.games.filter(g=>g.status==='STATUS_FINAL'&&g.season_type===2).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date))[0];
const before=audit(feed,p,{gameIds:[final.id],includeRows:true}),mutated=structuredClone(feed),target=mutated.games.find(g=>g.id===final.id);for(const x of target.players){if(x.stats)x.stats.PTS='999'}
const after=audit(mutated,p,{gameIds:[final.id],includeRows:true});assert(before.observations.length>0);assert.deepEqual(before.observations.map(x=>[x.player,x.market,x.prediction,x.baseline]),after.observations.map(x=>[x.player,x.market,x.prediction,x.baseline]),'Target-game actuals must never enter the predictor or baseline');
console.log('NBA projection integrity: dead-ball accounting, unsupported workload gates and walk-forward cutoff PASS');
