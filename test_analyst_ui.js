/** Regression checks for the standalone NFL analyst page. node test_analyst_ui.js */
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const html=fs.readFileSync('analyst.html','utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script,'Analyst inline script should exist');
const elements=new Map();
const document={getElementById(id){if(!elements.has(id))elements.set(id,{textContent:'',innerHTML:'',value:'',disabled:false,onclick:null});return elements.get(id)}};
const context=vm.createContext({document,console,setTimeout,fetch:async url=>({
    ok:true,
    json:async()=>url.includes('matchups.json')?[]:{
        generated_at:new Date().toISOString(),
        availability_diagnostics:{injuries:{rows_for_week:16,matched_ids:0}}
    }
})});
vm.runInContext(script,context,{filename:'analyst.html'});
assert.equal(vm.runInContext('n(null)',context),null,'Null data is not a numeric zero');
assert.equal(vm.runInContext('n(undefined)',context),null,'Missing data is not zero');
assert.equal(vm.runInContext("n('10.5')",context),10.5);
const games=Array.from({length:5},(_,i)=>({recYards:i<2?100:0,receptions:i<2?5:0,week:i+1}));
const p={player:'Player One',player_id:'GSIS01',team:'GB',last5GameStats:games,
         playerRecYards:40,recent3RecYards:40,playerReceptions:2,recent3Receptions:2,
         defenseOpponentRatio:{REC:1,CATCH:1}};
const defs=vm.runInContext('defs',context);
const yard=defs.find(x=>x.key==='recYards'),catchDef=defs.find(x=>x.key==='receptions');
context.testLegs=[{p,d:yard,line:20},{p,d:catchDef,line:2}];
const outcome=vm.runInContext('runMonteCarlo(testLegs,20000)',context);
assert.equal(outcome.sample[0].hits,outcome.sample[1].hits,'Linked player outcomes must use same sampled game');
assert.equal(outcome.joint,outcome.sample[0].hits/20000,'Joint hit rate must not assume same-player markets are independent');
assert.ok(script.includes('mountMonteCarlo([]);return;'),'NO BET must still mount the simulation button');
setImmediate(()=>{
    assert.match(elements.get('feedHealth').textContent,/No current-week/,'Missing injury designations must be visible');
    console.log('NFL analyst regression checks passed');
});
