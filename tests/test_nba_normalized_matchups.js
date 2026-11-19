'use strict';
const assert=require('node:assert/strict'),engine=require('../nba_matchup_discovery'),boxes=require('../nba_possession_engine'),lines=require('../nba_prop_lines');
const now=Date.parse('2026-11-18T18:00:00Z'),positions=['PG','SG','SF','PF','C'],teams=['A','B','C','D','E','F'];
const roster={generated_at:new Date(now).toISOString(),teams:{},players:{}},injuries={generated_at:new Date(now).toISOString(),status:'ok',injuries:[]};
function player(team,pos,index,bench=false){const id=team+pos+(bench?'bench':'');return{id,name:id,team,position:pos,starter:!bench,stats:{MIN:'40',PTS:'20',FG:'10-20','3PT':'0-0',FT:'0-0',OREB:'2',DREB:String(team==='A'&&pos==='C'&&!bench?20+index%2:6),REB:String(team==='A'&&pos==='C'&&!bench?22+index%2:8),AST:String(team==='A'&&pos==='PG'?10:3),TO:'2'}}}
function players(team,index){return[...positions.map(p=>player(team,p,index)),player(team,'C',index,true)]}
for(const team of teams){const rows=players(team,0);roster.teams[team]=rows.map(p=>p.id);for(const p of rows)roster.players[p.id]={name:p.name,team,position:p.position};}
const historical=[];for(let n=0;n<10;n++)for(let i=0;i<3;i++)historical.push({id:'prior-'+n+'-'+i,date:new Date(now-(11-n)*86400000).toISOString(),season_type:2,status:'STATUS_FINAL',home:teams[i*2],away:teams[i*2+1],players:[...players(teams[i*2],n),...players(teams[i*2+1],n)]});
const feed={generated_at:new Date(now).toISOString(),games:historical},game={id:'target',home:'A',away:'B',status:'STATUS_SCHEDULED',date:new Date(now+6*3600000).toISOString()};
const records=boxes.records(feed,now),evidence=engine.defensiveEvidence(records,roster.players);
assert.equal(records.length,30);assert(records.every(r=>r.poss===120),'Existing FG/FT pair parser supplies real possession estimates without FGA/FTA fields');
assert(historical.every(g=>g.players.every(p=>!Object.hasOwn(p.stats,'FGA')&&!Object.hasOwn(p.stats,'FTA'))));
const researched=engine.analyze(game,feed,roster,injuries,now),candidate=researched.candidates.find(r=>r.playerId==='AC'&&r.market==='rebounds');
assert(candidate,'Supported opportunity and strong normalized defense should retain an 85+ candidate');assert.equal(candidate.paceEstimate,120);
assert.equal(researched.roleEvidence.players[candidate.playerId],candidate.roleEvidence,'Game-first consumers retain the same role evidence even when another market is held');
assert(candidate.weakness.normalizedAllowed>candidate.weakness.normalizedLeagueAverage);assert(candidate.weakness.shrunkNormalizedAllowed<candidate.weakness.scheduleAdjustedAllowed);
assert.equal(candidate.weakness.shrinkage,10/18);assert.equal(candidate.weakness.priorGames,8);assert.equal(candidate.weakness.allowanceBasis,'per_100_possessions_per_48_position_minutes');
assert.equal(candidate.researchScore,candidate.matchupRating.factors.reduce((sum,f)=>sum+f.points,0));assert(candidate.researchScore>=85&&candidate.researchScore<=100);
assert.equal(candidate.linePolicy,lines.POLICY);assert.equal(candidate.recommendedOverLine,candidate.baseline-.5);assert.deepEqual(candidate.selectedLineEvidence,lines.select({market:'rebounds',samples:candidate.roleEvidence.selectionSamples.rebounds,sampleKind:'role_adjusted_history'}));
assert.equal(candidate.last5.hits,candidate.history.slice(0,5).filter(x=>x>=candidate.baseline).length,'Recorded hit display must not substitute constructed line-selection samples');
assert.deepEqual(engine.analyze(game,{...feed,odds:-5000,impliedProbability:.99},roster,injuries,now).candidates,researched.candidates);

// Hold the basketball rates constant while changing overtime/positional exposure.
function normalizedGame(id,date,scale=1,twoCenters=false){
 const rotation=(team)=>[...positions,'C'].map((pos,i)=>({id:team+pos+i,name:team+pos+i,team,position:pos,stats:{MIN:String(40*scale),PTS:String(40*scale),REB:String(10*scale),AST:String(5*scale),'3PT':`${2*scale}-${4*scale}`}}));
 const ps=rotation('X');
 if(twoCenters)ps.find(p=>p.position==='PF').position='C';
 const qs=rotation('Y');
 return{id,date,home:'X',away:'Y',players:[...ps,...qs],poss:100,duration:48*scale};
}
const regular=normalizedGame('reg','2026-10-10T00:00:00Z'),overtime=normalizedGame('ot','2026-10-11T00:00:00Z',2),doublePosition=normalizedGame('double','2026-10-12T00:00:00Z',1,true);
const exposed=engine.defensiveEvidence([regular,overtime,doublePosition]).samples.filter(r=>r.attacking==='X');
const byId=Object.fromEntries(exposed.map(r=>[r.game,r]));
assert.equal(byId.ot.values.C.points,byId.reg.values.C.points*2);assert.equal(byId.ot.normalized.C.points,byId.reg.normalized.C.points,'Overtime must not inflate the rate');
assert.equal(byId.double.positionMinutes.C,120);assert.equal(byId.double.values.C.points,120);assert.equal(byId.double.normalized.C.points,byId.reg.normalized.C.points,'More minutes assigned to a listed position must not manufacture weakness');
const faster={...regular,id:'fast',poss:125},fast=engine.defensiveEvidence([faster]).samples.find(r=>r.attacking==='X');assert(Math.abs(fast.normalized.C.points-byId.reg.normalized.C.points*.8)<1e-10,'The same allowed production over more possessions is a lower allowance rate');

// A game's own/future outcomes cannot affect its earlier opponent-strength baseline.
const supported=evidence.samples.find(r=>r.opponentStrength.C.rebounds.available);assert(supported);
const current=records.find(r=>String(r.id)===supported.game),changed=structuredClone(records),modified=changed.find(r=>r.id===current.id);
for(const p of modified.players)if(p.team===supported.attacking){p.stats.REB='999';p.stats.OREB='2';p.stats.DREB='997'}
const after=engine.defensiveEvidence(changed,roster.players).samples.find(r=>r.game===supported.game&&r.attacking===supported.attacking);
assert.deepEqual(after.opponentStrength.C.rebounds,supported.opponentStrength.C.rebounds,'Current-game production must not enter its own prior strength estimate');
const overlapping=normalizedGame('still-in-progress-at-cutoff',new Date(Date.parse(supported.date)-3600000).toISOString());
for(const p of overlapping.players)p.stats.REB='999';
const withOverlap=engine.defensiveEvidence([...records,overlapping],roster.players).samples.find(r=>r.game===supported.game&&r.attacking===supported.attacking);
assert.deepEqual(withOverlap.opponentStrength.C.rebounds,supported.opponentStrength.C.rebounds,'Earlier tipoff is not completed evidence: overlapping games must stay outside the prior-strength baseline');
const earliest=evidence.samples.at(-1).opponentStrength.C.rebounds;assert.equal(earliest.available,false);assert.equal(earliest.adjustment,0);assert.equal(earliest.opponentRate,null);
const future=structuredClone(historical[0]);future.id='not-yet-played';future.date=new Date(now+86400000).toISOString();future.players.forEach(p=>{p.stats.REB='999';p.stats.DREB='997'});
assert.deepEqual(engine.analyze(game,{...feed,games:[...historical,future]},roster,injuries,now),researched);

const held=engine.analyze(game,feed,roster,{...injuries,injuries:[{player_id:'AC',status:'OUT'}]},now);
assert.equal(held.ready,false);assert.equal(held.candidates.length,0);assert(held.reason);assert(held.weaknesses.length,'Unsupported rotation remains visible research, never fabricated picks');
const stale=engine.analyze(game,{...feed,generated_at:'2000-01-01T00:00:00Z'},roster,injuries,now);assert.equal(stale.ready,false);assert.equal(stale.candidates.length,0);
assert(researched.candidates.every(row=>row.side==='over'&&engine.qualifies(row)));
console.log('NBA normalized selection: FG/FT pace, overtime/positional-minute exposure, prior-only schedule strength, shrinkage, shared role/line policy, freshness and 85+ OVER gates PASS');
