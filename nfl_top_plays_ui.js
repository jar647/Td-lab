/* Compact NFL game-first recommendations. Shared selection lives in nfl_top_plays.js. */
(function(root,factory){
 const api=factory(typeof module==='object'&&module.exports?require('./nfl_top_plays.js'):root.PropShopNFLTopPlays);
 if(typeof module==='object'&&module.exports)module.exports=api;
 root.PropShopNFLTopPlaysUI=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(top){
 'use strict';
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const pair=p=>[String(p.team||''),String(p.opp||'')].sort().join('|');
 const fixturePair=g=>[String(g.home||''),String(g.away||'')].sort().join('|');
 const finite=value=>typeof value==='number'&&Number.isFinite(value);
 const simulationPercent=rate=>finite(rate)&&rate>=0&&rate<=1?(100*rate).toFixed(1)+'%':null;
 function create(options){
  const host=options.root,heading=options.heading,status=options.status;
  const now=options.now||Date.now,cache=new Map(),lines=new Map(),failed=new Set();
  let category='ALL',result=null,pending=null,currentKey='',inputKey='',lastRecords=null,generation=0,timer=null,destroyed=false;
  const setTimer=options.setTimeout||setTimeout,clearTimer=options.clearTimeout||clearTimeout;
  function inputs(){
   const state=options.getState(),selected=options.getGame()||'ALL';
   const fixtures=Array.isArray(state.fixtures)?state.fixtures:[];
   const fixture=fixtures.find(g=>fixturePair(g)===selected);
   return {state,selected,fixture,buildOptions:{now:now(),fixtures,feedGeneratedAt:state.feedGeneratedAt,
    fixturesGeneratedAt:state.fixturesGeneratedAt,excluded:state.excluded}};
  }
  const fixtureId=g=>String(g?.game_id??g?.id??'');
  function snapshot(){
   const x=inputs();
   return x.selected==='ALL'?top.slate(x.state.records,x.state.fixtures,cache,x.buildOptions):
    top.build(x.state.records,x.fixture,cache.get(fixtureId(x.fixture))||null,x.buildOptions);
  }
  function cancel(){if(pending){for(const worker of pending.active.values())worker.terminate();pending.resolve(null);pending=null}generation++}
  function schedule(){
   if(timer)clearTimer(timer);
   if(destroyed||!result?.ready)return;
   const games=result.games||[result.fixture],kickoff=Math.min(...games.map(g=>Date.parse(g?.kickoff_at||'')).filter(t=>Number.isFinite(t)&&t>now()));
   timer=setTimer(()=>{failed.clear();return refresh()},Math.max(1,Math.min(30000,kickoff-now()+1)));
   timer?.unref?.();
  }
  function chosen(row){
   const value=lines.get(row.key),alternatives=row.alternatives||[];
   return alternatives.find(a=>Number(a.line)===value)||alternatives.find(a=>Number(a.line)===Number(row.line))||
    {line:row.line,hits:row.hits,sample:row.sample,scenarioRate:row.scenarioRate};
  }
  function selectionReasons(row,alt){
   if(row.market==='anytime_td')return row.reasons||[];
   const percent=simulationPercent(alt.scenarioRate);
   return (row.reasons||[]).map(reason=>/^Game-first scenario frequency:/.test(reason)?
    (percent===null?'Simulated frequency unavailable for this line.':'Game-first scenario frequency: '+percent+' at '+alt.line+'+ (UNCALIBRATED).'):
    /^Cleared /.test(reason)&&finite(alt.hits)&&finite(alt.sample)?'Cleared '+alt.line+'+ in '+alt.hits+' of the last '+alt.sample+' recorded games.':reason);
  }
  function card(row,index){
   const p=row.p,alt=chosen(row),isTD=row.market==='anytime_td';
   const fixture=row.fixture||result.fixture;
   const line=isTD?'Anytime rushing / receiving TD':alt.line+'+ '+row.d.label;
   const usage=(row.reasons||[]).find(s=>/^Workload:/.test(s));
   const evidence=row.opponentContext;
   const opposing=evidence?p.opp+' allows '+Number(evidence.value).toFixed(1)+' '+(isTD?'TDs':row.d.label)+' per game vs '+p.pos:
    (row.reasons||[]).find(s=>/Opponent|opponent/.test(s));
   const recent=finite(alt.hits)&&finite(alt.sample)&&alt.sample>0?'Recent clears '+alt.hits+'/'+alt.sample:'Recent sample unavailable';
   const questionable=String(p.availability).toUpperCase()==='QUESTIONABLE'||String(p.injuryReportStatus).toUpperCase()==='QUESTIONABLE';
   const alternatives=!isTD&&(row.alternatives||[]).length>1?'<label class="nfl-top-line-label">Alternate line<select data-top-line="'+esc(row.key)+'" aria-label="Alternate line for '+esc(p.player)+'">'+
    row.alternatives.map(a=>'<option value="'+a.line+'"'+(Number(a.line)===Number(alt.line)?' selected':'')+'>'+a.line+'+ '+esc(row.d.label)+' · '+(simulationPercent(a.scenarioRate)===null?'Simulation unavailable':simulationPercent(a.scenarioRate)+' simulated')+'</option>').join('')+'</select></label>':'';
   const percent=simulationPercent(alt.scenarioRate);
   const simulated=isTD?'':percent===null?'<p class="statsline nfl-top-simulation">Simulation unavailable for this line.</p>':
    '<p class="statsline nfl-top-simulation" data-scenario-rate="'+alt.scenarioRate+'" aria-live="polite"><strong>At '+alt.line+'+: '+percent+' simulated hit frequency</strong><br><span class="muted">Uncalibrated model frequency.</span></p>';
   const components=row.rating,performance=components?.performanceScore??(finite(components?.offense)?Math.round(100*components.offense):null),defense=components?.opponentScore??(finite(components?.defense)?Math.round(100*components.defense):null);
   const breakdown=finite(performance)&&finite(defense)?'<p>Player performance / usage '+performance+'/100 · Opponent vs '+esc(p.pos)+' '+defense+'/100</p>':'';
   const source=p.depthChart?.source,link=typeof source==='string'&&/^https:\/\//i.test(source)?'<p><a href="'+esc(source)+'" target="_blank" rel="noopener noreferrer">Depth-chart source</a></p>':'';
   return '<article class="matchrow nfl-top-play" data-play-key="'+esc(row.key)+'" data-player-id="'+esc(p.player_id)+'" data-score="'+row.researchScore+'">'+
    '<div class="row"><span class="pill">'+(index===0?'BEST SINGLE':'#'+(index+1))+'</span><strong class="score mono nfl-top-score">'+row.researchScore+'<small>/100</small></strong></div>'+
    '<h3>'+esc(p.player)+' <span class="pill">'+esc(p.team)+' · '+esc(p.pos)+'</span></h3>'+
    (fixture?'<p class="statsline nfl-top-matchup">'+esc(fixture.away+' @ '+fixture.home)+'</p>':'')+
    (questionable?'<p class="notice">QUESTIONABLE · verify the official active list</p>':'')+'<p class="nfl-top-selection">'+esc(line)+'</p>'+
    '<div class="bar"><div style="width:'+row.researchScore+'%"></div></div><p class="statsline">'+esc(opposing||'Opponent evidence requires review.')+'</p>'+
    (usage?'<p class="statsline">'+esc(usage)+'</p>':'')+'<p class="statsline">'+esc(recent)+'</p>'+alternatives+simulated+
    '<button type="button" class="primary nfl-top-add" data-top-add="'+esc(row.key)+'">＋ Add to Quick Slip</button>'+
    '<details class="nfl-top-evidence"><summary>Why this play?</summary>'+breakdown+
    selectionReasons(row,alt).map(s=>'<p>'+esc(s)+'</p>').join('')+'<p>'+esc(row.roleLabel||'Game-day starting status requires confirmation.')+'</p>'+
    (row.risks||[]).map(s=>'<p class="notice">'+esc(s)+'</p>').join('')+link+'</details></article>';
  }
  function render(loading=false,error=''){
   const labels={ALL:'Top plays',PASS:'Best passing plays',RUSH:'Best rushing plays',REC:'Best receiving plays',CATCH:'Best reception plays',TD:'Top 10 anytime TD scorers'};
   if(heading)heading.textContent=labels[category]+' · '+(result?.fixture?result.fixture.away+' @ '+result.fixture.home:'All games');
   const rows=loading&&category!=='TD'?[]:top.select(result,category);
   host.innerHTML=rows.length?rows.map(card).join(''):'<p class="'+(loading?'muted':'notice')+'">'+esc(loading?'Finding the best plays across '+(result?.fixture?'this matchup':'all games')+'…':'PASS · '+(result?.reason||'No supported plays meet the 60/100 minimum in this category.'))+'</p>';
   const games=result?.games||(result?.ready?[result.fixture]:[]),completed=games.filter(g=>cache.has(fixtureId(g))||failed.has(fixtureId(g))).length;
   const unavailable=games.filter(g=>failed.has(fixtureId(g))).length;
   if(status)status.textContent=loading&&category!=='TD'?'Analyzing '+completed+' of '+games.length+' games for the best plays…':
    error?(rows.length?'Showing supported TD research. ':'')+error:rows.length+' qualifying '+(rows.length===1?'play':'plays')+
    (unavailable?' · '+unavailable+' game simulation'+(unavailable===1?'':'s')+' unavailable':'')+' · Matchup scores, not win probabilities. Verify player status and sportsbook lines.';
  }
  function refresh(){
   if(destroyed)return Promise.resolve(null);
   const x=inputs();
   const excluded=(x.state.records||[]).filter(r=>typeof x.state.excluded==='function'&&x.state.excluded(r)).map(r=>String(r.player_id||r.player)).sort();
   const sourceKey=JSON.stringify([x.state.feedGeneratedAt,x.state.fixturesGeneratedAt,x.state.fixtures,excluded]);
   if(lastRecords!==x.state.records||sourceKey!==inputKey){cancel();cache.clear();failed.clear();lines.clear();currentKey='';inputKey=sourceKey;lastRecords=x.state.records}
   const key=x.selected;
   if(key!==currentKey){cancel();lines.clear();currentKey=key}
   result=snapshot();
   if(!result.ready){cancel();render();schedule();return Promise.resolve(result)}
   if(pending){render(true);return pending.promise}
   const games=result.games||[result.fixture],queue=games.filter(g=>!cache.has(fixtureId(g))&&!failed.has(fixtureId(g)));
   if(!queue.length){render();schedule();return Promise.resolve(result)}
   const token=generation;
   let resolve;const promise=new Promise(r=>{resolve=r});
   const batch={resolve,promise,active:new Map(),queue};pending=batch;render(true);
   function pump(){
    if(destroyed||token!==generation||pending!==batch)return;
    while(batch.active.size<2&&batch.queue.length){
     const game=batch.queue.shift(),id=fixtureId(game),gameKey=fixturePair(game);
     let worker;
     try{worker=options.workerFactory()}catch{failed.add(id);continue}
     batch.active.set(id,worker);
     let finished=false;
     function finish(simulation){
      if(finished)return;finished=true;
      worker.terminate();
      if(destroyed||token!==generation||pending!==batch)return;
      batch.active.delete(id);
      if(simulation&&Array.isArray(simulation.markets))cache.set(id,simulation);else failed.add(id);
      result=snapshot();render(true);pump();
     }
     worker.onmessage=e=>finish(e.data?.result||null);worker.onerror=()=>finish(null);
     try{worker.postMessage({players:x.state.records.filter(r=>r.market==='ATD'&&pair(r)===gameKey&&
      !(typeof x.state.excluded==='function'&&x.state.excluded(r))),count:10000,seed:982451653,selected:[],requestId:token})}
     catch{finish(null)}
    }
    if(!batch.active.size&&!batch.queue.length&&pending===batch){pending=null;result=snapshot();render();schedule();resolve(result)}
   }
   pump();
   return promise;
  }
  function setCategory(value){category=['PASS','RUSH','REC','CATCH','TD'].includes(value)?value:'ALL';return refresh()}
  function setLine(key,value){
   const row=result?.candidates.find(r=>r.key===key),line=Number(value);
   if(!row||!Number.isFinite(line)||!(row.alternatives||[]).some(a=>a.line===line))return false;
   lines.set(key,line);render(!!pending);return true;
  }
  function add(key){
   const fresh=snapshot();
   const row=pending&&category!=='TD'?null:top.select(fresh,category).find(r=>r.key===key);
   if(!row){result=fresh;render(!!pending);return false}
   const alt=chosen(row),td=row.market==='anytime_td';
   if(!td&&!(row.alternatives||[]).some(a=>a.line===alt.line))return false;
   const fixture=row.fixture||fresh.fixture;if(!fixture)return false;
   options.quickSlip.add({sport:'NFL',game:fixture.away+' @ '+fixture.home,gameId:fixture.game_id??fixture.id,
    player:row.p.player,team:row.p.team,opponent:row.p.opp,market:row.d.label,marketKey:row.market,
    side:td?'winner':'at_least',recommendationLine:td?null:alt.line,line:td?null:alt.line,
    recommendation:td?'Anytime rushing / receiving TD':alt.line+'+ '+row.d.label,
    researchScore:row.researchScore,sampleHits:alt.hits??null,sampleSize:alt.sample??null,
    scenarioRate:td?null:alt.scenarioRate,notes:selectionReasons(row,alt).join(' ')});
   if(status)status.textContent='Added '+row.p.player+' to Quick Slip.';
   return true;
  }
  const click=e=>{const button=e.target.closest?.('[data-top-add]');if(button&&add(button.dataset.topAdd))button.textContent='Added ✓'};
  const change=e=>{if(e.target.dataset.topLine)setLine(e.target.dataset.topLine,e.target.value)};
  host.addEventListener('click',click);host.addEventListener('change',change);
  return {refresh,setCategory,setLine,add,getResult:()=>result,destroy(){destroyed=true;cancel();if(timer)clearTimer(timer);host.removeEventListener('click',click);host.removeEventListener('change',change)}};
 }
 return {create,simulationPercent};
});
