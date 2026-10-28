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
assert.equal(saved[0].side,'','Adding a recommendation must not silently choose a betting side');
assert.equal(saved[0].odds,'');
slip.add({...pick,line:5.5});
assert.equal(slip.getPicks().length,2,'a different line can be saved as its own leg');
slip.add({...pick,team:'GB'});
assert.equal(slip.getPicks().length,2,'re-adding the same player, market and line updates instead of duplicating');
assert.equal(slip.getPicks()[0].team,'GB');
slip.clear();
assert.deepEqual(slip.getPicks(),[]);
for(const file of ['index.html','nba.html','analyst.html']){
 const html=require('node:fs').readFileSync(file,'utf8');
 assert.ok(html.includes('quick_slip.js'),file+' must load the shared slip UI');
 assert.ok(html.includes('CookItUpQuickSlip.button'),file+' must add recommendations to the slip');
}
console.log('Shared NFL/NBA Quick Slip persistence, deduplication, and manual-side checks passed');
