'use strict';
const assert=require('node:assert/strict');
const ui=require('./nfl_top_plays_ui.js'),top=require('./nfl_top_plays.js');
const now=Date.parse('2026-11-15T12:00:00Z'),stamp=new Date(now).toISOString();
const pairs=['AB','CD','EF','GH','IJ','KL'];
const fixtures=pairs.map((pair,index)=>({game_id:pair,home:pair[0],away:pair[1],kickoff_at:new Date(now+(index+1)*3600000).toISOString()}));
function player(id,game,pos='WR',scale=1,extra={}){
 const history=Array.from({length:5},()=>({passYards:Math.round(300*scale),rushYards:Math.round(100*scale),recYards:Math.round(100*scale),receptions:Math.round(8*scale),rushTDs:0,recTDs:0}));
 return {player_id:id,player:'Player '+id,team:game[0],opp:game[1],pos,market:'ATD',games:5,seasonGamesPlayed:5,last5GamesPlayed:5,
  availability:'ROSTER_ACTIVE',injuryReportStatus:'ACTIVE',playerAppearancesVerified:true,last5GameStats:history,seasonGameStats:history,
  playerPassYards:300*scale,playerPassAttempts:40*scale,recent3PassYards:300*scale,recent3PassAttempts:40*scale,defPassYardsAllowed:300*scale,defPassAttemptsAllowed:40*scale,
  playerRushYards:100*scale,playerCarries:20*scale,recent3RushYards:100*scale,recent3Carries:20*scale,defRushYardsAllowed:100*scale,defRushAttemptsAllowed:20*scale,
  playerRecYards:100*scale,playerTargets:10*scale,playerReceptions:8*scale,recent3RecYards:100*scale,recent3Receptions:8*scale,recent3Targets:10*scale,defRecYardsAllowed:130*scale,defTargetsAllowed:13*scale,defReceptionsAllowed:9*scale,
  tdallowed:0,rzallowed:0,playerRz:0,rzshare:0,playerAnytimeTDs:0,recent3AnytimeTDs:0,...extra};
}
function records(){return pairs.flatMap((game,index)=>['WR','RB','QB'].map((pos,i)=>player(game+'-'+i,game,pos,[1,.92,.85,.78,.7,1][index],index===5?{availability:'OUT'}:{})))}
function simulation(players){
 const rows=players.flatMap(p=>top.defs.filter(d=>d.positions.includes(p.pos)).map(d=>({p,d})));
 const rate=(market,line)=>market==='receptions'?.97-line*.05:market==='passYards'?.97-line*.0007:.97-line*.003;
 return {count:10000,markets:rows.flatMap(({p,d})=>d.steps.map(line=>({id:p.player_id,market:d.key,line,scenarioRate:rate(d.key,line),hits:Math.round(rate(d.key,line)*10000),modeledMean:p[d.season]}))),
  settlements:rows.map(({p,d})=>({id:p.player_id,market:d.key,count:10000,bins:d.key==='receptions'?[[0,1000],[3,2000],[5,3000],[8,4000]]:[[0,1000],[100,1000],[200,2000],[225,2000],[250,2000],[350,2000]]}))};
}
function node(){return {innerHTML:'',textContent:'',listeners:{},addEventListener(name,fn){this.listeners[name]=fn},removeEventListener(name){delete this.listeners[name]}}}
function mount(){
 let clock=now,selected='ALL',scheduled,maxActive=0;const host=node(),heading=node(),description=node(),status=node(),jobs=[],picks=[];
 const state={records:records(),fixtures:fixtures.map(g=>({...g})),feedGeneratedAt:stamp,fixturesGeneratedAt:stamp};
 const controller=ui.create({root:host,heading,description,status,getState:()=>state,getGame:()=>selected,now:()=>clock,
  quickSlip:{add(pick){picks.push(pick)}},setTimeout:fn=>{scheduled=fn;return 1},clearTimeout(){},workerFactory(){
   const worker={terminate(){this.terminated=true},postMessage(message){this.message=message;maxActive=Math.max(maxActive,jobs.filter(j=>!j.terminated).length)}};jobs.push(worker);return worker;
  }});
 const finish=(job,fail=false)=>{job.finished=true;if(fail)job.onerror();else job.onmessage({data:{result:simulation(job.message.players)}})};
 const finishAll=(failGames=[])=>{for(const job of jobs){if(job.finished||job.terminated)continue;const fixture=state.fixtures.find(g=>job.message.players.some(p=>p.team===g.home&&p.opp===g.away));finish(job,failGames.includes(fixture?.game_id))}};
 return {host,heading,description,status,state,jobs,picks,controller,finish,finishAll,maxActive:()=>maxActive,setTime(value){clock=value},tick:()=>scheduled?.(),select(value){selected=value;return controller.refresh()}};
}
const cardCount=view=>(view.host.innerHTML.match(/class="matchrow nfl-top-play"/g)||[]).length;
const passCount=view=>(view.host.innerHTML.match(/class="matchrow nfl-top-pass"/g)||[]).length;
function passHTML(view,id){const start=view.host.innerHTML.indexOf('class="matchrow nfl-top-pass" data-game-id="'+id+'"');assert(start>=0,'game has a visible PASS row');return view.host.innerHTML.slice(start,view.host.innerHTML.indexOf('</section>',start))}
async function ready(view,failGames=[]){const pending=view.controller.refresh();view.finishAll(failGames);await pending;return view.controller.getResult()}
(async()=>{
 assert.deepEqual(ui.bestSingles(null),[]);assert.deepEqual(ui.bestSingles({ready:false,perGame:[{ready:true,fixture:fixtures[0],candidates:[]}]}),[]);
 const view=mount(),pending=view.controller.refresh();assert.equal(view.jobs.length,2);assert.equal(cardCount(view),0);assert.equal(passCount(view),0,'pending game analysis does not display final PASS decisions');
 view.finish(view.jobs[0]);assert.equal(cardCount(view),0,'partial slate leaders remain withheld until all games finish');view.finishAll();await pending;
 const model=view.controller.getResult(),globalKeys=top.select(model).map(c=>c.key),singles=ui.bestSingles(model),singleKeys=new Set(singles.map(c=>c.key));
 assert.equal(model.games.length,6);assert.equal(model.topThree.length,3);assert.equal(top.select(model).length,3,'shared global ranking contract remains unchanged');assert(model.topThree.every(c=>c.fixture.game_id==='AB'),'all original global top three can belong to the strongest game');
 assert.equal(singles.length,5);assert.equal(cardCount(view),5);assert.equal(passCount(view),1);assert.equal(new Set(singles.map(c=>c.fixture.game_id)).size,5);assert(singles.some(c=>c.fixture.game_id==='IJ'),'the fifth weaker matchup remains represented');
 assert.equal((view.host.innerHTML.match(/>BEST SINGLE<\/span>/g)||[]).length,5,'every per-game card has its own Best Single label');assert.doesNotMatch(view.host.innerHTML,/>#\d+<\/span>/);assert.match(view.heading.textContent,/Best single from each game · All games/);assert.match(view.description.textContent,/One Best Single per game/);assert.match(view.status.textContent,/5 best singles · 6 games · 1 PASS/);assert.equal(view.maxActive(),2);
 const pass=passHTML(view,'KL');assert.match(pass,/L @ K/);assert.match(pass,/PASS/);assert.doesNotMatch(pass,/data-top-add|data-top-line|data-book-line|data-book-odds/,'PASS rows cannot save, change a line or enter a price');
 const captured=new Set(model.perGame.flatMap(game=>game.visible.map(c=>c.key)));
 for(const single of singles){const game=model.perGame.find(g=>g.fixture.game_id===single.fixture.game_id),original=top.select(game,'ALL',1)[0];assert.equal(single.key,original.key);assert.equal(single.researchScore,original.researchScore);assert.equal(single.line,original.line);assert.equal(single.scenarioRate,original.scenarioRate);assert.notEqual(single,original);assert.equal(single.fixture,game.fixture);assert.equal(original.fixture,undefined,'adding display context does not mutate the shared per-game candidate');assert(captured.has(single.key),'existing per-game capture union already freezes every displayed Best Single')}
 assert.deepEqual(top.select(model).map(c=>c.key),globalKeys,'display selection does not change the helper’s global top three');
 const last=singles.at(-1);assert.equal(last.fixture.game_id,'IJ');assert(!globalKeys.includes(last.key));const alternate=last.alternatives.find(a=>a.line!==last.line);assert(alternate);
 assert(view.controller.setBookQuote(last.key,{line:'224.5',odds:'-110'}),'book inputs work for games beyond the old global top three');assert.match(view.host.innerHTML,/OVER 224\.5/);assert(view.controller.setLine(last.key,alternate.line));assert(view.controller.add(last.key));const saved=view.picks.at(-1);assert.equal(saved.gameId,'IJ');assert.equal(saved.game,'J @ I');assert.equal(saved.player,last.p.player);assert.equal(saved.line,alternate.line);assert.equal(saved.researchScore,last.researchScore);assert.equal(saved.scenarioRate,alternate.scenarioRate);assert.equal(saved.side,'at_least');assert.equal(cardCount(view),5);assert.deepEqual(ui.bestSingles(view.controller.getResult()).map(c=>c.key),singles.map(c=>c.key),'alternate thresholds do not rerank game winners');
 const hidden=model.candidates.find(c=>c.fixture.game_id==='AB'&&!singleKeys.has(c.key));assert(hidden);assert.equal(view.controller.add(hidden.key),false);assert.equal(view.controller.setBookQuote(hidden.key,{line:'53.5',odds:'-110'}),false);assert.equal(view.controller.setLine(hidden.key,hidden.alternatives[0].line),false,'hidden nonwinners cannot be targeted through the old global selection');
 for(const category of ['PASS','RUSH','REC','CATCH']){await view.controller.setCategory(category);assert.equal(cardCount(view),3);assert.equal(passCount(view),0,'category tabs retain their original top-three behavior');assert.equal((view.host.innerHTML.match(/>BEST SINGLE<\/span>/g)||[]).length,1)}
 await view.controller.setCategory('ALL');assert.equal(cardCount(view),5);assert.equal(view.jobs.length,6,'category navigation reuses cached simulations');
 await view.select('I|J');assert.equal(cardCount(view),1);assert.equal(passCount(view),0);const filtered=ui.bestSingles(view.controller.getResult());assert.equal(filtered.length,1);assert.equal(filtered[0].fixture.game_id,'IJ');assert(view.controller.setBookQuote(filtered[0].key,{line:'224.5',odds:'+120'}));assert(view.controller.add(filtered[0].key));assert.equal(view.picks.at(-1).gameId,'IJ');
 await view.select('K|L');assert.equal(cardCount(view),0);assert.equal(passCount(view),1);assert.match(passHTML(view,'KL'),/PASS/);await view.select('ALL');
 // Source changes remove an entire now-OUT game's play without changing the
 // recommendation policy or accepting an action against its old winner.
 view.state.records=view.state.records.map(p=>p.team==='I'?{...p,availability:'OUT',injuryReportStatus:'OUT'}:p);assert.equal(view.controller.setLine(last.key,alternate.line),false);const injuryReload=view.controller.refresh();view.finishAll();await injuryReload;assert.equal(cardCount(view),4);assert.equal(passCount(view),2);assert.match(passHTML(view,'IJ'),/PASS/);assert.equal(view.controller.add(last.key),false);assert.equal(view.controller.setBookQuote(last.key,{line:'224.5',odds:'-110'}),false);assert(ui.bestSingles(view.controller.getResult()).every(c=>c.p.availability!=='OUT'));view.controller.destroy();
 const noPicks=mount();noPicks.state.records=noPicks.state.records.map(p=>({...p,availability:'OUT'}));await ready(noPicks);assert.equal(cardCount(noPicks),0);assert.equal(passCount(noPicks),6);assert.equal((noPicks.host.innerHTML.match(/data-top-add=/g)||[]).length,0);assert.match(noPicks.status.textContent,/0 best singles · 6 games · 6 PASS/);noPicks.controller.destroy();
 const failed=mount();await ready(failed,pairs);assert.equal(cardCount(failed),0);assert.equal(passCount(failed),6);assert.match(failed.status.textContent,/6 game simulations unavailable/);assert(ui.bestSingles(failed.controller.getResult()).length===0);failed.controller.destroy();
 const partial=mount();await ready(partial,['EF']);assert.equal(cardCount(partial),4);assert.equal(passCount(partial),2);assert.match(passHTML(partial,'EF'),/PASS/);assert.match(partial.status.textContent,/1 game simulation unavailable/);assert(ui.bestSingles(partial.controller.getResult()).some(c=>c.fixture.game_id==='IJ'));partial.controller.destroy();
 const cutoff=mount();await ready(cutoff);const oldFirst=ui.bestSingles(cutoff.controller.getResult()).find(c=>c.fixture.game_id==='AB');cutoff.setTime(now+3600000);assert.equal(cutoff.controller.add(oldFirst.key),false,'kickoff is checked at action time');await cutoff.controller.refresh();assert.equal(cardCount(cutoff),4);assert.equal(passCount(cutoff),1);assert(!cutoff.host.innerHTML.includes('data-game-id="AB"'));assert(ui.bestSingles(cutoff.controller.getResult()).every(c=>c.fixture.game_id!=='AB'));cutoff.controller.destroy();
 const stale=mount();await ready(stale);const old=ui.bestSingles(stale.controller.getResult())[0];stale.state.feedGeneratedAt='2020-01-01T00:00:00Z';assert.equal(stale.controller.setBookQuote(old.key,{line:'224.5',odds:'-110'}),false);await stale.controller.refresh();assert.equal(cardCount(stale),0);assert.equal(passCount(stale),0,'stale models do not masquerade as verified game-specific PASS evaluations');assert.match(stale.host.innerHTML,/PASS/);stale.controller.destroy();
 const invalid=mount();invalid.state.fixtures=[...invalid.state.fixtures,{game_id:'PAST',home:'M',away:'N',kickoff_at:new Date(now-1).toISOString()},{game_id:'FAR',home:'O',away:'P',kickoff_at:new Date(now+7*86400000+1).toISOString()}];invalid.state.records=[...invalid.state.records,player('past','MN'),player('far','OP')];await ready(invalid);assert.equal(cardCount(invalid),5);assert.equal(passCount(invalid),1);assert.equal(invalid.jobs.length,6);assert(!ui.bestSingles(invalid.controller.getResult()).some(c=>['PAST','FAR'].includes(c.fixture.game_id)));invalid.controller.destroy();
 console.log('NFL per-game Best Singles: uncapped game coverage, unchanged category/global ranking, capture coverage, exact card actions and PASS/injury/freshness safeguards PASS');
})().catch(error=>{console.error(error);process.exitCode=1});
