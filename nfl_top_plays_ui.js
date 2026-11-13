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
 function create(options){
  const host=options.root,heading=options.heading,status=options.status;
  const now=options.now||Date.now,cache=new Map(),lines=new Map();
  let category='ALL',result=null,pending=null,currentKey='',lastRecords=null,generation=0,timer=null,destroyed=false;
  const setTimer=options.setTimeout||setTimeout,clearTimer=options.clearTimeout||clearTimeout;
  function inputs(){
   const state=options.getState(),selected=options.getGame();
   const fixtures=Array.isArray(state.fixtures)?state.fixtures:[];
   const fixture=fixtures.find(g=>fixturePair(g)===selected);
   return {state,selected,fixture,buildOptions:{now:now(),fixtures,feedGeneratedAt:state.feedGeneratedAt,
    fixturesGeneratedAt:state.fixturesGeneratedAt,excluded:state.excluded}};
  }
  function snapshot(simulation){const x=inputs();return top.build(x.state.records,x.fixture,simulation,x.buildOptions)}
  function cancel(){if(pending){pending.worker.terminate();pending.resolve(null);pending=null}generation++}
  function schedule(){
   if(timer)clearTimer(timer);
   if(destroyed||!result?.ready)return;
   const kickoff=Date.parse(result.fixture?.kickoff_at||'');
   timer=setTimer(()=>refresh(),Math.max(1,Math.min(30000,kickoff-now()+1)));
   timer?.unref?.();
  }
  function chosen(row){
   const value=lines.get(row.key),alternatives=row.alternatives||[];
   return alternatives.find(a=>Number(a.line)===value)||alternatives.find(a=>Number(a.line)===Number(row.line))||
    {line:row.line,hits:row.hits,sample:row.sample,scenarioRate:row.scenarioRate};
  }
  function selectionReasons(row,alt){
   if(row.market==='anytime_td')return row.reasons||[];
   return (row.reasons||[]).map(reason=>/^Game-first scenario frequency:/.test(reason)&&finite(alt.scenarioRate)?
    'Game-first scenario frequency: '+(100*alt.scenarioRate).toFixed(1)+'% at '+alt.line+'+ (UNCALIBRATED).':
    /^Cleared /.test(reason)&&finite(alt.hits)&&finite(alt.sample)?'Cleared '+alt.line+'+ in '+alt.hits+' of the last '+alt.sample+' recorded games.':reason);
  }
  function card(row,index){
   const p=row.p,alt=chosen(row),isTD=row.market==='anytime_td';
   const line=isTD?'Anytime rushing / receiving TD':alt.line+'+ '+row.d.label;
   const usage=(row.reasons||[]).find(s=>/^Workload:/.test(s));
   const evidence=row.opponentContext;
   const opposing=evidence?p.opp+' allows '+Number(evidence.value).toFixed(1)+' '+(isTD?'TDs':row.d.label)+' per game vs '+p.pos:
    (row.reasons||[]).find(s=>/Opponent|opponent/.test(s));
   const recent=finite(alt.hits)&&finite(alt.sample)&&alt.sample>0?'Recent clears '+alt.hits+'/'+alt.sample:'Recent sample unavailable';
   const questionable=String(p.availability).toUpperCase()==='QUESTIONABLE'||String(p.injuryReportStatus).toUpperCase()==='QUESTIONABLE';
   const alternatives=(row.alternatives||[]).length>1?'<label class="nfl-top-line-label">Alternate line<select data-top-line="'+esc(row.key)+'" aria-label="Alternate line for '+esc(p.player)+'">'+
    row.alternatives.map(a=>'<option value="'+a.line+'"'+(Number(a.line)===Number(alt.line)?' selected':'')+'>'+a.line+'+ '+esc(row.d.label)+'</option>').join('')+'</select></label>':'';
   const components=row.rating,performance=components?.performanceScore??(finite(components?.offense)?Math.round(100*components.offense):null),defense=components?.opponentScore??(finite(components?.defense)?Math.round(100*components.defense):null);
   const breakdown=finite(performance)&&finite(defense)?'<p>Player performance / usage '+performance+'/100 · Opponent vs '+esc(p.pos)+' '+defense+'/100</p>':'';
   const source=p.depthChart?.source,link=typeof source==='string'&&/^https:\/\//i.test(source)?'<p><a href="'+esc(source)+'" target="_blank" rel="noopener noreferrer">Depth-chart source</a></p>':'';
   return '<article class="matchrow nfl-top-play" data-play-key="'+esc(row.key)+'" data-player-id="'+esc(p.player_id)+'" data-score="'+row.researchScore+'">'+
    '<div class="row"><span class="pill">'+(index===0?'BEST SINGLE':'#'+(index+1))+'</span><strong class="score mono nfl-top-score">'+row.researchScore+'<small>/100</small></strong></div>'+
    '<h3>'+esc(p.player)+' <span class="pill">'+esc(p.team)+' · '+esc(p.pos)+'</span></h3>'+(questionable?'<p class="notice">QUESTIONABLE · verify the official active list</p>':'')+'<p class="nfl-top-selection">'+esc(line)+'</p>'+
    '<div class="bar"><div style="width:'+row.researchScore+'%"></div></div><p class="statsline">'+esc(opposing||'Opponent evidence requires review.')+'</p>'+
    (usage?'<p class="statsline">'+esc(usage)+'</p>':'')+'<p class="statsline">'+esc(recent)+'</p>'+alternatives+
    '<button type="button" class="primary nfl-top-add" data-top-add="'+esc(row.key)+'">＋ Add to Quick Slip</button>'+
    '<details class="nfl-top-evidence"><summary>Why this play?</summary>'+breakdown+
    selectionReasons(row,alt).map(s=>'<p>'+esc(s)+'</p>').join('')+'<p>'+esc(row.roleLabel||'Game-day starting status requires confirmation.')+'</p>'+
    (row.risks||[]).map(s=>'<p class="notice">'+esc(s)+'</p>').join('')+link+'</details></article>';
  }
  function render(loading=false,error=''){
   const selected=options.getGame();
   if(heading)heading.textContent=result?.fixture?'Top plays · '+result.fixture.away+' @ '+result.fixture.home:'NFL TOP PLAYS';
   if(!selected||selected==='ALL'){
    host.innerHTML='<p class="muted">Choose a game above to see its best single and top plays.</p>';
    if(status)status.textContent='';return;
   }
   const rows=top.select(result,category,3);
   host.innerHTML=rows.length?rows.map(card).join(''):'<p class="'+(loading?'muted':'notice')+'">'+esc(loading?'Finding the top plays for this matchup…':'PASS · '+(result?.reason||'No supported plays meet the 60/100 minimum in this category.'))+'</p>';
   if(status)status.textContent=loading?'Analyzing player usage and opponent matchups…':
    error?(rows.length?'Showing supported TD research. ':'')+error:rows.length+' qualifying '+(rows.length===1?'play':'plays')+' · Matchup scores, not win probabilities. Verify player status and sportsbook lines.';
  }
  function refresh(){
   if(destroyed)return Promise.resolve(null);
   const x=inputs();
   if(lastRecords!==x.state.records){cancel();cache.clear();lines.clear();currentKey='';lastRecords=x.state.records}
   result=top.build(x.state.records,x.fixture,null,x.buildOptions);
   if(!x.selected||x.selected==='ALL'||!result.ready){cancel();currentKey='';render();schedule();return Promise.resolve(result)}
   const excluded=(x.state.records||[]).filter(r=>typeof x.state.excluded==='function'&&x.state.excluded(r)).map(r=>String(r.player_id||r.player)).sort();
   const key=JSON.stringify([x.selected,x.fixture?.game_id||x.fixture?.id,x.fixture?.kickoff_at,x.state.feedGeneratedAt,x.state.fixturesGeneratedAt,excluded]);
   if(key!==currentKey){cancel();lines.clear();currentKey=key}
   if(cache.has(key)){result=snapshot(cache.get(key));render();schedule();return Promise.resolve(result)}
   if(pending?.key===key){render(true);return pending.promise}
   render(true);
   let worker;
   try{worker=options.workerFactory()}catch(error){render(false,'Game simulation unavailable: '+error.message);schedule();return Promise.resolve(result)}
   const token=generation;
   let resolve;const promise=new Promise(r=>{resolve=r});
   pending={worker,resolve,promise,key};
   function finish(simulation,error=''){
    worker.terminate();
    if(destroyed||token!==generation||options.getGame()!==x.selected){resolve(null);return}
    pending=null;
    if(simulation)cache.set(key,simulation);
    result=snapshot(simulation);render(false,error);schedule();resolve(result);
   }
   worker.onmessage=e=>e.data?.result?finish(e.data.result):finish(null,'Game simulation unavailable; no simulated play is shown.');
   worker.onerror=()=>finish(null,'Game simulation unavailable; no simulated play is shown.');
   try{worker.postMessage({players:x.state.records.filter(r=>r.market==='ATD'&&pair(r)===x.selected&&
     !(typeof x.state.excluded==='function'&&x.state.excluded(r))),count:10000,seed:982451653,selected:[],requestId:token})}
   catch(error){finish(null,'Game simulation unavailable: '+error.message)}
   return promise;
  }
  function setCategory(value){category=['PASS','RUSH','REC','CATCH','TD'].includes(value)?value:'ALL';return refresh()}
  function setLine(key,value){
   const row=result?.candidates.find(r=>r.key===key),line=Number(value);
   if(!row||!Number.isFinite(line)||!(row.alternatives||[]).some(a=>a.line===line))return false;
   lines.set(key,line);render(!!pending);return true;
  }
  function add(key){
   const simulation=cache.get(currentKey)||null,fresh=snapshot(simulation);
   const row=top.select(fresh,category,3).find(r=>r.key===key);
   if(!row){result=fresh;render(!!pending);return false}
   const alt=chosen(row),td=row.market==='anytime_td';
   if(!td&&!(row.alternatives||[]).some(a=>a.line===alt.line))return false;
   options.quickSlip.add({sport:'NFL',game:row.p.team+' vs '+row.p.opp,gameId:fresh.fixture.game_id||fresh.fixture.id,
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
 return {create};
});
