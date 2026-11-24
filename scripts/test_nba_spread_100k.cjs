/* Read-only 100k-draw NBA spread audit: no odds, no ledger writes. */
'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {capture}=require('./nba_spread_prospective.cjs');
const read=p=>JSON.parse(fs.readFileSync('data/'+p,'utf8'));
const feed=read('nba_games.json'),injuries=read('nba_injuries.json'),rosters=read('nba_rosters.json'),context=read('nba_game_context.json');
const now=Date.now(),et=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date(d));
const upcoming=feed.games.filter(g=>g.status==='STATUS_SCHEDULED'&&Date.parse(g.date)>now&&Date.parse(g.date)<now+48*3600000).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
assert.ok(upcoming.length,'No upcoming games in 48-hour test window');
const date=et(upcoming[0].date),games=upcoming.filter(g=>et(g.date)===date);
const ids=new Set(games.map(g=>String(g.id)));
const scoped={...feed,games:feed.games.filter(g=>g.status==='STATUS_FINAL'||ids.has(String(g.id)))};
const before=JSON.stringify(scoped);
const small=capture(scoped,injuries,rosters,context,now,10000);
const large=capture(scoped,injuries,rosters,context,now,100000);
assert.equal(JSON.stringify(scoped),before,'Feed was mutated');
assert.equal(small.failures.length,0,JSON.stringify(small.failures));
assert.equal(large.failures.length,0,JSON.stringify(large.failures));
assert.equal(small.forecasts.length,games.length,'Missing 10k game');
assert.equal(large.forecasts.length,games.length,'Missing 100k game');
const records=large.forecasts.map(r=>{
 const prior=small.forecasts.find(x=>x.game_id===r.game_id);assert.ok(prior);
 assert.equal(r.draws,100000);
 for(const name of ['baseline','candidate']){
  const d=r[name];assert.ok(Number.isFinite(d.margin));
  assert.equal(d.probabilities.length,7);
  assert.ok(d.probabilities.every((p,i,a)=>Number.isFinite(p)&&p>=0&&p<=1&&(!i||p<=a[i-1])));
  assert.ok(d.interval80.every(Number.isFinite)&&d.interval80[0]<=d.interval80[1]);
  assert.ok(Math.abs(d.margin-prior[name].margin)<=2,'Margin unstable: '+r.game_id+' '+name);
  assert.ok(d.probabilities.every((p,i)=>Math.abs(p-prior[name].probabilities[i])<=.03),'Spread probability unstable: '+r.game_id+' '+name);
 }
 return {game_id:r.game_id,away:r.away,home:r.home,start:r.start,draws:r.draws,baseline:r.baseline,candidate:r.candidate,
 max_probability_delta:Math.max(...r.candidate.probabilities.map((p,i)=>Math.abs(p-prior.candidate.probabilities[i]))),
 baseline_margin_delta:Math.abs(r.baseline.margin-prior.baseline.margin)};
});
console.log(JSON.stringify({status:'PASS_NUMERICAL_STABILITY_ONLY',date,records,limits:'Same-seed 10k vs 100k comparison; not independent outcome validation. No production forecast writes or market inputs.'},null,2));
