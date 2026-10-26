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
// Execute the script in a minimal DOM sandbox and verify safe early exits.
const elements=new Map();
function element(id){if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',onclick:null});return elements.get(id)}
const sandbox={
 document:{getElementById:element},
 fetch:async()=>({ok:false}),
 console,Date,Math,Number,String,Object,Array,Set,Map,JSON,Promise
};
vm.createContext(sandbox);
vm.runInContext(match[1],sandbox,{timeout:2000});
assert.equal(typeof element('buildsgp').onclick,'function','Build SGP must be wired');
assert.equal(typeof element('show').onclick,'function','Analyze must be wired');
element('buildsgp').onclick();
assert.equal(element('sgp').textContent,'Select a game first.','Missing game must fail safely');
console.log('NBA UI syntax, DOM handlers and empty-game safety: PASS');
