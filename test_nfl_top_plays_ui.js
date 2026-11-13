'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const ui=require('./nfl_top_plays_ui.js'),top=require('./nfl_top_plays.js');
const html=fs.readFileSync('index.html','utf8');
assert(html.includes('src="./nfl_top_plays_ui.js?v=nfl-top-plays-v1"'));
assert.match(html,/<button class="chip active" onclick="setMainCategory\('ALL',this\)">TOP PLAYS/);
assert.doesNotMatch(html,/<(?:div|section)[^>]*id="(?:propRankings|simpleRankings|yardageSection|tdSection)"/,'full roster boards are removed from the main NFL view');
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
 player('out','A','WR',{availability:'OUT'}),player('other','C')];
function simulation(players){return {markets:players.flatMap(p=>top.defs.filter(d=>d.positions.includes(p.pos)).flatMap(d=>d.steps.map(line=>({id:p.player_id,market:d.key,line,modeledMean:d.key==='receptions'?8:110,scenarioRate:.8,hits:8000}))))}}
function node(){return {innerHTML:'',textContent:'',listeners:{},addEventListener(e,f){this.listeners[e]=f},removeEventListener(e){delete this.listeners[e]}}}
function mount(){
 let selected='',time=now;const host=node(),heading=node(),status=node(),jobs=[],picks=[];
 const state={records,fixtures,feedGeneratedAt:stamp,fixturesGeneratedAt:stamp};
 const controller=ui.create({root:host,heading,status,getState:()=>state,getGame:()=>selected,now:()=>time,
  quickSlip:{add(p){picks.push(p)}},setTimeout:()=>1,clearTimeout:()=>{},workerFactory:()=>{
   const worker={terminate(){this.terminated=true},postMessage(message){this.message=message}};jobs.push(worker);return worker;
  }});
 return {controller,host,heading,status,state,jobs,picks,select(value){selected=value;return controller.refresh()},setTime(value){time=value},finish(job){job.onmessage({data:{result:simulation(job.message.players)}})}};
}
(async()=>{
 const view=mount();await view.controller.refresh();assert.match(view.host.innerHTML,/Choose a game/);assert.equal(view.jobs.length,0);
 const pending=view.select('A|B');assert.equal(view.jobs.length,1);assert.match(view.host.innerHTML,/Finding the top plays/);
 assert.equal(view.jobs[0].message.count,10000);assert.equal(view.jobs[0].message.seed,982451653);assert(view.jobs[0].message.players.every(p=>['A','B'].includes(p.team)));
 view.finish(view.jobs[0]);await pending;
 assert.match(view.heading.textContent,/B @ A/);assert.equal((view.host.innerHTML.match(/class="matchrow nfl-top-play"/g)||[]).length,3);
 assert.match(view.host.innerHTML,/BEST SINGLE/);assert.match(view.host.innerHTML,/100<small>\/100/);assert.match(view.host.innerHTML,/Why this play/);assert.match(view.host.innerHTML,/Add to Quick Slip/);
 assert.doesNotMatch(view.host.innerHTML,/Player (?:low|out|other)/);
 const row=view.controller.getResult().topThree[0],alternate=row.alternatives.find(a=>a.line!==row.line);assert(alternate);
 assert(view.controller.setLine(row.key,alternate.line));assert(view.controller.add(row.key));assert.equal(view.picks[0].line,alternate.line);assert.equal(view.picks[0].researchScore,row.researchScore);assert.equal(view.picks[0].side,'at_least');
 assert(view.picks[0].notes.includes('Cleared '+alternate.line+'+'));assert(view.picks[0].notes.includes((alternate.scenarioRate*100).toFixed(1)+'% at '+alternate.line+'+'),'saved evidence matches the chosen alternate');
 assert.equal(view.controller.setLine(row.key,9999),false);assert.equal(view.controller.add('unknown'),false);
 await view.controller.setCategory('REC');assert.equal(view.jobs.length,1,'filtering reuses the same game simulations');assert(view.controller.getResult().candidates.length>3);
 assert.doesNotMatch(view.host.innerHTML,/100\+ rushing yards/);
 await view.controller.setCategory('TD');assert.match(view.host.innerHTML,/PASS/);assert.equal((view.host.innerHTML.match(/data-top-add=/g)||[]).length,0);
 await view.controller.setCategory('ALL');view.setTime(now+3600001);await view.controller.refresh();assert.match(view.host.innerHTML,/PASS/);assert.equal(view.controller.add(row.key),false,'a formerly visible pick closes at kickoff');view.controller.destroy();
 // A previous game's completed worker must never populate the newly selected game.
 const race=mount(),first=race.select('A|B'),second=race.select('C|D');assert(race.jobs[0].terminated);race.finish(race.jobs[0]);await first;assert.doesNotMatch(race.host.innerHTML,/Player rb/);race.finish(race.jobs[1]);await second;assert.match(race.heading.textContent,/D @ C/);assert.match(race.host.innerHTML,/Player other/);assert.doesNotMatch(race.host.innerHTML,/Player wr/);
 // New missing/stale source data removes previous actionable cards immediately.
 race.state.feedGeneratedAt='2020-01-01T00:00:00Z';await race.controller.refresh();assert.match(race.host.innerHTML,/PASS/);assert.equal((race.host.innerHTML.match(/data-top-add=/g)||[]).length,0);race.controller.destroy();
 // A data reload may preserve its timestamp; an old pending simulation still
 // must not be paired with the replacement player inputs.
 const reload=mount(),original=reload.select('A|B');reload.state.records=records.map(p=>({...p,availability:p.player_id==='rb'?'OUT':p.availability}));
 const replacement=reload.controller.refresh();assert.equal(reload.jobs.length,2);assert(reload.jobs[0].terminated);reload.finish(reload.jobs[0]);await original;
 assert.doesNotMatch(reload.host.innerHTML,/Player rb/);reload.finish(reload.jobs[1]);await replacement;assert.doesNotMatch(reload.host.innerHTML,/Player rb/);reload.controller.destroy();
 const failed=mount(),work=failed.select('A|B');failed.jobs[0].onerror();await work;assert.match(failed.status.textContent,/simulation unavailable/);assert.equal((failed.host.innerHTML.match(/data-top-add=/g)||[]).length,0);failed.controller.destroy();
 console.log('NFL compact top-play UI: exact lines/scores, filters, Quick Slip, kickoff/stale gates and switched-game worker isolation PASS');
})().catch(error=>{console.error(error);process.exitCode=1});
