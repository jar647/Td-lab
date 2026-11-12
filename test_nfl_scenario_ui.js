/* Run: node test_nfl_scenario_ui.js. Missing simulations must never become 0%. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const code=html.slice(html.indexOf('function updateNFLScenarioSelection(details)'),html.indexOf(' const propLineUI='));
assert(code.startsWith('function updateNFLScenarioSelection'));
async function load(result){
 const select={disabled:true,value:'',innerHTML:''},output={textContent:''};
 const details={open:true,dataset:{game:'NYG|WAS',playerId:'mccarthy',scenarioMarket:'passYards',postedLine:'175',projection:'220'},
  querySelector:selector=>selector==='select'?select:selector==='.pv-scenario-result'?output:selector==='.pv-scenario-body'?{insertAdjacentHTML(){}}:null};
 const requests=[],context={runNFLPlayerScenario:async(...args)=>{requests.push(args);return result},nflScenarioInputs:()=>'',console};
 vm.createContext(context);vm.runInContext(code,context);
 context.loadNFLPlayerScenarios(details);
 await new Promise(resolve=>setImmediate(resolve));
 return {details,select,output,context,requests};
}
(async()=>{
 const unsupported=await load({markets:[],unavailableMarkets:[{id:'mccarthy',market:'passYards',reason:'J.J. McCarthy is not the modeled quarterback for NYG.'}]});
 assert.match(unsupported.output.textContent,/Simulation unavailable: J.J. McCarthy is not the modeled quarterback/);
 assert.match(unsupported.output.textContent,/No percentage is shown/);
 assert.doesNotMatch(unsupported.output.textContent,/0\.0%|0\/10,000/);
 assert.equal(unsupported.select.disabled,true);
 assert.match(unsupported.select.innerHTML,/Simulation unavailable/);
 assert.equal(unsupported.details._scenarioRows.length,0);
 assert.deepEqual(unsupported.requests,[['NYG|WAS','mccarthy']],'request the displayed player, not only the game');
 const missing=await load({markets:[]});
 assert.match(missing.output.textContent,/Insufficient verified player history/);
 assert.equal(missing.select.disabled,true);
 // A valid modeled player can legitimately record no hits at a high threshold.
 // Preserve that numerical result instead of treating every zero as missing.
 const modeled=await load({markets:[{id:'mccarthy',market:'passYards',line:175,hits:0,scenarioRate:0,modeledMean:10}]});
 assert.equal(modeled.select.disabled,false);
 assert.match(modeled.select.innerHTML,/175\+ · 0\.0% simulated/);
 assert.match(modeled.output.textContent,/0\.0% simulated hit frequency \(0\/10,000 runs\)/);
 assert.equal(modeled.details._scenarioRows.length,1);
 // Different quarterback scenarios for one game must not share a cached run.
 const workerRequests=[];
 class Worker{
  postMessage(request){workerRequests.push(request);setImmediate(()=>this.onmessage({data:{result:{options:request.options}}}))}
  terminate(){}
 }
 const players=[{player_id:'mccarthy',team:'NYG',pos:'QB',market:'ATD'},
  {player_id:'winston',team:'NYG',pos:'QB',market:'ATD'},
  {player_id:'receiver',team:'WAS',pos:'WR',market:'ATD'}];
 const cacheContext={autoRecords:players,gameKey:()=>'NYG|WAS',Worker};
 vm.createContext(cacheContext);
 vm.runInContext(html.slice(html.indexOf(' const nflScenarioCache='),html.indexOf(' function nflScenarioInputs(')),cacheContext);
 const [jj,winston]=await Promise.all([cacheContext.runNFLPlayerScenario('NYG|WAS','mccarthy'),cacheContext.runNFLPlayerScenario('NYG|WAS','winston')]);
 assert.equal(jj.options.quarterbacks.NYG,'mccarthy');
 assert.equal(winston.options.quarterbacks.NYG,'winston');
 assert.equal(workerRequests.length,2);
 assert.strictEqual(await cacheContext.runNFLPlayerScenario('NYG|WAS','mccarthy'),jj);
 assert.equal(workerRequests.length,2,'repeat request reuses only the same quarterback scenario');
 assert(!players.some(p=>p.qbRole),'scenario choice must not rewrite sourced starter status');
 console.log('NFL unsupported player simulations show unavailable while legitimate zero-hit results remain visible');
})().catch(error=>{console.error(error);process.exitCode=1});
