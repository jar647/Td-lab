'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ui=require('./nfl_top_plays_ui.js'),top=require('./nfl_top_plays.js');
const html=fs.readFileSync('index.html','utf8');
assert(html.includes('src="./nfl_top_plays_ui.js?v=nfl-board-v2"'));
assert.match(html,/<button class="chip active" onclick="setMainCategory\('ALL',this\)">TOP PLAYS/);
assert.doesNotMatch(html,/<(?:div|section)[^>]*id="(?:propRankings|simpleRankings|yardageSection|tdSection)"/,'full roster boards are removed from the main NFL view');
// Each tab is a full-board entry point, even after an optional game filter.
const navNodes=new Map(),navElement=id=>{if(!navNodes.has(id))navNodes.set(id,{value:'CAR|NO',hidden:false,scrollIntoView(){}});return navNodes.get(id)};
const navState={document:{getElementById:navElement,querySelectorAll:()=>[]},nflTopPlaysCategory:'ALL',propCategory:'PASS',renderNFLTopPlays(){assert.equal(navElement('gameFilter').value,'ALL')},renderSelectedGamePick(){},loadBacktestLab(){}};
vm.createContext(navState);const navStart=html.indexOf('function setMainCategory('),navEnd=html.indexOf('\nfunction setPropCategory(',navStart);vm.runInContext(html.slice(navStart,navEnd),navState);
for(const category of ['ALL','PASS','RUSH','REC','CATCH','TD']){navElement('gameFilter').value='CAR|NO';navState.setMainCategory(category,null);assert.equal(navElement('gameFilter').value,'ALL',category+' opens the complete board');assert.equal(navState.nflTopPlaysCategory,category)}
for(const category of ['GAME','BACKTEST']){navElement('gameFilter').value='CAR|NO';navState.setMainCategory(category,null);assert.equal(navElement('gameFilter').value,'CAR|NO','other navigation behavior is preserved')}
const now=Date.parse('2026-11-13T14:00:00Z'),stamp=new Date(now).toISOString();
const fixtures=[{game_id:'AB',home:'A',away:'B',kickoff_at:new Date(now+3600000).toISOString()},
 {game_id:'CD',home:'C',away:'D',kickoff_at:new Date(now+7200000).toISOString()}];
function player(id,team='A',pos='RB',extra={}){
 return {player_id:id,player:'Player '+id,team,opp:{A:'B',B:'A',C:'D',D:'C'}[team],pos,market:'ATD',games:5,seasonGamesPlayed:5,last5GamesPlayed:5,
  playerAppearancesVerified:true,availability:'ROSTER_ACTIVE',injuryReportStatus:'NOT_REPORTED',
  playerRushYards:100,playerCarries:20,recent3RushYards:100,recent3Carries:20,defRushYardsAllowed:100,defRushAttemptsAllowed:20,
  playerRecYards:100,playerTargets:10,playerReceptions:8,recent3RecYards:100,recent3Receptions:8,recent3Targets:10,defRecYardsAllowed:130,defTargetsAllowed:13,defReceptionsAllowed:9,
  tdallowed:0,rzallowed:0,playerRz:0,rzshare:0,playerAnytimeTDs:0,recent3AnytimeTDs:0,
  last5GameStats:Array.from({length:5},()=>({rushYards:100,recYards:100,receptions:8,rushTDs:0,recTDs:0})),...extra};
}
const records=[player('rb'),player('wr','B','WR'),player('third','A','TE'),
 player('low','B','RB',{playerRushYards:48,playerCarries:5,defRushAttemptsAllowed:10,recent3Carries:5,
  playerTargets:0,playerRecYards:0,playerReceptions:0,defRecYardsAllowed:0,defReceptionsAllowed:0,defTargetsAllowed:0}),
 player('out','A','WR',{availability:'OUT'}),player('other','C','RB',{injuryReportStatus:'ACTIVE',playerTargets:0,playerRecYards:0,playerReceptions:0})];
function simulation(players){return {markets:players.flatMap(p=>top.defs.filter(d=>d.positions.includes(p.pos)).flatMap(d=>d.steps.map(line=>({id:p.player_id,market:d.key,line,modeledMean:d.key==='receptions'?8:110,scenarioRate:.8,hits:8000}))))}}
function node(){return {innerHTML:'',textContent:'',listeners:{},addEventListener(e,f){this.listeners[e]=f},removeEventListener(e){delete this.listeners[e]}}}
function mount(){
 let selected='ALL',time=now,scheduled;const host=node(),heading=node(),status=node(),jobs=[],picks=[];
 const state={records,fixtures,feedGeneratedAt:stamp,fixturesGeneratedAt:stamp};
 const controller=ui.create({root:host,heading,status,getState:()=>state,getGame:()=>selected,now:()=>time,
  quickSlip:{add(p){picks.push(p)}},setTimeout:fn=>{scheduled=fn;return 1},clearTimeout:()=>{},workerFactory:()=>{
   const worker={terminate(){this.terminated=true},postMessage(message){this.message=message}};jobs.push(worker);return worker;
  }});
 return {controller,host,heading,status,state,jobs,picks,select(value){selected=value;return controller.refresh()},setTime(value){time=value},tick:()=>scheduled?.(),finish(job){job.onmessage({data:{result:simulation(job.message.players)}})}};
}
(async()=>{
 const view=mount(),pending=view.controller.refresh();assert.equal(view.jobs.length,2,'all-game rankings start without choosing a matchup');
 assert.match(view.host.innerHTML,/best plays across all games/);assert.match(view.heading.textContent,/All games/);
 for(const job of view.jobs){assert.equal(job.message.count,10000);assert.equal(job.message.seed,982451653);assert.equal(new Set(job.message.players.map(p=>[p.team,p.opp].sort().join('|'))).size,1,'each simulation keeps one matchup');}
 const filtered=view.controller.setCategory('RUSH');assert.equal(view.jobs.length,2,'changing category reuses pending games');
 view.finish(view.jobs[0]);assert.equal((view.host.innerHTML.match(/data-top-add=/g)||[]).length,0,'partial rankings are not presented as final full-board leaders');
 view.finish(view.jobs[1]);await pending;await filtered;
 assert.match(view.heading.textContent,/Best rushing plays · All games/);assert.match(view.host.innerHTML,/D @ C/);assert.match(view.host.innerHTML,/B @ A/);
 assert.doesNotMatch(view.host.innerHTML,/Player (?:low|out)/);
 const rushing=top.select(view.controller.getResult(),'RUSH');assert.equal(rushing[0].p.player_id,'other','strongest supported rushing play can come from another game');
 const row=rushing[0],alternate=row.alternatives.find(a=>a.line!==row.line);assert(alternate);
 assert(view.controller.setLine(row.key,alternate.line));assert(view.controller.add(row.key));assert.equal(view.picks[0].line,alternate.line);assert.equal(view.picks[0].researchScore,row.researchScore);assert.equal(view.picks[0].side,'at_least');
 assert.equal(view.picks[0].gameId,'CD');assert.equal(view.picks[0].game,'D @ C','all-game Quick Slip uses the selected play fixture');
 assert(view.picks[0].notes.includes('Cleared '+alternate.line+'+'));assert(view.picks[0].notes.includes((alternate.scenarioRate*100).toFixed(1)+'% at '+alternate.line+'+'));
 assert.equal(view.controller.setLine(row.key,9999),false);assert.equal(view.controller.add('unknown'),false);
 await view.controller.setCategory('ALL');assert.equal((view.host.innerHTML.match(/class="matchrow nfl-top-play"/g)||[]).length,3);assert.match(view.host.innerHTML,/BEST SINGLE/);assert.match(view.host.innerHTML,/100<small>\/100/);assert.match(view.host.innerHTML,/Why this play/);
 const scores=top.select(view.controller.getResult()).map(r=>r.researchScore);assert(scores.every((v,i)=>!i||v<=scores[i-1]));
 await view.controller.setCategory('REC');assert.equal(view.jobs.length,2,'completed game simulations are reused across categories');assert.doesNotMatch(view.host.innerHTML,/100\+ rushing yards/);
 await view.controller.setCategory('TD');assert.match(view.host.innerHTML,/PASS/);assert.equal((view.host.innerHTML.match(/data-top-add=/g)||[]).length,0);
 await view.controller.setCategory('ALL');await view.select('A|B');assert.match(view.heading.textContent,/B @ A/);assert.doesNotMatch(view.host.innerHTML,/Player other/);assert.equal(view.jobs.length,2,'optional game filter uses the same cached draws');
 const oldGameRow=top.select(view.controller.getResult())[0];await view.select('ALL');assert.match(view.host.innerHTML,/Player other/);
 view.setTime(now+3600001);await view.controller.refresh();assert.doesNotMatch(view.host.innerHTML,/Player rb/);assert.equal(view.controller.add(oldGameRow.key),false,'a started game is removed from all-board actions');
 await view.select('A|B');assert.match(view.host.innerHTML,/PASS/);view.controller.destroy();
 // Old workers cannot leak into another optional game filter.
 const race=mount(),first=race.select('A|B'),second=race.select('C|D');assert(race.jobs[0].terminated);race.finish(race.jobs[0]);await first;assert.doesNotMatch(race.host.innerHTML,/Player rb/);race.finish(race.jobs[1]);await second;assert.match(race.heading.textContent,/D @ C/);assert.match(race.host.innerHTML,/Player other/);assert.doesNotMatch(race.host.innerHTML,/Player wr/);
 race.state.feedGeneratedAt='2020-01-01T00:00:00Z';await race.controller.refresh();assert.match(race.host.innerHTML,/PASS/);assert.equal((race.host.innerHTML.match(/data-top-add=/g)||[]).length,0);race.controller.destroy();
 // Replacement source rows invalidate pending draws even if feed timestamps match.
 const reload=mount(),original=reload.select('A|B');reload.state.records=records.map(p=>({...p,availability:p.player_id==='rb'?'OUT':p.availability}));
 const replacement=reload.controller.refresh();assert.equal(reload.jobs.length,2);assert(reload.jobs[0].terminated);reload.finish(reload.jobs[0]);await original;
 assert.doesNotMatch(reload.host.innerHTML,/Player rb/);reload.finish(reload.jobs[1]);await replacement;assert.doesNotMatch(reload.host.innerHTML,/Player rb/);reload.controller.destroy();
 // Complete a longer slate with at most two active workers.
 const queue=mount();queue.state.fixtures=[...fixtures,{game_id:'EF',home:'E',away:'F',kickoff_at:new Date(now+10800000).toISOString()}];queue.state.records=[...records,player('third-game','E','RB',{opp:'F'})];
 const batch=queue.controller.refresh();assert.equal(queue.jobs.length,2);queue.finish(queue.jobs[0]);assert.equal(queue.jobs.length,3);assert(queue.jobs[0].terminated);queue.finish(queue.jobs[1]);queue.finish(queue.jobs[2]);await batch;assert.equal(queue.controller.getResult().games.length,3);queue.controller.destroy();
 const failed=mount(),work=failed.controller.refresh();failed.jobs[0].onerror();failed.jobs[1].onerror();await work;assert.match(failed.status.textContent,/simulations unavailable/);assert.equal((failed.host.innerHTML.match(/data-top-add=/g)||[]).length,0);
 await failed.controller.setCategory('RUSH');assert.equal(failed.jobs.length,2,'category changes do not hammer failed workers');
 const recovery=failed.tick();assert.equal(failed.jobs.length,4,'the timed refresh retries transient failures');failed.finish(failed.jobs[2]);failed.finish(failed.jobs[3]);await recovery;assert.match(failed.host.innerHTML,/Player other/);failed.controller.destroy();
 const duplicate=mount();duplicate.state.fixtures=[fixtures[0],{...fixtures[1],game_id:fixtures[0].game_id}];await duplicate.select('A|B');assert.equal(duplicate.jobs.length,0);assert.match(duplicate.host.innerHTML,/PASS/);duplicate.controller.destroy();
 console.log('NFL all-game category UI: global best plays, optional game filter, bounded cached simulations, fixture-specific Quick Slip and freshness/race safeguards PASS');
})().catch(error=>{console.error(error);process.exitCode=1});
