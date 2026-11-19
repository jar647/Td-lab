/* Exact saved-ticket diagnostics; uses existing NFL game workers, never marginal multiplication within games. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.PropShopSlipTicket=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const markets={passYards:'passYards',rushYards:'rushYards',recYards:'recYards',receptions:'receptions','passing yards':'passYards','rushing yards':'rushYards','receiving yards':'recYards'};
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const pct=x=>(100*x).toFixed(1)+'%';
 function prepare(picks,state,now,eligible){
  if(!state?.ready)throw Error(state?.reason||'Wait for current NFL research to finish.');
  if(!Array.isArray(picks)||picks.length<2||picks.length>10)throw Error('Save 2–10 NFL player props to check a ticket.');
  const pool=[...(state.offeredCandidates||[]),...(state.candidates||[])],seen=new Set();
  return picks.map(p=>{
   if(p.sport!=='NFL')throw Error('This checker supports NFL yardage and reception props. Mixed sports, TD and game-line tickets cannot receive a complete percentage.');
   const market=markets[p.marketKey]||markets[String(p.market).toLowerCase()],raw=p.recommendationLine??p.line;
   const line=typeof raw==='number'||typeof raw==='string'&&/^\d+(?:\.\d+)?$/.test(raw.trim())?Number(raw):NaN;
   const side=String(p.side||(/^\s*OVER\b/i.test(p.recommendation||'')?'over':Number.isInteger(line)?'at_least':'over')).toLowerCase();
   if(!market||!['over','at_least'].includes(side)||!Number.isFinite(line)||line<0||line>10000||!Number.isInteger(line*2))throw Error('Every saved leg needs a supported exact OVER or plus line.');
   const matches=pool.filter(c=>c.market===market&&(p.playerId?String(c.p.player_id)===String(p.playerId):c.p.player===p.player)&&c.p.team===p.team&&c.p.opp===p.opponent&&(!p.gameId||String(c.fixture?.game_id??c.fixture?.id)===String(p.gameId)));
   const unique=new Map(matches.map(c=>[String(c.fixture?.game_id??c.fixture?.id)+'|'+c.p.player_id,c]));
   if(unique.size!==1)throw Error('Cannot verify '+p.player+' against current research. Select All games and refresh; no partial ticket is shown.');
   const c=[...unique.values()][0],id=String(c.p.player_id),gameId=String(c.fixture.game_id??c.fixture.id);
   if(!eligible(c,now))throw Error(p.player+' needs current supported history and cleared injury screening before simulation.');
   if(seen.has(id))throw Error('Only one prop per player is supported in this ticket.');seen.add(id);
   return {pick:p,c,id,gameId,market,line,side};
  });
 }
 function analyze(legs,simulations){
  const rows=legs.map(l=>{const s=simulations.get(l.gameId),matches=s?.playerOutcomes?.filter(r=>r.id===l.id&&r.market===l.market),r=matches?.[0];
   if(!s?.outcomeSetId||!Number.isSafeInteger(s.count)||s.count<1000||matches.length!==1||r.outcomeSetId!==s.outcomeSetId||!Array.isArray(r.values)||r.values.length!==s.count)throw Error('Complete aligned outcomes are unavailable.');
   const win=[],nonLoss=[];for(const v of r.values){if(!Number.isSafeInteger(v)||v<0)throw Error('Invalid model outcomes.');win.push(l.side==='at_least'?v>=l.line:v>l.line);nonLoss.push(v>=l.line)}
   return {...l,win,nonLoss,count:s.count,batch:s.outcomeSetId};});
  function frequency(rs,nonLoss=false){const groups=new Map();for(const r of rs){if(!groups.has(r.gameId))groups.set(r.gameId,[]);groups.get(r.gameId).push(r)}let result=1;
   for(const group of groups.values()){const first=group[0];if(group.some(r=>r.count!==first.count||r.batch!==first.batch))throw Error('Incompatible simulation batches.');let hits=0;for(let i=0;i<first.count;i++)if(group.every(r=>(nonLoss?r.nonLoss:r.win)[i]))hits++;result*=hits/first.count}return result;}
  const allWin=frequency(rows),nonLoss=frequency(rows,true),correlations=[];
  for(let a=0;a<rows.length;a++)for(let b=a+1;b<rows.length;b++){const x=rows[a],y=rows[b];if(x.gameId!==y.gameId)continue;
   const px=frequency([x]),py=frequency([y]),joint=frequency([x,y]),den=Math.sqrt(px*(1-px)*py*(1-py));
   correlations.push({a:x.pick.player,b:y.pick.player,coefficient:den?(joint-px*py)/den:null,sharedPassing:x.c.p.team===y.c.p.team&&['passYards','recYards','receptions'].includes(x.market)&&['passYards','recYards','receptions'].includes(y.market)});}
  const diagnostics=rows.map((r,i)=>({player:r.pick.player,line:r.line,side:r.side,market:r.market,rate:frequency([r]),without:frequency(rows.filter((_,j)=>i!==j))})).sort((a,b)=>b.without-a.without);
  return {allWin,nonLoss,pushOnly:nonLoss-allWin,loss:1-nonLoss,legs:diagnostics,correlations,independentGames:new Set(rows.map(r=>r.gameId)).size>1};
 }
 function mount({host,slip,getState,workerFactory,eligible,pricing,now=Date.now}){
  let generation=0,active=[],result=null,stamp='',odds='',busy=false,expires=Infinity;
  host.innerHTML='<h3>Check this ticket · NFL</h3><p class="quick-slip-help">Checks every saved leg together. Supports 2–10 NFL yardage/reception props; no partial percentages.</p><label>Final ticket American odds<input data-ticket-odds inputmode="text" placeholder="e.g. +650"></label><button type="button" class="primary" data-ticket-run>Simulate saved ticket</button><div data-ticket-result role="status" aria-live="polite"></div>';
  const output=host.querySelector('[data-ticket-result]'),button=host.querySelector('[data-ticket-run]');
  const fingerprint=()=>JSON.stringify([slip.getPicks(),getState()?.signature,getState()?.ready]);
  function cancel(){generation++;for(const j of active){j.worker.terminate();clearTimeout(j.timer);j.reject?.(Error("Ticket check cancelled."))}active=[];busy=false;button.disabled=false;result=null;}
  function render(){if(!result)return;const q=pricing.quote(odds);
   output.innerHTML='<p><b>All legs win: '+pct(result.allWin)+' simulated</b><br>At least one losing leg: '+pct(result.loss)+(result.pushOnly?'<br>No losses, with at least one push: '+pct(result.pushOnly):'')+'</p>'+
    '<p>Uncalibrated model frequency · 10,000 runs per game. '+(result.independentGames?'Separate games assume independence. ':'')+'Same-game legs use shared outcomes.</p>'+
    (q?(result.pushOnly?'<p>Push paths prevent a full price comparison without reduced-ticket terms.</p>':'<p>Price requires '+pct(q.implied)+' wins. Model is '+Math.abs(100*(result.allWin-q.implied)).toFixed(1)+' percentage points '+(result.allWin>=q.implied?'above':'below')+' that requirement. This does not establish an edge.</p>'): '<p>Enter valid combined American odds to compare the price.</p>')+
    '<h4>Leg checks · largest removal impact first</h4>'+result.legs.map(l=>'<p><b>'+esc(l.player)+'</b> · '+esc(l.side==='over'?'OVER '+l.line:l.line+'+')+' '+esc(l.market)+'<br>Leg: '+pct(l.rate)+' simulated · Ticket without this leg: '+pct(l.without)+' simulated</p>').join('')+
    (result.allWin===0?'<p>No full wins occurred in this sample; that does not prove the ticket is impossible.</p>':'')+'<p>Removing a leg changes the sportsbook price. Revised odds are needed to compare that smaller ticket.</p><h4>Same-game checks</h4>'+(result.correlations.length?result.correlations.map(c=>'<p>'+esc(c.a)+' + '+esc(c.b)+': '+(c.coefficient===null?'correlation unavailable':'simulated correlation '+c.coefficient.toFixed(2))+(c.sharedPassing?' · shared passing opportunities; targets compete.':'.')+'</p>').join(''):'<p>No same-game pairs.</p>');
  }
  host.querySelector('[data-ticket-odds]').addEventListener('input',e=>{odds=e.target.value;if(result)render()});
  async function run(){cancel();const token=generation;stamp=fingerprint();let legs;try{legs=prepare(slip.getPicks(),getState(),now(),eligible)}catch(e){output.textContent=e.message;return}
   expires=Math.min(...legs.map(l=>Date.parse(l.c.fixture.kickoff_at)));
   busy=true;button.disabled=true;output.textContent='Simulating exact saved lines together and checking leg removal…';
   const state=getState(),groups=new Map(),simulations=new Map();for(const l of legs){if(!groups.has(l.gameId))groups.set(l.gameId,[]);groups.get(l.gameId).push(l)}
   try{for(const [id,group]of groups){const fixture=group[0].c.fixture,players=state.records.filter(p=>p.market==='ATD'&&((p.team===fixture.home&&p.opp===fixture.away)||(p.team===fixture.away&&p.opp===fixture.home)));
     const s=await new Promise((resolve,reject)=>{const worker=workerFactory(),job={worker,reject,timer:setTimeout(()=>{worker.terminate();reject(Error('Simulation timed out. Try again.'))},45000)};active.push(job);
      worker.onerror=()=>reject(Error('Ticket simulation failed.'));worker.onmessage=e=>{clearTimeout(job.timer);worker.terminate();active=active.filter(j=>j!==job);const r=e.data?.result;if(e.data?.requestId!==token||r?.count!==10000||r.seed!==982451653||!r.modelVersion)reject(Error('Invalid simulation response.'));else resolve(r)};
      worker.postMessage({players,count:10000,seed:982451653,selected:[],requestId:token,options:{collectPlayerOutcomes:group.map(l=>({id:l.id,market:l.market}))}});});
     if(token!==generation)return;simulations.set(id,s);}
    if(stamp!==fingerprint()||legs.some(l=>Date.parse(l.c.fixture.kickoff_at)<=now()))throw Error('The slip, research or kickoff status changed. Run a fresh check.');
    result=analyze(legs,simulations);render();
   }catch(e){if(token===generation){cancel();output.textContent=e.message+' No complete ticket percentage is available.'}}
   finally{if(token===generation){busy=false;button.disabled=false}}
  }
  button.addEventListener('click',run);
  const unsubscribe=slip.onChange(()=>{cancel();output.textContent='Slip changed. Simulate the updated ticket.'});
  const timer=setInterval(()=>{if((result||busy)&&(stamp!==fingerprint()||now()>=expires)){cancel();output.textContent='Research or kickoff status changed. Run a fresh ticket check.'}},1000);
  return {run,destroy(){cancel();clearInterval(timer);unsubscribe()}};
 }
 return {prepare,analyze,mount};
});
