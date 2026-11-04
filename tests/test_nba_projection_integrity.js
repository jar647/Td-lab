'use strict';const assert=require('node:assert/strict'),fs=require('node:fs'),p=require('../nba_possession_engine'),research=require('../nba_game_first'),{audit}=require('../scripts/audit_nba_projections');
const read=n=>JSON.parse(fs.readFileSync('data/'+n+'.json')),feed=read('nba_games'),injuries=read('nba_injuries'),rosters=read('nba_rosters'),context=read('nba_game_context');
const now=Math.max(...[feed,injuries,rosters].map(d=>Date.parse(d.generated_at)))+1000,game=feed.games.find(g=>g.status==='STATUS_SCHEDULED'&&g.home==='New York Knicks'&&g.away==='Chicago Bulls');assert(game);

const recovered=feed.games.find(g=>g.id==='401909095'),ny=recovered.players.filter(p=>p.team==='New York Knicks');assert(p.box(ny),'A fully documented zero-minute placeholder must not discard Towns valid game');
const incomplete=structuredClone(ny),placeholder=incomplete.find(p=>p.stats?.MIN==='--'&&!p.didNotPlay);assert(placeholder);delete placeholder.stats.MIN;assert.equal(p.box(incomplete),null,'Missing minutes remain unknown, even with zero production');
const invalid=structuredClone(ny),bad=invalid.find(p=>p.stats?.MIN==='--'&&!p.didNotPlay);bad.stats.AST='1';assert.equal(p.box(invalid),null,'A placeholder with any production must fail closed');

const model=p.build(game,feed,injuries,rosters,now,{context});
for(const t of Object.values(model.teams)){assert(t.liveRebound>0&&t.liveRebound<=1);assert(t.allowLiveRebound>0&&t.allowLiveRebound<=1)}
const noPlayerRebounds=structuredClone(model);for(const t of Object.values(noPlayerRebounds.teams)){t.liveRebound=0;t.allowLiveRebound=0}
assert(p.draws(noPlayerRebounds,1000,123).players.every(p=>p.rebounds===0),'Dead-ball misses must never produce player rebounds');
const a=research.analyze(game,feed,injuries,rosters,context,now),towns=a.rows.find(r=>r.name==='Karl-Anthony Towns'&&r.market==='Rebounds + Assists');assert(towns);assert(towns.reviewRequired,'Unsupported Towns minutes jump must be held for review');assert(towns.reviewReasons.some(x=>x.includes('workload')));assert(!research.build(a.rows).picks.some(r=>r.name==='Karl-Anthony Towns'),'A high simulated frequency cannot bypass the workload gate');assert.equal(research.candidate({...towns,line:1,probability:.99}),null);
const final=feed.games.filter(g=>g.status==='STATUS_FINAL'&&g.season_type===2).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date))[0];
const before=audit(feed,p,{gameIds:[final.id],includeRows:true}),mutated=structuredClone(feed),target=mutated.games.find(g=>g.id===final.id);for(const x of target.players){if(x.stats)x.stats.PTS='999'}
const after=audit(mutated,p,{gameIds:[final.id],includeRows:true});assert(before.observations.length>0);assert.deepEqual(before.observations.map(x=>[x.player,x.market,x.prediction,x.baseline]),after.observations.map(x=>[x.player,x.market,x.prediction,x.baseline]),'Target-game actuals must never enter the predictor or baseline');
console.log('NBA projection integrity: dead-ball accounting, unsupported workload gates and walk-forward cutoff PASS');
