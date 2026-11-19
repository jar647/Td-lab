/* NBA prop evidence is shared with the existing rotation engine, never a new simulator. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const boxes=require('../nba_possession_engine'),api=require('../nba_prop_evidence');
const clock=Date.parse('2026-11-18T12:00:00Z'),stamp=new Date(clock).toISOString();
function fixture(){
 const roster={generated_at:stamp,teams:{A:Array.from({length:8},(_,i)=>'A'+i),B:Array.from({length:8},(_,i)=>'B'+i)}};
 const player=(team,i)=>({id:team+i,name:team+' Player '+i,team,starter:i<5,didNotPlay:false,stats:{MIN:'30',FG:'4-10','3PT':'1-3',FT:'2-2',PTS:'11',OREB:'1',DREB:'4',REB:'5',AST:'3',TO:'1'}});
 const games=Array.from({length:12},(_,i)=>({id:'g'+i,date:new Date(clock-(i+1)*86400000).toISOString(),home:'A',away:'B',status:'STATUS_FINAL',season_type:2,players:['A','B'].flatMap(t=>Array.from({length:8},(_,j)=>player(t,j)))}));
 const game={id:'upcoming',home:'A',away:'B',date:new Date(clock+6*3600000).toISOString(),status:'STATUS_SCHEDULED',season_type:2};
 return {game,feed:{generated_at:stamp,games},roster,injuries:{generated_at:stamp,status:'ok',injuries:[]}};
}
const run=(f,options={},now=clock)=>api.analyze(f.game,f.feed,f.roster,f.injuries,now,options);
const f=fixture(),before=JSON.stringify(f),normal=run(f);
assert(normal.ready,normal.reason);assert.equal(Object.keys(normal.players).length,16);assert.equal(JSON.stringify(f),before);
for(const team of ['A','B']){
 const rows=Object.values(normal.players).filter(p=>p.team===team);
 assert(Math.abs(rows.reduce((s,p)=>s+p.projectedMinutes,0)-240)<1e-7);
 assert(Math.abs(rows.reduce((s,p)=>s+p.opportunityShare,0)-1)<1e-10);
 for(const p of rows){
  assert(p.eligible);assert.equal(p.roleStatus,'SUPPORTED');assert.equal(p.status,'NOT LISTED');assert.equal(p.minutesLow,30);assert.equal(p.minutesHigh,30);
  assert(Math.abs(p.attempts.fga-10)<1e-10);assert(Math.abs(p.attempts.threeAttempts-3)<1e-10);assert(Math.abs(p.attempts.freeThrows-2)<1e-10);
  assert.equal(p.historyGames,12);assert.equal(p.selectionSamples.points.length,12);assert(p.selectionSamples.points.every(v=>v===11));
  assert(p.selectionSamples.pr.every(v=>v===16));assert(p.selectionSamples.pra.every(v=>v===19));
  assert.equal(p.sampleKind,'role_adjusted_history');assert.equal(p.tracking.potentialAssists,null);assert.equal(p.tracking.reboundChances,null);
  assert.match(p.opportunityBasis,/proxy, not official usage or tracking/);
 }
}
// Reuse precomputed models/outcomes without duplicating either build or draws.
const originalBuild=boxes.build,originalDraws=boxes.draws,simulation={playerOutcomes:{verified:'already computed'}};
try{boxes.build=()=>{throw Error('should not rebuild')};boxes.draws=()=>{throw Error('should not redraw')};const reused=run(f,{model:normal.model,simulation});assert(reused.ready,reused.reason);assert.equal(reused.model,normal.model);assert.equal(reused.simulation,simulation);assert.deepEqual(reused.players,normal.players)}finally{boxes.build=originalBuild;boxes.draws=originalDraws}
// Known OUT changes minutes through the actual engine and never remains eligible.
const out=fixture();out.injuries.injuries=[{player_id:'A0',player:'A Player 0',status:'OUT'}];const excluded=run(out);assert(excluded.ready,excluded.reason);assert(!excluded.players.A0);assert(excluded.players.A1.absentTeammates.includes('A Player 0'));assert(excluded.players.A1.projectedMinutes>30);assert(excluded.players.A1.eligible);assert(excluded.players.A1.selectionSamples.points[0]>11);assert.equal(excluded.players.A1.observedHistory[0].points,11,'Constructed role samples must not rewrite recorded history');
// No guessed questionable participation probability; use conservative supported bounds.
const uncertain=fixture();uncertain.injuries.injuries=[{player_id:'A0',player:'A Player 0',status:'QUESTIONABLE'}];const q=run(uncertain);assert(q.ready,q.reason);assert.equal(q.players.A0.eligible,false);assert.equal(q.players.A0.roleStatus,'HELD');assert.equal(q.players.A1.projectedMinutes,30);assert(q.players.A1.minutesHigh>34);assert.match(q.players.A0.holdReasons.join(' '),/uncertain/);assert(Math.abs(q.players.A1.opportunityShare-.125)<1e-12);
const sparse=fixture();sparse.injuries.injuries=['A0','A1','A2'].map(player_id=>({player_id,status:'QUESTIONABLE'}));const noRotation=run(sparse);assert.equal(noRotation.ready,false);assert.match(noRotation.reason,/fewer than six/);assert.deepEqual(noRotation.players,{});
const variable=fixture();variable.injuries.injuries=['A0','A1'].map(player_id=>({player_id,status:'QUESTIONABLE'}));const unstable=run(variable);assert(unstable.ready);assert.equal(unstable.players.A2.eligible,false);assert.match(unstable.players.A2.holdReasons.join(' '),/more than six minutes/);
// Large known-absence minutes jumps need observed starter-role support, not more confidence.
const promoted=fixture();promoted.injuries.injuries=['A0','A1'].map(player_id=>({player_id,status:'OUT'}));const unsupported=run(promoted);assert(unsupported.ready);assert.equal(unsupported.players.A2.eligible,false);assert.match(unsupported.players.A2.holdReasons.join(' '),/workload jump/);
for(let i=0;i<promoted.feed.games.length;i++){
 const g=promoted.feed.games[i],p=g.players.find(p=>p.id==='A2'),other=g.players.find(p=>p.id==='A3');p.starter=i>=5&&i<8;
 if(p.starter){p.stats.MIN='38';other.stats.MIN='22'}
}
const supported=run(promoted);assert(supported.ready,supported.reason);assert.equal(supported.players.A2.starterGames,3);assert.equal(supported.players.A2.projectedMinutes,40);assert(supported.players.A2.eligible,supported.players.A2.holdReasons.join(';'));
// Existing source/tipoff restrictions also apply to reused models.
for(const key of ['feed','roster','injuries']){const stale=fixture();stale[key].generated_at='2000-01-01T00:00:00Z';const result=run(stale,{model:normal.model});assert.equal(result.ready,false);assert.match(result.reason,/Fresh/)}
const after=run(f,{model:normal.model},Date.parse(f.game.date)+1);assert.equal(after.ready,false);assert.match(after.reason,/after tipoff/);
const near=fixture();near.game.date=new Date(clock+3600000).toISOString();near.injuries.generated_at=new Date(clock-16*60000).toISOString();const nearResult=run(near);assert.equal(nearResult.ready,false);assert.match(nearResult.reason,/15 minutes/);
const changed=fixture();changed.injuries.injuries=[{player_id:'A0',status:'QUESTIONABLE'}];const oldAvailability=run(changed,{model:normal.model});assert.equal(oldAvailability.ready,false);assert.match(oldAvailability.reason,/availability changed/);
const wrong=structuredClone(normal.model);wrong.game.id='different';assert.equal(run(f,{model:wrong}).ready,false);
const wrongSources=structuredClone(normal.model);wrongSources.inputTimes.injuries='2026-11-18T11:59:00Z';assert.equal(run(f,{model:wrongSources}).ready,false);
// Fresh availability delivered in the existing rich context is the effective source.
const freshContext=fixture(),contextAvailability={...freshContext.injuries,generated_at:new Date(clock-60000).toISOString()};
freshContext.injuries.generated_at=new Date(clock-3600000).toISOString();
const context={availability:contextAvailability,games:{},sources:{}};
const withContext=run(freshContext,{context});assert(withContext.ready,withContext.reason);assert.equal(withContext.inputTimes.injuries,contextAvailability.generated_at);
assert(run(freshContext,{context,model:withContext.model}).ready,'Valid rich-context injury timestamps must not be rejected because the published injury argument is older');
// A newly supplied lineup snapshot invalidates precomputed role weights even when injury timestamps match.
const newLineupContext={generated_at:stamp,games:{},sources:{}};
const oldLineup=run(f,{context:newLineupContext,model:normal.model});assert.equal(oldLineup.ready,false);assert.match(oldLineup.reason,/lineup context changed/);
// Unknown rates and sparse history remain unknown/held, not synthetic zeros.
const missing=structuredClone(normal.model);missing.teams.A.players[0].fga=NaN;const noAttempts=run(f,{model:missing});assert(noAttempts.ready);assert.equal(noAttempts.players.A0.attempts.fga,null);assert.equal(noAttempts.players.A0.eligible,false);assert.match(noAttempts.players.A0.holdReasons.join(' '),/incomplete/);
const limited=structuredClone(normal.model);limited.teams.A.players[0].statHistory=limited.teams.A.players[0].statHistory.slice(0,4);const noHistory=run(f,{model:limited});assert.equal(noHistory.players.A0.eligible,false);assert.match(noHistory.players.A0.holdReasons.join(' '),/five supported/);
const ambiguous=fixture();for(const g of ambiguous.feed.games)g.players.find(p=>p.id==='B0').id='A0';ambiguous.roster.teams.B[0]='A0';const doubleIdentity=run(ambiguous);assert.equal(doubleIdentity.ready,false);assert.match(doubleIdentity.reason,/both current rosters|identity is ambiguous/);
// Target/future outcomes and market quotes cannot alter supported historical evidence.
const future=fixture(),leak=structuredClone(future.feed.games[0]);leak.id='future-result';leak.date=new Date(clock+86400000).toISOString();for(const p of leak.players)p.stats.PTS='999';future.feed.games.push(leak);assert.deepEqual(run(future),normal);
const book=fixture();book.game.odds={total:999,homeMoneyline:-10000};book.feed.bookmaker='unrelated';book.game.impliedWinProbability=.999;assert.deepEqual(run(book),normal);
const script=fs.readFileSync(require.resolve('../nba_prop_evidence'),'utf8'),sandbox={CookNBAPossessions:boxes,CookNBAGameContext:require('../nba_game_context')};vm.createContext(sandbox);vm.runInContext(script,sandbox);assert(sandbox.CookNBAPropEvidence);assert.equal(JSON.stringify(sandbox.CookNBAPropEvidence.analyze(f.game,f.feed,f.roster,f.injuries,clock)),JSON.stringify(normal));
console.log('NBA prop role evidence: observed opportunities, supported rotation bounds, no fabricated tracking, source/identity gates, role-change holds and market-independent samples PASS');
