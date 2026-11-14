'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const ui=require('./nfl_top_plays_ui.js'),top=require('./nfl_top_plays.js');
const now=Date.parse('2026-11-14T12:00:00Z'),stamp=new Date(now).toISOString();
const fixtures=[{game_id:'AB',home:'A',away:'B',kickoff_at:new Date(now+3600000).toISOString()},
 {game_id:'CD',home:'C',away:'D',kickoff_at:new Date(now+7200000).toISOString()}];
function player(id,team='A',pos='WR'){
 return {player_id:id,player:'Player '+id,team,opp:{A:'B',B:'A',C:'D',D:'C'}[team],pos,market:'ATD',games:5,seasonGamesPlayed:5,last5GamesPlayed:5,
  playerAppearancesVerified:true,availability:'ROSTER_ACTIVE',injuryReportStatus:'ACTIVE',
  playerRushYards:100,playerCarries:20,recent3RushYards:100,recent3Carries:20,defRushYardsAllowed:100,defRushAttemptsAllowed:20,
  playerRecYards:100,playerTargets:10,playerReceptions:8,recent3RecYards:100,recent3Receptions:8,recent3Targets:10,defRecYardsAllowed:130,defTargetsAllowed:13,defReceptionsAllowed:9,
  tdallowed:1.2,rzallowed:3.5,playerRz:2.5,rzshare:35,goalLine5:.8,snapShare:.85,playerAnytimeTDs:1,recent3AnytimeTDs:1,
  last5GameStats:Array.from({length:5},()=>({rushYards:100,recYards:100,receptions:8,rushTDs:1,recTDs:0}))};
}
const records=[player('a-wr'),player('a-rb','A','RB'),player('b-te','B','TE'),player('c-wr','C'),player('d-rb','D','RB')];
function simulation(players,withSettlements=true){
 const supported=players.flatMap(p=>top.defs.filter(d=>d.positions.includes(p.pos)).map(d=>({p,d})));
 const markets=supported.flatMap(({p,d})=>d.steps.map(line=>({id:p.player_id,market:d.key,line,scenarioRate:.9-line*.0005,modeledMean:d.key==='receptions'?8:110})));
 const settlements=withSettlements?supported.map(({p,d})=>({id:p.player_id,market:d.key,count:10000,
  bins:d.key==='receptions'?[[0,1000],[3,1000],[4,2000],[5,3000],[8,3000]]:[[0,1000],[40,1000],[50,2000],[54,1000],[55,1000],[60,2000],[100,2000]]})):[];
 return {count:10000,markets,settlements};
}
function node(){return {innerHTML:'',textContent:'',listeners:{},addEventListener(name,fn){this.listeners[name]=fn},removeEventListener(name){delete this.listeners[name]}}}
function mount(withSettlements=true){
 let selected='ALL',time=now,scheduled;const host=node(),status=node(),jobs=[],picks=[];
 const state={records:records.map(p=>({...p})),fixtures:fixtures.map(g=>({...g})),feedGeneratedAt:stamp,fixturesGeneratedAt:stamp};
 const controller=ui.create({root:host,heading:node(),status,getState:()=>state,getGame:()=>selected,now:()=>time,
  quickSlip:{add(p){picks.push(p)}},setTimeout:fn=>{scheduled=fn;return 1},clearTimeout(){},workerFactory(){
   const worker={terminate(){this.terminated=true},postMessage(message){this.message=message}};jobs.push(worker);return worker;
  }});
 const finish=()=>{for(const job of jobs.filter(j=>!j.finished&&!j.terminated)){job.finished=true;job.onmessage({data:{result:simulation(job.message.players,withSettlements)}})}};
 return {controller,host,status,state,jobs,picks,finish,setTime(value){time=value},tick:()=>scheduled?.(),select(value){selected=value;return controller.refresh()}};
}
function cardHTML(view,key){
 const start=view.host.innerHTML.indexOf('data-play-key="'+key+'"');assert(start>=0,'play remains visible');
 return view.host.innerHTML.slice(start,view.host.innerHTML.indexOf('</article>',start));
}
function inputValue(view,key,attribute){
 const tag=(cardHTML(view,key).match(/<input\b[^>]*>/g)||[]).find(t=>t.includes(attribute+'="'+key+'"'));
 assert(tag,'book input exists');return /\bvalue="([^"]*)"/.exec(tag)?.[1]??'';
}
function reviewHTML(view,key){
 const card=cardHTML(view,key),start=card.indexOf('data-book-result="'+key+'"');assert(start>=0);
 return card.slice(card.indexOf('>',start)+1,card.indexOf('</p>',start));
}
function quote(view,row,line,odds){assert.equal(view.controller.setBookQuote(row.key,{line,odds}),true);return cardHTML(view,row.key)}
async function ready(view,category='REC'){
 const pending=view.controller.setCategory(category);view.finish();await pending;
 return top.select(view.controller.getResult(),category);
}
(async()=>{
 const html=fs.readFileSync('index.html','utf8');assert.match(html,/src="\.\/nfl_book_review\.js\?v=/,'browser loads the shared book review helper');
 const view=mount(),rows=await ready(view),row=rows[0];assert.equal(rows.length,3);
 for(const job of view.jobs)assert.equal(job.message.options?.collectSettlements,true,'same matchup runs collect exact line settlement counts');
 for(const r of rows){
  const card=cardHTML(view,r.key);assert.match(card,/class="nfl-top-book-review"/);
  assert(card.indexOf('nfl-top-simulation')<card.indexOf('nfl-top-book-review'),'book review is below the selected simulation');
  assert(card.indexOf('nfl-top-book-review')<card.indexOf('data-top-add='),'book review is above Quick Slip');
  assert(card.includes('aria-label="Book OVER line for '+r.p.player+'"'));assert(card.includes('aria-label="American odds for '+r.p.player+'"'));
  assert(card.includes('data-book-result="'+r.key+'"'));assert.equal(inputValue(view,r.key,'data-book-line'),'');assert.equal(inputValue(view,r.key,'data-book-odds'),'');
 }
 const original=rows.map(r=>({key:r.key,score:r.researchScore,line:r.line,rate:r.scenarioRate}));
 assert(view.controller.add(row.key));const originalPick={...view.picks[0]};
 let card=quote(view,row,'53.5','-110');assert.match(card,/60\.0%/,'exact 53.5 OVER result comes from the histogram');assert.match(card,/52\.4%/,'-110 quoted break-even is shown');assert.match(card,/uncalibrated/i);
 card=quote(view,row,'54','-110');assert.match(card,/50\.0%/,'OVER 54 requires at least 55');assert.match(card,/10\.0%/,'whole 54 can push');assert.match(card,/55\.6%/,'resolved frequency excludes refunds');
 card=quote(view,row,'54.5','+150');assert.match(card,/50\.0%/);assert.match(card,/40\.0%/,'positive American odds use the correct break-even');
 assert.equal(inputValue(view,row.key,'data-book-line'),'54.5');assert.equal(inputValue(view,row.key,'data-book-odds'),'+150');
 assert.deepEqual(top.select(view.controller.getResult(),'REC').map(r=>({key:r.key,score:r.researchScore,line:r.line,rate:r.scenarioRate})),original,'book prices never change recommendation scores, order or chosen defaults');
 assert(view.controller.add(row.key));assert.deepEqual(view.picks.at(-1),originalPick,'manual research does not replace or mutate the default Quick Slip selection');
 card=quote(view,row,'200.5','-110');assert.match(card,/0\.0%/,'a supported exact line can have a real zero win frequency');assert.doesNotMatch(card,/NaN|Infinity|undefined/);
 for(const [line,odds]of [['','-110'],['bad','-110'],['-1','-110'],['53.5',''],['53.5','-90'],['53.5','-110.5']]){
  card=quote(view,row,line,odds);assert.doesNotMatch(card,/NaN|Infinity|undefined/,'malformed fields must fail closed');assert.match(reviewHTML(view,row.key),/Enter /);assert.doesNotMatch(reviewHTML(view,row.key),/simulated wins|percentage points/,'invalid input removes the previous comparison');
 }
 // Real input events update only the comparison, keeping the active input node.
 quote(view,row,'53.5','+150');const originalHTML=view.host.innerHTML;
 const lineNode={dataset:{bookLine:row.key},value:'54.0'},oddsNode={dataset:{bookOdds:row.key},value:'+150'},resultNode={dataset:{bookResult:row.key},innerHTML:''};
 view.host.querySelectorAll=selector=>selector==='[data-book-result]'?[resultNode]:[lineNode,oddsNode];
 view.host.listeners.input({target:lineNode});assert.match(resultNode.innerHTML,/55\.6%/);assert.equal(lineNode.value,'54.0');assert.equal(oddsNode.value,'+150');
 oddsNode.value='-110';view.host.listeners.input({target:oddsNode});assert.match(resultNode.innerHTML,/52\.4%/);assert.equal(lineNode.value,'54.0','editing odds preserves exact line entry');
 lineNode.value='bad';view.host.listeners.input({target:lineNode});assert.match(resultNode.innerHTML,/Enter a valid/);assert.doesNotMatch(resultNode.innerHTML,/simulated wins/);
 assert.equal(view.host.innerHTML,originalHTML,'typing must not replace the cards or active input');delete view.host.querySelectorAll;
 quote(view,row,'53.5','+150');await view.controller.setCategory('RUSH');await view.controller.setCategory('REC');
 assert.equal(inputValue(view,row.key,'data-book-line'),'53.5');assert.equal(inputValue(view,row.key,'data-book-odds'),'+150','quotes survive category navigation');
 await view.tick();assert.equal(inputValue(view,row.key,'data-book-odds'),'+150','periodic refresh preserves user entry with unchanged inputs');
 const alternate=row.alternatives.find(a=>a.line!==row.line);assert(alternate);assert(view.controller.setLine(row.key,alternate.line));assert.equal(inputValue(view,row.key,'data-book-line'),'53.5','alternate selection does not overwrite a manually entered book line');
 await view.controller.setCategory('CATCH');const catches=top.select(view.controller.getResult(),'CATCH')[0];
 card=quote(view,catches,'4','-110');assert.match(card,/60\.0%/);assert.match(card,/20\.0%/,'exactly four catches refund an OVER 4 wager');assert.match(card,/75\.0%/,'resolved win frequency accounts for reception pushes');
 card=quote(view,catches,'4.5','-110');assert.match(card,/60\.0%/);assert.doesNotMatch(card,/75\.0%/,'half-line comparison has no push adjustment');
 await view.controller.setCategory('TD');assert(top.select(view.controller.getResult(),'TD').length>0);assert.doesNotMatch(view.host.innerHTML,/nfl-top-book-review|data-book-line=|data-book-odds=/,'TD cards have no unsupported probability or price comparison');
 const td=top.select(view.controller.getResult(),'TD')[0];assert.equal(view.controller.setBookQuote(td.key,{line:'0.5',odds:'+100'}),false);assert.equal(view.controller.setBookQuote('unknown',{line:'10',odds:'-110'}),false);
 await view.controller.setCategory('REC');
 // New source content invalidates user comparisons, even with the same timestamps.
 view.state.records=view.state.records.map(p=>({...p}));let pending=view.controller.refresh();view.finish();await pending;
 let fresh=top.select(view.controller.getResult(),'REC')[0];assert.equal(inputValue(view,fresh.key,'data-book-line'),'');assert.equal(inputValue(view,fresh.key,'data-book-odds'),'');
 quote(view,fresh,'53.5','-110');view.state.feedGeneratedAt=new Date(now+1000).toISOString();pending=view.controller.refresh();view.finish();await pending;
 fresh=top.select(view.controller.getResult(),'REC')[0];assert.equal(inputValue(view,fresh.key,'data-book-line'),'','feed timestamp changes invalidate comparisons');
 quote(view,fresh,'53.5','-110');view.state.fixtures=view.state.fixtures.map(g=>({...g,kickoff_at:new Date(Date.parse(g.kickoff_at)+60000).toISOString()}));pending=view.controller.refresh();view.finish();await pending;
 fresh=top.select(view.controller.getResult(),'REC')[0];assert.equal(inputValue(view,fresh.key,'data-book-line'),'','fixture changes invalidate comparisons');
 quote(view,fresh,'53.5','-110');view.state.excluded=p=>p.player_id===fresh.p.player_id;pending=view.controller.refresh();view.finish();await pending;
 assert.equal(view.controller.setBookQuote(fresh.key,{line:'53.5',odds:'-110'}),false,'new exclusions block stale review actions');view.controller.destroy();
 const kickoff=mount();const kickoffWork=kickoff.select('A|B');kickoff.finish();await kickoffWork;
 const kickoffRows=await ready(kickoff),kickoffRow=kickoffRows[0];quote(kickoff,kickoffRow,'53.5','-110');kickoff.setTime(now+3600001);
 assert.equal(kickoff.controller.setBookQuote(kickoffRow.key,{line:'53.5',odds:'-110'}),false,'started games block stale review actions without waiting for a timer');
 await kickoff.controller.refresh();assert.doesNotMatch(kickoff.host.innerHTML,/nfl-top-book-review/);kickoff.controller.destroy();
 // An input action itself must notice replaced source data before any timer or
 // explicit refresh can combine the new feed with the old model histogram.
 const mutations={
  records:v=>{v.state.records=v.state.records.map(p=>({...p}))},
  timestamp:v=>{v.state.feedGeneratedAt=new Date(now+1000).toISOString()},
  fixture:v=>{v.state.fixtures=v.state.fixtures.map(g=>({...g,kickoff_at:new Date(Date.parse(g.kickoff_at)+60000).toISOString()}))},
  exclusion:(v,r)=>{const id=v.state.records.find(p=>p.player_id!==r.p.player_id).player_id;v.state.excluded=p=>p.player_id===id}
 };
 for(const [kind,mutate]of Object.entries(mutations)){
  const direct=mount(),oldRows=await ready(direct),oldRow=oldRows[0];quote(direct,oldRow,'53.5','-110');
  const originalJobs=direct.jobs.length;mutate(direct,oldRow);
  assert.equal(direct.controller.setBookQuote(oldRow.key,{line:'54.5',odds:'+150'}),false,kind+' change refuses the input action before explicit refresh');
  assert.equal(direct.jobs.length,originalJobs+2,kind+' change starts fresh matchup workers');
  assert.doesNotMatch(direct.host.innerHTML,/data-book-result=|simulated wins/,kind+' change removes the stale comparison while new results are pending');
  const refreshed=direct.controller.refresh();direct.finish();await refreshed;
  for(const freshRow of top.select(direct.controller.getResult(),'REC')){assert.equal(inputValue(direct,freshRow.key,'data-book-line'),'');assert.equal(inputValue(direct,freshRow.key,'data-book-odds'),'','rejected input and prior prices are cleared');}
  direct.controller.destroy();
 }
 const unavailable=mount(false),unavailableRows=await ready(unavailable);card=quote(unavailable,unavailableRows[0],'53.5','-110');assert.match(card,/unavailable/i,'missing histogram does not borrow alternate-line frequencies');unavailable.controller.destroy();
 console.log('NFL book review UI: exact lines, pushes, American prices, unchanged recommendations, persistent entry and source safeguards PASS');
})().catch(error=>{console.error(error);process.exitCode=1});
