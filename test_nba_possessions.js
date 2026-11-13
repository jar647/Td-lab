'use strict';const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),p=require('./nba_possession_engine'),e=require('./game_odds_engine'),ui=require('./nba_simulator_ui');
const read=n=>JSON.parse(fs.readFileSync('data/'+n+'.json')),feed=read('nba_games'),inj=read('nba_injuries'),roster=read('nba_rosters');const realNow=Date.now,fixtureNow=Date.parse(feed.generated_at);Date.now=()=>fixtureNow;const game=feed.games.find(g=>g.status==='STATUS_SCHEDULED'&&Date.parse(g.date)>fixtureNow);assert.ok(game);
const now=Date.parse(feed.generated_at);inj.generated_at=roster.generated_at=new Date(now).toISOString();
const model=p.build(game,feed,inj,roster,now);
for(const t of Object.values(model.teams)){assert.ok(Math.abs(Object.values(t.minutes).reduce((a,b)=>a+b,0)-240)<1e-7);assert.ok(Object.values(t.minutes).every(x=>x<=40));}
assert.throws(()=>p.build(game,feed,{...inj,generated_at:'2000-01-01T00:00Z'},roster,now),/Fresh/);
assert.throws(()=>p.build({...game,status:'STATUS_FINAL'},feed,inj,roster,now),/closed/);
const future={...feed,games:[...feed.games,{...feed.games.find(g=>g.status==='STATUS_FINAL'),id:'leak',date:new Date(Date.parse(game.date)+86400000).toISOString()}]};assert.deepEqual(p.build(game,future,inj,roster,now),model);
const d=p.draws(model,1000,77),repeat=p.draws(model,1000,77);assert.deepEqual(d,repeat);assert.ok(d.home.every((x,i)=>Number.isInteger(x)&&x!==d.away[i]));
const avg=a=>a.reduce((s,x)=>s+x,0)/a.length;
for(const [team,scores]of [[game.home,d.home],[game.away,d.away]]){assert.ok(Math.abs(d.players.filter(x=>x.team===team).reduce((s,x)=>s+x.points,0)-avg(scores))<1e-7);assert.ok(Math.abs(d.players.filter(x=>x.team===team).reduce((s,x)=>s+x.minutes,0)-(240+25*d.overtimePeriods))<1e-6);}
const star=model.teams[game.home].players.filter(x=>!x.pending).sort((a,b)=>b.fga*b.weight-a.fga*a.weight)[0];const outInj={...inj,injuries:[...(inj.injuries||[]).filter(x=>String(x.player_id||x.id)!==star.id&&pNorm(x.player)!==pNorm(star.name)),{player_id:star.id,player:star.name,status:'OUT'}]};function pNorm(x){return String(x||'').toLowerCase()}
const without=p.build(game,feed,outInj,roster,now);assert.ok(!without.teams[game.home].players.some(x=>x.id===star.id));assert.ok(without.teams[game.home].absent.includes(star.name));assert.notDeepEqual(p.draws(without,1000,77).home,d.home,'Removing a rotation player must change scoring');
const prepared=e.nbaGame(game,feed,{injuries:inj,rosters:roster,now}),market={homeSpread:-3.5,total:225.5,homeML:-110,awayML:100,homeATS:-110,awayATS:-110,over:-110,under:-110};const r=e.simulate(prepared,market,1000,44),repriced=e.simulate(prepared,{...market,homeML:-160,total:210.5},1000,44);assert.deepEqual(r.simulated,repriced.simulated,'Book quotes never steer independent outcomes');assert.ok(r.possession.players.length>=12);
prepared.slipLegs=[{player:star.name,market:'points',line:15.5,side:'over'},{player:star.name,market:'pra',line:20.5,side:'over'}];const joint=e.simulate(prepared,market,1000,44).possession;assert.ok(joint.jointHitRate<=Math.min(...joint.legs.map(x=>x.hitRate))+1e-9);
// Three-pointers are counted in the SAME simulated possessions as team/player points.
for(const team of Object.values(model.teams))for(const p of team.players)assert(p.statHistory.every(r=>Number.isInteger(r.threes)&&r.threes>=0),'Observed 3PM must enter source history');
const threeLegs=[{player_id:star.id,market:'threes',line:1.5,side:'over'},{player_id:star.id,market:'threes',line:1.5,side:'under'}];
const shooting=p.draws(model,1000,77,{collectPlayerOutcomes:true,legs:threeLegs});assert.deepEqual(shooting.home,d.home);assert.deepEqual(shooting.away,d.away,'Recording 3PM never changes RNG or game outcomes');
for(const x of shooting.players){const samples=shooting.playerOutcomes[x.id];assert.equal(samples.threes.length,1000);assert(samples.threes.every((v,i)=>Number.isInteger(v)&&v>=0&&3*v<=samples.points[i]));assert(Math.abs(x.threes-avg(samples.threes))<1e-9)}
const madeSamples=shooting.playerOutcomes[star.id].threes;assert.equal(shooting.legs[0].hitRate,madeSamples.filter(x=>x>1.5).length/1000);assert.equal(shooting.legs[1].hitRate,madeSamples.filter(x=>x<1.5).length/1000);assert.equal(shooting.jointHitRate,0);
const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};ui.capture(r,prepared,storage,now);const first=storage.getItem(ui.KEY);ui.capture({...r,simulated:{...r.simulated,home:999}},prepared,storage,now+1000);assert.equal(storage.getItem(ui.KEY),first,'Frozen same-quote prediction cannot be rewritten');assert.equal(ui.grade(feed,storage).graded,0);
const final={...game,status:'STATUS_FINAL',players:[...Array.from({length:7},(_,i)=>({team:game.home,stats:{PTS:15}})),...Array.from({length:7},(_,i)=>({team:game.away,stats:{PTS:14}}))]};const grades=ui.grade({games:[final],generated_at:new Date().toISOString()},storage,Date.parse(game.date)+3600000);assert.equal(grades.graded,1);assert.ok(Number.isFinite(grades.brier));assert.equal(grades.marketBlend1.games,1);assert.match(ui.detail(r,prepared),/Your lines do not change/);assert.ok(r.markets.every(x=>!x.eligible),'Candidate is not promoted before calibration approval');
const pub=require('./scripts/publish_nba_simulator');
const scoredBias=pub.scoreBias([
 {home:110,away:100,baseline:{home:108,away:102},grade:{home:102,away:100}},
 {home:95,away:103,baseline:{home:96,away:101},grade:{home:100,away:102}}
]);
assert.equal(scoredBias.all.games,2);
assert.equal(scoredBias.projected_favorite_8plus.games,2);
assert.equal(scoredBias.projected_home_favorite.games,1);
assert.equal(scoredBias.projected_away_favorite.games,1);
assert.equal(scoredBias.all.total_bias,2);
assert.equal(scoredBias.all.margin_bias,1);
assert.equal(scoredBias.all.projected_winner_accuracy,1);
assert.equal(pub.scoreBias([]).all.total_bias,null,'Do not fake zero bias from empty history');
assert.match(ui.validation({prospective:{games:2},prospective_bias:scoredBias}),/Prospective score bias/);
const shadowSummary={status:'RESEARCH ONLY',replay:{games:2,raw_margin_mae:12,shadow_margin_mae:11,raw_total_mae:14,shadow_total_mae:13},frozen:{games:0}};
assert.match(ui.validation({prospective:{games:2},shadow_score_calibration:shadowSummary}),/chronological replay/);
assert.match(ui.validation({prospective:{games:2},shadow_score_calibration:shadowSummary}),/NOT applied/);
const ensembleSummary={retrospective:{weights:[{baseline_weight:0,games:2,margin_mae:12,total_mae:14},{baseline_weight:.5,games:2,margin_mae:11,total_mae:13},{baseline_weight:1,games:2,margin_mae:11.5,total_mae:13.5}]},frozen:{weights:[{baseline_weight:.5,games:0}]}};
const ensembleHtml=ui.validation({prospective:{games:2},ensemble_score_audit:ensembleSummary});
assert.match(ensembleHtml,/fixed-weight experiment/);
assert.match(ensembleHtml,/50%/);
assert.match(ensembleHtml,/forward-tested frozen 50\/50 blend: 0 graded games/);

assert.equal(pub.grade({locked_at:game.date,tipoff:game.date},final),null,'Never grade a post-tipoff capture');
const os=require('os'),path=require('path'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'nba-archive-'));
try{fs.mkdirSync(path.join(tmp,'data'));const write=(n,x)=>fs.writeFileSync(path.join(tmp,'data',n+'.json'),JSON.stringify(x));write('nba_games',{...feed,games:feed.games.filter(g=>g.status==='STATUS_FINAL'||g.id===game.id)});write('nba_injuries',inj);write('nba_rosters',roster);
const report=pub.publish(tmp,now,0,1000);
assert.equal(report.shadow_score_calibration.approved,false);
assert.equal(report.shadow_score_calibration.replay.games,0);
assert.equal(report.ensemble_score_audit.approved,false);
assert.equal(report.ensemble_score_audit.retrospective.weights[0].games,0);
assert.equal(report.forecasts[0].ensemble_shadow.status,'SHADOW_ONLY');
assert.deepEqual(report.forecasts[0].ensemble_shadow.scores.map(x=>x.baseline_weight),[0,.25,.5,.75,1]);
assert.equal(report.forecasts.length,1);const archive=JSON.parse(fs.readFileSync(path.join(tmp,'data/nba_simulator_locks.json')));assert.equal(archive.snapshots.length,1);const frozen=JSON.stringify(archive.snapshots[0]);pub.publish(tmp,now+1000,0,1000);assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(path.join(tmp,'data/nba_simulator_locks.json'))).snapshots[0]),frozen);// A slate game must remain forecastable when a possible all-out combination
// lacks enough healthy rotation players; use score history, not fake player stats.
const originalRotation=model.teams[game.home].players,homeIds=new Set(originalRotation.map(p=>String(p.id))),homeNames=new Set(originalRotation.map(p=>p.name.toLowerCase()));
assert.ok(originalRotation.length>=6,'Fixture requires a supported rotation');
const questionable={...inj,injuries:[...(inj.injuries||[]).filter(x=>!homeIds.has(String(x.player_id||x.id||''))&&!homeNames.has(String(x.player||x.name||'').toLowerCase())),...originalRotation.map((p,i)=>({player_id:p.id,player:p.name,status:i<5?'ACTIVE':'QUESTIONABLE'}))]};
const fallbackModel=e.nbaGame(game,feed,{injuries:questionable,rosters:roster,now,allowScoreFallback:true});
assert.ok(fallbackModel.rotationFallback,'Unsupported all-out rotation must use labeled score fallback');
const fallbackResult=e.simulate(fallbackModel,{},1000,44);
assert.equal(fallbackResult.possession,null);
assert.ok(fallbackResult.markets.every(m=>m.signal.includes('PASS')||m.signal==='NO ODDS ENTERED'));
write('nba_injuries',questionable);
const fallbackReport=pub.publish(tmp,now,0,1000);
assert.equal(fallbackReport.fallback_forecasts,1);
assert.equal(fallbackReport.failures.length,0);
assert.equal(fallbackReport.forecasts[0].model,'nba-team-score-fallback-v1');
assert.equal(fallbackReport.forecasts[0].ensemble_shadow,null,'Team-score fallback cannot masquerade as an independent ensemble');
assert.equal(fallbackReport.forecasts[0].player_projections.length,0);
assert.equal(fallbackReport.forecasts[0].rotation_fallback.teams[0].availablePlayers,5);
assert.ok(fallbackReport.forecasts[0].detailed_game_runs===1000);
write('nba_games',{...feed,games:[final]});const graded=pub.publish(tmp,Date.parse(game.date)+10800000,0,1000);assert.equal(graded.prospective.games,1);assert.equal(graded.ensemble_score_audit.frozen.weights[2].games,1,'Pregame frozen 50/50 score must be graded only after final');const lock=JSON.parse(fs.readFileSync(path.join(tmp,'data/nba_simulator_locks.json'))).snapshots[0];delete lock.grade;delete lock.graded_at;assert.equal(JSON.stringify(lock),frozen,'Grading must not rewrite the frozen forecast');}finally{fs.rmSync(tmp,{recursive:true,force:true})}
console.log('NBA possessions: injuries, rotations, shared players/scores, market isolation, joints, immutable locks and grading PASS');

Date.now=realNow;
