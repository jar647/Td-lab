// Contract smoke tests for the deployed NBA research page.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('nba.html','utf8');
const match=html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(match,'NBA app script must exist');
new vm.Script(match[1],{filename:'nba.html'});
for(const id of ['games','show','status','output','injurycheck','bookline','buildsgp','sgp','audit','projections']){
 assert.ok(html.includes('id="'+id+'"'),'Missing control '+id);
}
assert.ok(match[1].includes("fetch('./data/nba_injuries.json'"),'Injury data must be fetched');
assert.ok(match[1].includes("fetch('./data/nba_games.json'"),'Game data must be fetched');
assert.ok(match[1].includes("new Date(g.date).getTime()<=Date.now()"),'Do not build post-tipoff tickets');
assert.ok(match[1].includes("bookMap.size!==book.length"),'Duplicate line guard missing');
assert.ok(match[1].includes("p.opportunityFactor"),'Injury opportunity adjustment missing');
console.log('NBA UI JavaScript parse and critical wiring: PASS');
