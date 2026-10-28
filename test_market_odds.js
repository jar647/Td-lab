'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const math=require('./market_odds.js');
assert.equal(math.american('-110'),-110);
assert.equal(math.american('+125'),125);
for(const invalid of ['', '0','-99','99','-110.5','EVEN','+Infinity','NaN','--110',1000000])
 assert.equal(math.american(invalid),null,'invalid odds '+invalid);
assert.ok(Math.abs(math.quote('-110').implied-110/210)<1e-10);
assert.ok(Math.abs(math.quote('+110').implied-100/210)<1e-10);
const both=math.compare({line:69.5,projection:84.5,overOdds:'-110',underOdds:'-110',side:'OVER'});
assert.ok(Math.abs(both.noVigOver-.5)<1e-10);
assert.equal(both.status,'RESEARCH OVER LEAN · PRICE REVIEWED');
assert.equal(both.play,false);
assert.equal(both.verifiedValue,false);
assert.equal(math.compare({line:69.5,projection:84.5,overOdds:'-250',underOdds:'+190',side:'OVER'}).status,'PASS · PRICE WORSE THAN -200');
assert.equal(math.compare({line:69.5,projection:84.5,overOdds:'-200',side:'OVER'}).status,'RESEARCH OVER LEAN · PRICE REVIEWED');
assert.equal(math.compare({line:69.5,projection:84.5,underOdds:'+120',side:'OVER'}).status,'RESEARCH LEAN · PRICE MISSING');
assert.equal(math.compare({line:69.5,projection:50,underOdds:'-110',side:'UNDER'}).status,'RESEARCH UNDER LEAN · PRICE REVIEWED');
assert.equal(math.compare({line:69.5,projection:50,overOdds:'-90',side:'UNDER'}).status,'CHECK VEGAS ODDS');
assert.equal(math.compare({line:'',projection:50,overOdds:'-110',side:'OVER'}).status,'ENTER VEGAS LINE');
assert.equal(math.compare({line:69.5,projection:null,overOdds:'-110',side:'OVER'}).status,'PASS · PROJECTION UNAVAILABLE');
assert.equal(math.compare({line:69.5,projection:70,overOdds:'-110',side:null}).status,'PASS · NO SUPPORTED SIDE');
const nfl=fs.readFileSync('index.html','utf8'),nba=fs.readFileSync('nba.html','utf8');
for(const [name,html] of [['NFL',nfl],['NBA',nba]]){
 assert.ok(html.includes('src="./market_odds.js"'),name+' must load the shared pricing math');
 assert.ok(html.includes('Vegas line')||html.includes('Vegas Line'),name+' must have a player market line');
 assert.ok(html.includes('Over odds')&&html.includes('Under odds'),name+' must offer both sides');
 const inline=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).filter(Boolean);
 assert.equal(inline.length,1,name+' should retain one inline controller');
 new vm.Script(inline[0],{filename:name+'.html'});
}
assert.ok(nfl.includes('setPropOdds('),'NFL prices must be saved');
assert.ok(nba.includes('setNBAQuote('),'NBA prices must be saved');
console.log('CoOk It Up two-sided player-prop pricing checks passed');
