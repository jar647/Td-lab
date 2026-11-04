'use strict';
const assert=require('node:assert/strict');
require('./quick_slip.js');
const slip=globalThis.CookItUpQuickSlip;
assert.ok(slip,'shared quick-slip API must load');
const pick={sport:'NFL',game:'Week 8 · CAR vs GB',player:'Example Player',team:'CAR',opponent:'GB',market:'Receptions',line:4.5,overOdds:'-115',underOdds:'+100'};
const button=slip.button(pick);
assert.match(button,/quick-slip-add/);
assert.match(button,/data-quick-slip=/);
slip.add(pick);
let saved=slip.getPicks();
assert.equal(saved.length,1);
assert.equal(saved[0].player,'Example Player');
assert.equal(saved[0].line,4.5);
assert.equal(Object.hasOwn(saved[0],'side'),false,'Quick Slip recommendations no longer store a side form field');
assert.equal(Object.hasOwn(saved[0],'odds'),false,'Quick Slip recommendations no longer store an odds form field');
assert.equal(slip.formatRecommendation({player:'Jaden McDaniels',market:'assists',recommendationLine:3}),'3+ assists');
assert.equal(slip.formatRecommendation({player:'Example Player',market:'assists',line:3.5}),'Over 3.5 assists');
slip.add({...pick,line:5.5});
assert.equal(slip.getPicks().length,2,'a different line can be saved as its own leg');
slip.add({...pick,team:'GB'});
assert.equal(slip.getPicks().length,2,'re-adding the same player, market and line updates instead of duplicating');
assert.equal(slip.getPicks()[0].team,'GB');
slip.clear();
slip.add({...pick,recommendationLine:3,sampleHits:7,sampleSize:10,scenarioRate:.64,estimatedEdge:.14,edgeBasis:'break-even'});
saved=slip.getPicks();
assert.equal(saved[0].recommendationLine,3);
assert.equal(saved[0].sampleHits,7);
assert.equal(saved[0].estimatedEdge,.14);
slip.clear();
assert.deepEqual(slip.getPicks(),[]);
for(const file of ['index.html','nba.html','analyst.html']){
 const html=require('node:fs').readFileSync(file,'utf8');
 assert.ok(html.includes('quick_slip.js'),file+' must load the shared slip UI');
 assert.ok(html.includes('CookItUpQuickSlip.button'),file+' must add recommendations to the slip');
}
console.log('Compact NFL/NBA Quick Slip persistence, evidence display, and deduplication checks passed');

// The saved rating belongs to the exact priced side and survives reload.
const rated={sport:'NBA',game:'Away @ Home',player:'Rated Player',market:'assists',line:5.5,side:'under',underOdds:-110,propScore:79,ratedLine:5.5,ratedSide:'UNDER',ratedOdds:-110};
slip.add(rated);
assert.equal(slip.getPicks()[0].propScore,79);
assert.match(slip.formatRating(slip.getPicks()[0]),/Saved rating 79\/100 · at -110/);
const fs=require('node:fs'),vm=require('node:vm');
const stored=JSON.stringify(slip.getPicks()),ctx={localStorage:{getItem:()=>stored},setTimeout};
vm.runInNewContext(fs.readFileSync('quick_slip.js','utf8'),ctx);
assert.equal(ctx.CookItUpQuickSlip.getPicks()[0].propScore,79);
slip.add({...rated,propScore:84,ratedOdds:100,underOdds:100});
assert.equal(slip.getPicks().length,1);assert.equal(slip.getPicks()[0].propScore,84);
slip.add({...rated,underOdds:-130});
assert.equal(slip.getPicks()[0].propScore,null,'Changed quote must not retain old rating');
assert.equal(slip.formatRating(slip.getPicks()[0]),'No saved rating');
assert.equal(slip.formatRating({sport:'NBA',propScore:101}),'No saved rating');
assert.equal(slip.formatRating({sport:'NBA',propScore:null}),'No saved rating');
assert.equal(slip.formatRating({sport:'NFL'}),'');
slip.clear();
console.log('Quick Slip exact-quote rating snapshot, reload and replacement: PASS');

// Legacy selections are repaired without touching already-saved scores or other picks.
slip.add({...rated,propScore:null});slip.add({...pick,line:4.5});
const before=slip.getPicks();
const recovered=slip.recoverRatings(p=>({propScore:76,ratedLine:p.line,ratedSide:'UNDER',ratedOdds:-110}));
assert.equal(recovered.recovered,1);assert.equal(slip.getPicks().length,before.length);
assert.equal(slip.getPicks()[0].ratingRecalculated,true);
assert.match(slip.formatRating(slip.getPicks()[0]),/Recalculated rating 76\/100/);
assert.equal(slip.recoverRatings(()=>{throw Error('Existing scores must not be replaced')}).recovered,0);
slip.add({...rated,propScore:81});assert.equal(slip.getPicks()[0].ratingRecalculated,false);
slip.add({...rated,propScore:null});slip.recoverRatings(()=>({ratingNote:'Enter odds for this selection'}));
assert.match(slip.formatRating(slip.getPicks()[0]),/Enter odds/);
slip.clear();console.log('Legacy rating recovery preserves selections and saved snapshots: PASS');


slip.clear();slip.add({sport:'NBA',player:'History lead',game:'A @ B',market:'rebounds',recommendationLine:6,researchMethod:'position-history',sampleHits:4,sampleSize:5});
assert.match(slip.formatRating(slip.getPicks()[0]),/Position matchup/);
let historicalResolved=false;slip.recoverRatings(()=>{historicalResolved=true;return {ratingNote:'Enter odds'}});assert.equal(historicalResolved,false,'Historical leads never enter sportsbook rating repair');
slip.clear();

slip.add({sport:'NBA',game:'Away @ Home',player:'Position Player',position:'PF',market:'rebounds',recommendationLine:6,researchMethod:'position-history'});
assert.equal(slip.getPicks().find(p=>p.player==='Position Player')?.position,'PF');
assert.ok(require('node:fs').readFileSync('quick_slip.js','utf8').includes("positionSuffix(pick)"),'Saved NBA position must render beside player name');
assert.equal(slip.getPicks().find(p=>p.player==='Position Player')?.player,'Position Player','Position must not be appended to identity or grading key');
slip.clear();
console.log('Quick Slip sourced NBA position metadata: PASS');
