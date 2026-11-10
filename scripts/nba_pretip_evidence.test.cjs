'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {hasDatedInjuries,hasClosingMarket}=require('./nba_pretip_evidence.cjs');
const tip='2026-11-10T23:00:00Z';
const market={captured_at:'2026-11-10T22:59:00Z',home_spread:0,total:220,home_moneyline:-110,away_moneyline:100};
const injuries={captured_at:'2026-11-10T22:59:00Z',players:[]};
test('accepts genuine pretip snapshots including valid zero spread',()=>{
 assert.equal(hasClosingMarket({date:tip,closing_market:market}),true);
 assert.equal(hasDatedInjuries({date:tip,pretip_injury_snapshot:injuries}),true);
});
test('rejects snapshots at tipoff, after tipoff, or without valid game time',()=>{
 for(const t of [tip,'2026-11-11T00:00:00Z','not-a-date']){
  assert.equal(hasClosingMarket({date:tip,closing_market:{...market,captured_at:t}}),false);
  assert.equal(hasDatedInjuries({date:tip,pretip_injury_snapshot:{...injuries,captured_at:t}}),false);
 }
 assert.equal(hasClosingMarket({closing_market:market}),false);
});
test('rejects null, blank, missing, and nonfinite sportsbook fields',()=>{
 for(const value of [null,undefined,'',false,'NaN','Infinity']){
  assert.equal(hasClosingMarket({date:tip,closing_market:{...market,total:value}}),false);
 }
});
test('requires actual injury player array',()=>{
 for(const players of [null,undefined,{},'unknown']){
  assert.equal(hasDatedInjuries({date:tip,pretip_injury_snapshot:{...injuries,players}}),false);
 }
});

test('rejects whitespace and nonscalar market values',()=>{
 for(const value of ['  ',[],{},'\\t'])assert.equal(hasClosingMarket({date:tip,closing_market:{...market,total:value}}),false);
});
test('does not bypass malformed primary game date using a fallback field',()=>{
 assert.equal(hasClosingMarket({date:'invalid',tipoff:tip,closing_market:market}),false);
});

test('market baseline requires source identity and timestamp, never silently trusts unverified odds',()=>{
 const {hasVerifiedMarket,marketProbability}=require('./nba_pretip_evidence.cjs');
 const g={date:tip,closing_market:{...market}};
 assert.equal(hasVerifiedMarket(g),false);assert.equal(marketProbability(g),null);
 const verified={...market,source:'archived-provider',source_event_id:'event-123',source_published_at:'2026-11-10T22:58:00Z',verified:true};
 assert.equal(hasVerifiedMarket({date:tip,closing_market:verified}),true);
 assert.ok(Math.abs(marketProbability({date:tip,closing_market:verified})-.5)<.03);
 for(const change of [{source:''},{source_event_id:''},{verified:false},{source_published_at:'2026-11-10T23:01:00Z'}]){
  const row={date:tip,closing_market:{...verified,...change}};
  assert.equal(hasVerifiedMarket(row),false);assert.equal(marketProbability(row),null);
 }
});
