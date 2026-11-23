/* NFL parlay drafts use existing matchup research and user-entered book quotes. */
(function(root,factory){
 const common=typeof module==='object'&&module.exports;
 const api=factory(common?require('./nfl_parlay.js'):root.PropShopNFLParlay,common?require('./nfl_book_review.js'):root.PropShopNFLBookReview,common?require('./nfl_parlay_optimizer.js'):root.PropShopNFLParlayOptimizer);
 if(common)module.exports=api;root.PropShopNFLParlayUI=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(parlay,book,optimizer){
 'use strict';
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const percent=value=>(100*value).toFixed(1)+'%';
 const gameId=c=>String(c.fixture?.game_id??c.fixture?.id??'');
 const playerId=c=>String(c.p.player_id);
 function create(options){
  const host=options.root,now=options.now||Date.now;
  const setTimer=options.setTimeout||setTimeout,clearTimer=options.clearTimeout||clearTimeout;
  let count=3,mode='across',game='',signature=null,lastReady=null,lastQuotes='',draft=[],message='',combinedOdds='',stake='10',simulation=null,running=null,token=0,destroyed=false;
  const quotes=new Map(),excludedPlayers=new Set();
  let offers=[],offerSerial=0,optimized=false,offerChoice='',offerLine='',offerOdds='',offeredOutcomes=new Map();
  const researchPool=s=>s.offeredCandidates||s.candidates||[];
  const allKeys=s=>new Set([...(s.candidates||[]),...researchPool(s)].map(c=>c.key));
  const state=()=>options.getState();
  function cancel(){
   token++;
   if(running){for(const job of running.active){job.worker.terminate();clearTimer(job.timer)}running.resolve(null);running=null}
  }
  function quote(c,s){return quotes.get(c.key)||s.quotes?.[c.key]||{line:'',odds:''}}
  function review(c,s){
   const q=quote(c,s),settlement=(optimized?offeredOutcomes.get(gameId(c)):null)?.settlements?.find(row=>row.id===playerId(c)&&row.market===c.market)||s.simulations?.get(gameId(c))?.settlements?.find(row=>row.id===playerId(c)&&row.market===c.market);
   return book.evaluate({settlement,line:q.line,odds:q.odds});
  }
  function fingerprint(s){return JSON.stringify(draft.map(c=>[c.key,quote(c,s).line]))}
  function quoteFingerprint(s){return JSON.stringify(draft.map(c=>[c.key,quote(c,s).line,quote(c,s).odds]))}
  function current(){
   const s=state(),keys=allKeys(s);
   return s.ready&&s.signature===signature&&draft.every(c=>keys.has(c.key)&&Date.parse(c.fixture?.kickoff_at)>now())?s:null;
  }
  function resultHTML(s){
   if(running)return running.kind==='optimize'?'Comparing your offered alternatives together within each game…':'Simulating this ticket’s players together within each game…';
   if(!simulation||simulation.fingerprint!==fingerprint(s))return 'Enter each leg’s actual book line and odds, then simulate the ticket.';
   const result=parlay.combine(simulation.groups,{combinedOdds});
   if(result.status==='unavailable')return 'Ticket simulation unavailable. Generate a new draft.';
   const rates=simulation.rates;
   let text='<strong>All legs win: '+percent(rates.allWinRate)+' simulated</strong><br>At least one losing leg: '+percent(rates.lossRate);
   if(rates.pushOnlyRate>0)text+='<br>No losing leg, at least one push: '+percent(rates.pushOnlyRate)+' · the book must reprice or settle the reduced ticket.';
   text+='<br><span class="muted">'+(rates.independentGames?'Same-game dependencies were simulated; separate games are assumed independent.':'All legs were evaluated in the same simulated games.')+' Uncalibrated model frequency.</span>';
   if(result.status==='invalid-odds')return text+'<p>Enter valid combined American odds, such as +500.</p>';
   if(result.price){
    text+='<p>Book’s combined price: '+esc(result.price.american>0?'+'+result.price.american:result.price.american);
    const amount=Number(stake);
    if(String(stake).trim()&&Number.isFinite(amount)&&amount>0&&amount<=100000)text+=' · $'+amount.toFixed(2)+' stake returns $'+(amount*result.price.decimal).toFixed(2)+' on a full win';
    text+='.</p>';
    if(result.modelDifference!==null)text+='<p>Price requires '+percent(result.price.implied)+' wins. Model is '+Math.abs(100*result.modelDifference).toFixed(1)+' percentage points '+(result.modelDifference>=0?'above':'below')+' that requirement. This does not establish a betting edge.</p>';
    else text+='<p>Push outcomes need the book’s reduced-ticket rules before a price comparison is possible.</p>';
   }else text+='<p>Enter the book’s actual combined price to review the payout. Individual prices are not multiplied.</p>';
   return text;
  }
  function legReviewHTML(c,s){
   const r=review(c,s),q=quote(c,s);
   if(!String(q.line??'').trim()&&!String(q.odds??'').trim())return 'Book line and price not entered.';
   if(r.status==='invalid-line')return 'Enter a whole or half-point book OVER line.';
   if(r.status==='invalid-odds')return 'Enter American odds such as -110 or +150.';
   if(r.status!=='ready')return 'No supported simulation for this line.';
   return 'Book OVER '+esc(q.line)+': '+percent(r.winRate)+' simulated wins'+(r.pushRate>0?' · '+percent(r.pushRate)+' pushes':'')+'.';
  }
  function render(){
   if(destroyed)return;
   const s=state(),fixtures=s.fixtures||[];
   if(!game||!fixtures.some(g=>String(g.game_id??g.id)===game))game=String(fixtures[0]?.game_id??fixtures[0]?.id??'');
   const pool=researchPool(s).filter(c=>c.market!=='anytime_td'&&(mode!=='same'||gameId(c)===game));
   if(!pool.some(c=>c.key===offerChoice))offerChoice=pool[0]?.key||'';
   host.innerHTML='<p class="muted">Enter alternative lines your book offers, then compare complete tickets using matchup quality, observed workload, line difficulty and shared game outcomes. Matchup scores stay separate from prices.</p>'+
    '<div class="grid"><label>Legs<select data-parlay-count aria-label="Parlay leg count">'+[2,3,4,5,6,7,8,9,10].map(n=>'<option value="'+n+'"'+(n===count?' selected':'')+'>'+n+' legs</option>').join('')+'</select></label>'+
    '<label>Ticket type<select data-parlay-mode aria-label="Parlay ticket type"><option value="across"'+(mode==='across'?' selected':'')+'>Different games</option><option value="same"'+(mode==='same'?' selected':'')+'>Same game</option></select></label></div>'+
    (mode==='same'?'<label>Matchup<select data-parlay-game aria-label="Parlay matchup">'+fixtures.map(g=>{const id=String(g.game_id??g.id);return '<option value="'+esc(id)+'"'+(id===game?' selected':'')+'>'+esc(g.away+' @ '+g.home)+'</option>'}).join('')+'</select></label>':'')+
    '<details class="nfl-offered-options" open><summary>Book options · '+offers.length+' entered</summary><p class="statsline">Add multiple players or alternative lines for the same player. Only one leg per player can be selected. Enter strict OVER lines: 3+ catches corresponds to OVER 2.5.</p>'+
    '<label>Player and market<select data-parlay-offer-player aria-label="Offered player and market">'+pool.map(c=>'<option value="'+esc(c.key)+'"'+(c.key===offerChoice?' selected':'')+'>'+esc(c.fixture.away+' @ '+c.fixture.home+' · '+c.p.player+' · '+c.d.label+' · '+c.researchScore+'/100')+'</option>').join('')+'</select></label>'+
    '<div class="grid"><label>Actual book OVER line<input type="number" min="0.5" step="0.5" data-parlay-offer-line value="'+esc(offerLine)+'" aria-label="New offered OVER line" placeholder="Exact book line"></label><label>American odds<input type="text" data-parlay-offer-odds value="'+esc(offerOdds)+'" aria-label="New offered American odds" placeholder="-110 or +150"></label></div>'+
    '<button type="button" class="smallbtn" data-parlay-offer-add>Add offered alternative</button><button type="button" class="smallbtn" data-parlay-offer-import>Use book lines entered on the board</button>'+
    '<div data-parlay-offer-list>'+offers.map(o=>{const c=researchPool(s).find(c=>c.key===o.candidateKey);return '<p class="statsline">'+esc(c?.p.player||'Unavailable player')+' · OVER '+esc(o.line)+' '+esc(c?.d.label||'')+' · '+esc(Number(o.odds)>0?'+'+Number(o.odds):o.odds)+' <button type="button" class="smallbtn" data-parlay-offer-remove="'+esc(o.id)+'">Remove option</button></p>'}).join('')+'</div></details>'+
    '<button type="button" class="primary" data-parlay-optimize'+(!s.ready||running?' disabled':'')+'>Compare my options · '+count+' legs</button>'+
    '<button type="button" class="smallbtn" data-parlay-generate'+(!s.ready?' disabled':'')+'>Explore '+count+' unpriced research targets</button>'+
    '<button type="button" class="smallbtn" data-parlay-add-research'+(!draft.length||optimized||!s.ready?' disabled':'')+'>Add all '+draft.length+' suggested picks to Quick Slip</button>'+ 
    '<p class="statsline" data-parlay-status role="status">'+esc(message||(!s.ready?s.reason:'Distinct players; no filler legs. Same-game mode accounts for shared opportunities.'))+'</p>'+
    '<div data-parlay-legs>'+draft.map((c,i)=>{
     const q=quote(c,s);
     return '<section class="nfl-parlay-leg" data-parlay-key="'+esc(c.key)+'"><div class="row"><strong>Leg '+(i+1)+' · '+esc(c.p.player)+'</strong><span class="pill">'+c.researchScore+'/100</span></div>'+
      '<p class="statsline">'+esc(c.fixture.away+' @ '+c.fixture.home)+' · '+esc(c.d.label)+'</p>'+
      (optimized?'<p class="statsline"><strong>Selected book OVER '+esc(c.bookLine)+' '+esc(c.d.label)+'</strong> · '+percent(c.scenarioRate)+' simulated.</p><p class="statsline">'+esc(c.selectionReason)+'</p>':'<p class="statsline">Research target: '+c.line+'+ · '+percent(c.scenarioRate)+' simulated. Availability at your book is unconfirmed.</p>')+
      '<div class="grid"><label>Book OVER line<input type="number" min="0" max="10000" step="0.5" inputmode="decimal" data-parlay-line="'+esc(c.key)+'" value="'+esc(q.line)+'"'+(optimized?' readonly':'')+' aria-label="Parlay book OVER line for '+esc(c.p.player)+'"></label>'+
      '<label>American odds<input type="text" data-parlay-odds="'+esc(c.key)+'" value="'+esc(q.odds)+'" placeholder="-110 or +150" aria-label="Parlay American odds for '+esc(c.p.player)+'"></label></div>'+
      '<p class="statsline" data-parlay-review="'+esc(c.key)+'">'+legReviewHTML(c,s)+'</p>'+
      '<button type="button" class="smallbtn" data-parlay-replace="'+esc(c.key)+'">Replace player</button></section>';
    }).join('')+'</div>'+
    (draft.length?'<label>Book’s combined American odds<input type="text" data-parlay-combined value="'+esc(combinedOdds)+'" placeholder="Enter the book’s full-ticket price" aria-label="Combined parlay American odds"></label>'+
     '<label>Stake ($)<input type="number" min="0.01" max="100000" step="0.01" data-parlay-stake value="'+esc(stake)+'" aria-label="Parlay stake"></label>'+
     '<button type="button" class="primary" data-parlay-simulate'+(running?' disabled':'')+'>Simulate exact book lines</button>'+
     '<div class="statsline" data-parlay-result aria-live="polite">'+resultHTML(s)+'</div>'+
     '<button type="button" class="smallbtn" data-parlay-add>Add these book legs to Quick Slip</button>':'')+
    '<p class="muted">A draft is not a placed bet. OVER-only player props; no TD or game-line legs without supported simulation. Confirm injuries and the book’s parlay rules.</p>';
   lastQuotes=quoteFingerprint(s);
  }
  function refresh(){
   const s=state(),keys=allKeys(s);
   const changed=signature!==s.signature;
   const expired=draft.some(c=>!keys.has(c.key)||Date.parse(c.fixture?.kickoff_at)<=now());
   if(changed||expired){const hadDraft=draft.length;cancel();simulation=null;draft=[];quotes.clear();excludedPlayers.clear();offers=[];optimized=false;offeredOutcomes.clear();combinedOdds='';signature=s.signature;message=hadDraft?'The board changed. Generate a fresh draft and recheck book lines.':'';render()}
   else if(running&&running.kind!=='optimize'&&running.fingerprint!==fingerprint(s)){cancel();simulation=null;combinedOdds='';message='A book line changed. Simulate the updated ticket.';render()}
   else if(simulation&&simulation.fingerprint!==fingerprint(s)){simulation=null;combinedOdds='';message='A book line changed. Simulate the updated ticket.';render()}
   else if(draft.length&&lastQuotes!==quoteFingerprint(s)){combinedOdds='';render()}
   else if(lastReady!==s.ready)render();
   lastReady=s.ready;
  }
  function generate(replaceKey=null){
   if(optimized&&replaceKey)return optimize(replaceKey);
   refresh();const s=state();
   if(!s.ready){message=s.reason;render();return []}
   if(replaceKey){const old=draft.find(c=>c.key===replaceKey);if(old)excludedPlayers.add(playerId(old))}else excludedPlayers.clear();
   cancel();simulation=null;optimized=false;combinedOdds='';
   const result=parlay.generate((s.candidates||[]).filter(c=>!excludedPlayers.has(playerId(c))),{count,mode,gameId:game,now:now()});
   draft=result.legs;message=result.shortfall?result.reason:'Draft ready. Enter each leg’s actual book line and price.';
   render();return draft;
  }
  function addOffer(candidateKey,values={}){
   refresh();const s=state(),c=researchPool(s).find(c=>c.key===candidateKey);
   const line=book.parseLine(values.line),check=book.evaluate({line:values.line,odds:values.odds});
   if(!s.ready||!c||!parlay.eligible(c,now())||line===null||['invalid-line','invalid-odds'].includes(check.status)){
    message='Choose a supported player and enter the actual whole/half-point OVER line and valid American odds.';render();return false;
   }
   if(offers.length>=120&&!offers.some(o=>o.candidateKey===candidateKey&&o.line===line)){message='Review or remove existing book options before adding more.';render();return false}
   cancel();simulation=null;draft=[];optimized=false;combinedOdds='';offeredOutcomes.clear();
   const previous=offers.find(o=>o.candidateKey===candidateKey&&o.line===line),offer={id:previous?.id||'offer-'+(++offerSerial),candidateKey,line,odds:String(values.odds)};
   offers=offers.filter(o=>o.id!==offer.id);offers.push(offer);offerLine='';offerOdds='';message=offers.length+' book options ready for comparison.';render();return true;
  }
  function removeOffer(id){
   if(!offers.some(o=>o.id===id))return false;
   cancel();offers=offers.filter(o=>o.id!==id);draft=[];simulation=null;optimized=false;combinedOdds='';offeredOutcomes.clear();message='Book options changed. Compare again.';render();return true;
  }
  function optimize(replaceKey=null){
   refresh();const s=state();
   if(!s.ready||!optimizer){message=s.reason||'Offered-line comparison is unavailable. Refresh and retry.';render();return Promise.resolve(null)}
   if(replaceKey){const old=draft.find(c=>c.key===replaceKey);if(old)excludedPlayers.add(playerId(old))}else excludedPlayers.clear();
   const pool=researchPool(s).filter(c=>!excludedPlayers.has(playerId(c))),byKey=new Map(pool.map(c=>[c.key,c]));
   const selected=offers.filter(o=>byKey.has(o.candidateKey)&&(mode!=='same'||gameId(byKey.get(o.candidateKey))===game));
   if(selected.length<count){message='Add at least '+count+' offered alternatives from distinct players before comparing a complete ticket.';render();return Promise.resolve(null)}
   cancel();draft=[];simulation=null;optimized=false;combinedOdds='';offeredOutcomes.clear();const runToken=token,source=s.signature,groups=new Map();
   for(const o of selected){const c=byKey.get(o.candidateKey),id=gameId(c);if(!groups.has(id))groups.set(id,{id,fixture:c.fixture,markets:new Map()});groups.get(id).markets.set(playerId(c)+'|'+c.market,{id:playerId(c),market:c.market})}
   const queue=[...groups.values()],results=new Map();let resolve;const promise=new Promise(r=>{resolve=r});
   const task={kind:'optimize',active:new Set(),resolve};running=task;message='Comparing your book’s alternatives in shared game outcomes…';render();
   const stop=reason=>{if(running!==task)return;cancel();message=reason;render()};
   function applyResult(result){
    if(destroyed||running!==task||token!==runToken)return;
    const fresh=state();if(!fresh.ready||fresh.signature!==source){stop('The player or game sources changed. Recheck your book options.');return}
    if(!result||typeof result.available!=='boolean'||!Array.isArray(result.legs)||result.available&&result.legs.length!==count||!result.available&&result.legs.length){stop('A complete option comparison is unavailable.');return}
    const rates=parlay.combine(result.groups||[]);
    if(result.available&&(rates.status!=='ready'||result.groups.some(g=>g.outcomeSetId!==results.get(g.gameId)?.outcomeSetId||g.parlay.count!==10000||g.parlay.legs!==result.legs.filter(c=>gameId(byKey.get(c.key)||{})===g.gameId).length))){stop('The ticket outcomes do not match the current game batches.');return}
    if(result.available&&result.legs.some(c=>{
     const base=byKey.get(c.key),offer=selected.find(o=>o.id===c.offerId&&o.candidateKey===c.key&&o.line===c.bookLine);
     const settlement=base?results.get(gameId(base))?.settlements?.find(r=>r.id===playerId(base)&&r.market===base.market):null;
     const checked=offer?book.evaluate({settlement,line:offer.line,odds:offer.odds}):null;
     return !base||checked?.status!=='ready'||!Number.isFinite(c.scenarioRate)||Math.abs(checked.winRate-c.scenarioRate)>1e-10||checked.american!==c.bookOdds;
    })){stop('The selected options do not match the current exact book lines.');return}
    running=null;optimized=result.available===true;draft=result.legs.map(c=>({...byKey.get(c.key),offered:true,offerId:c.offerId,bookLine:c.bookLine,bookOdds:c.bookOdds,scenarioRate:c.scenarioRate,selectionReason:c.selectionReason}));offeredOutcomes=results;
    for(const c of draft)quotes.set(c.key,{line:String(c.bookLine),odds:String(c.bookOdds)});
    if(optimized&&rates.status==='ready')simulation={groups:result.groups,rates,fingerprint:fingerprint(fresh)};
    else if(optimized){draft=[];optimized=false}
    message=result.reason;render();resolve(result);
   }
   function pump(){
    if(destroyed||running!==task||token!==runToken)return;
    while(task.active.size<2&&queue.length){
     const group=queue.shift();let worker;try{worker=options.workerFactory()}catch{stop('Simulation worker unavailable; no ticket was selected.');return}
     const job={worker,timer:null};task.active.add(job);job.timer=setTimer(()=>stop('Option comparison timed out. Retry with current sources.'),45000);
     worker.onerror=()=>stop('Option simulation failed; no partial ticket percentage is supplied.');
     worker.onmessage=event=>{
      if(running!==task||token!==runToken)return;
      worker.terminate();clearTimer(job.timer);task.active.delete(job);
      const r=event.data?.result,expected=s.simulations?.get(group.id);
      if(event.data?.requestId!==runToken||r?.count!==10000||r.seed!==982451653||!r.outcomeSetId||!Array.isArray(r.playerOutcomes)||expected?.modelVersion&&r.modelVersion!==expected.modelVersion){stop('Complete aligned outcomes are unavailable. Refresh before selecting a ticket.');return}
      results.set(group.id,r);pump();
     };
     const players=s.records.filter(p=>p.market==='ATD'&&((p.team===group.fixture.home&&p.opp===group.fixture.away)||(p.team===group.fixture.away&&p.opp===group.fixture.home)));
     try{worker.postMessage({players,count:10000,seed:982451653,selected:[],options:{collectSettlements:true,collectPlayerOutcomes:[...group.markets.values()]},requestId:runToken})}catch{stop('Offered options could not be simulated.');return}
    }
    if(!queue.length&&!task.active.size){
     const currentState=state();if(!currentState.ready||currentState.signature!==source){stop('The player or game sources changed. Recheck your book options.');return}
     const config={count,mode,gameId:game,now:now()};
     if(typeof options.optimizerWorkerFactory==='function'){
      let worker;try{worker=options.optimizerWorkerFactory()}catch{stop('The option comparison worker could not start.');return}
      const job={worker,timer:null};task.active.add(job);job.timer=setTimer(()=>stop('Option search timed out. Review fewer alternatives and retry.'),45000);
      worker.onerror=()=>stop('The option comparison failed. No ticket was selected.');
      worker.onmessage=e=>{if(running!==task||token!==runToken)return;worker.terminate();clearTimer(job.timer);task.active.delete(job);if(e.data?.requestId!==runToken||e.data?.error){stop('The option comparison returned incomplete data.');return}applyResult(e.data.result)};
      const compact=pool.map(c=>({...c,fixture:{game_id:gameId(c),home:c.fixture.home,away:c.fixture.away,kickoff_at:c.fixture.kickoff_at}}));
      try{worker.postMessage({requestId:runToken,candidates:compact,offers:selected,simulations:[...results].map(([id,r])=>[id,{count:r.count,seed:r.seed,modelVersion:r.modelVersion,outcomeSetId:r.outcomeSetId,playerOutcomes:r.playerOutcomes}]),options:config})}catch{stop('The offered alternatives could not be compared.')}
     }else applyResult(optimizer.optimize(pool,selected,results,config));
    }
   }
   pump();return promise;
  }
  function updateResults(){
   const s=current();if(!s){refresh();return}
   for(const target of host.querySelectorAll?.('[data-parlay-review]')||[]){const c=draft.find(c=>c.key===target.dataset.parlayReview);if(c)target.innerHTML=legReviewHTML(c,s)}
   const target=host.querySelector?.('[data-parlay-result]');if(target)target.innerHTML=resultHTML(s);else render();
   lastQuotes=quoteFingerprint(s);
  }
  function setQuote(key,values){
   const s=current(),c=draft.find(c=>c.key===key);if(!s||!c){refresh();return false}
   const old=quote(c,s),q={...old};
   if(optimized&&Object.hasOwn(values||{},'line')&&String(values.line)!==String(old.line)){message='Add the revised line as a book option above, then compare again to rerank the ticket.';updateResults();return false}
   for(const field of ['line','odds'])if(Object.hasOwn(values||{},field))q[field]=typeof values[field]==='string'||typeof values[field]==='number'?String(values[field]):'';
   quotes.set(key,q);
   if(optimized&&q.odds!==old.odds){const offer=offers.find(o=>o.id===c.offerId);if(offer)offer.odds=q.odds;}
   for(const node of host.querySelectorAll?.('[data-parlay-line],[data-parlay-odds]')||[]){const value=node.dataset.parlayLine===key?q.line:node.dataset.parlayOdds===key?q.odds:null;if(value!==null&&node.value!==value)node.value=value}
   if(q.line!==old.line){cancel();simulation=null}
   if(q.line!==old.line||q.odds!==old.odds){combinedOdds='';const input=host.querySelector?.('[data-parlay-combined]');if(input)input.value=''}
   updateResults();return true;
  }
  function simulate(){
   const s=current();if(!s||draft.length!==count){message='Generate a complete, current draft before simulating.';render();return Promise.resolve(null)}
   const checked=draft.map(c=>({c,r:review(c,s),q:quote(c,s)}));
   if(checked.some(x=>x.r.status!=='ready')){message='Enter a valid book OVER line and American odds for every leg.';render();return Promise.resolve(null)}
   cancel();simulation=null;const runToken=token,runFingerprint=fingerprint(s),groups=new Map();
   for(const x of checked){const id=gameId(x.c);if(!groups.has(id))groups.set(id,{gameId:id,fixture:x.c.fixture,legs:[]});groups.get(id).legs.push({id:playerId(x.c),market:x.c.market,line:x.r.line,side:'over'})}
   const queue=[...groups.values()],results=[];
   let resolve;const promise=new Promise(r=>{resolve=r});running={active:new Set(),resolve,fingerprint:runFingerprint};const task=running;
   message='Running exact book lines in the shared game model.';render();
   function stop(reason){if(running!==task)return;cancel();message=reason;render()}
   function pump(){
    if(destroyed||token!==runToken||running!==task)return;
    while(task.active.size<2&&queue.length){
     const group=queue.shift();let worker;
     try{worker=options.workerFactory()}catch{stop('Simulation unavailable. Try again with current data.');return}
     const job={worker,timer:null};task.active.add(job);
     job.timer=setTimer(()=>stop('Ticket simulation timed out. Try again.'),45000);
     worker.onmessage=event=>{
      if(running!==task||token!==runToken)return;
      worker.terminate();clearTimer(job.timer);task.active.delete(job);
      const result=event.data?.result,p=result?.parlay;
      if(event.data?.requestId!==runToken||!p||p.legs!==group.legs.length||p.count!==10000||result.count!==10000){stop('Ticket simulation unavailable; no partial ticket percentage is shown.');return}
      results.push({gameId:group.gameId,parlay:p});pump();
     };
     worker.onerror=()=>stop('Ticket simulation failed; no partial ticket percentage is shown.');
     const players=s.records.filter(p=>p.market==='ATD'&&((p.team===group.fixture.home&&p.opp===group.fixture.away)||(p.team===group.fixture.away&&p.opp===group.fixture.home)));
     try{worker.postMessage({players,count:10000,seed:982451653,selected:[],options:{parlayLegs:group.legs},requestId:runToken})}
     catch{stop('Ticket simulation unavailable.');return}
    }
    if(!queue.length&&!task.active.size){
     const fresh=current();if(!fresh){stop('The board changed. Generate a fresh ticket.');return}
     if(fingerprint(fresh)!==runFingerprint){stop('A book line changed. Simulate the updated ticket.');return}
     const rates=parlay.combine(results,{});
     if(rates.status!=='ready'){stop('Ticket simulation returned incomplete outcomes.');return}
     running=null;simulation={groups:results,rates,fingerprint:runFingerprint};message='Ticket simulation complete. Review the book’s full-ticket price.';render();resolve(rates);
    }
   }
   pump();return promise;
  }
  function addResearch(){
   const s=current();
   if(!s||!draft.length||optimized){message='Explore current unpriced research targets first.';render();return false}
   const distinct=new Set(draft.map(c=>playerId(c)));
   if(distinct.size!==draft.length){message='Duplicate players in research draft; no picks saved.';render();return false}
   for(const c of draft){
    const line=Number(c.line);
    if(!Number.isSafeInteger(line)||line<0){message='An unsupported research target was found; no picks saved.';render();return false}
   }
   for(const c of draft){
    options.quickSlip.add({sport:'NFL',game:c.fixture.away+' @ '+c.fixture.home,gameId:gameId(c),
     player:c.p.player,playerId:playerId(c),team:c.p.team,opponent:c.p.opp,market:c.d.label,marketKey:c.market,
     side:'at_least',recommendationLine:Number(c.line),line:Number(c.line),recommendation:c.line+'+ '+c.d.label,
     researchScore:c.researchScore,scenarioRate:c.scenarioRate,researchMethod:'nfl-unpriced-research-target',
     notes:'Unpriced research target only. Verify availability, current injury status, sportsbook line and odds before betting.'});
   }
   message='Added all '+draft.length+' suggested research picks to Quick Slip. Existing picks kept. No sportsbook prices were assumed.';render();return true;
  }
  function add(){
   const s=current();if(!s||!simulation||simulation.fingerprint!==fingerprint(s)||draft.length!==count){message='Simulate the complete current ticket before saving its book legs.';render();return false}
   const checked=draft.map(c=>({c,q:quote(c,s),r:review(c,s)}));
   if(checked.some(x=>x.r.status!=='ready')){message='Every saved leg needs its actual book line and price.';render();return false}
   for(const {c,q,r}of checked)options.quickSlip.add({sport:'NFL',game:c.fixture.away+' @ '+c.fixture.home,gameId:gameId(c),
    player:c.p.player,playerId:playerId(c),team:c.p.team,opponent:c.p.opp,market:c.d.label,marketKey:c.market,
    side:'over',recommendationLine:r.line,line:r.line,recommendation:'OVER '+r.line+' '+c.d.label,
    researchScore:c.researchScore,scenarioRate:r.winRate,americanOdds:r.american,overOdds:r.american,
    ...(optimized?{researchMethod:'nfl-offered-parlay',linePolicy:'nfl-offered-lines-v1',selectionReason:c.selectionReason,simulationModel:offeredOutcomes.get(gameId(c))?.modelVersion,simulationCount:offeredOutcomes.get(gameId(c))?.count}:{}),
    notes:'User-entered book OVER '+q.line+' at '+(r.american>0?'+':'')+r.american+'. Parlay model is uncalibrated; book acceptance and reduced-ticket rules remain unverified.'});
   message='Added '+checked.length+' exact book legs to Quick Slip. Existing selections were retained.';render();return true;
  }
  function change(event){
   const data=event.target.dataset;
   if(Object.hasOwn(data,'parlayOfferPlayer'))offerChoice=event.target.value;
   if(Object.hasOwn(data,'parlayCount')){count=Number(event.target.value);draft=[];cancel();simulation=null;render()}
   if(Object.hasOwn(data,'parlayMode')){mode=event.target.value;draft=[];cancel();simulation=null;render()}
   if(Object.hasOwn(data,'parlayGame')){game=event.target.value;draft=[];cancel();simulation=null;render()}
  }
  function input(event){
   const data=event.target.dataset;
   if(Object.hasOwn(data,'parlayOfferLine'))offerLine=event.target.value;
   if(Object.hasOwn(data,'parlayOfferOdds'))offerOdds=event.target.value;
   if(data.parlayLine)setQuote(data.parlayLine,{line:event.target.value});
   if(data.parlayOdds)setQuote(data.parlayOdds,{odds:event.target.value});
   if(Object.hasOwn(data,'parlayCombined')){combinedOdds=event.target.value;updateResults()}
   if(Object.hasOwn(data,'parlayStake')){stake=event.target.value;updateResults()}
  }
  function click(event){
   const button=event.target.closest?.('button');if(!button)return;
   if(Object.hasOwn(button.dataset,'parlayGenerate'))generate();
   if(Object.hasOwn(button.dataset,'parlayOfferAdd'))addOffer(offerChoice,{line:offerLine,odds:offerOdds});
   if(button.dataset.parlayOfferRemove)removeOffer(button.dataset.parlayOfferRemove);
   if(Object.hasOwn(button.dataset,'parlayOfferImport')){const s=state();for(const [key,q]of Object.entries(s.quotes||{}))if(String(q.line??'').trim()&&String(q.odds??'').trim())addOffer(key,q)}
   if(Object.hasOwn(button.dataset,'parlayOptimize'))optimize();
   if(button.dataset.parlayReplace)generate(button.dataset.parlayReplace);
   if(Object.hasOwn(button.dataset,'parlaySimulate'))simulate();
   if(Object.hasOwn(button.dataset,'parlayAddResearch'))addResearch();
   if(Object.hasOwn(button.dataset,'parlayAdd'))add();
  }
  host.addEventListener('click',click);host.addEventListener('change',change);host.addEventListener('input',input);refresh();
  return {refresh,generate,setQuote,simulate,add,addOffer,removeOffer,optimize,getOffers:()=>offers.map(o=>({...o})),getDraft:()=>draft.map(c=>({...c})),destroy(){destroyed=true;cancel();host.removeEventListener('click',click);host.removeEventListener('change',change);host.removeEventListener('input',input)}};
 }
 return {create};
});
