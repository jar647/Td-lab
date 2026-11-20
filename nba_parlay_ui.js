/* NBA research tickets: supported players, shared outcomes, and exact book lines. */
(function(root,factory){
 const common=typeof module==='object'&&module.exports;
 const api=factory(common?require('./nba_parlay.js'):root.PropShopNBAParlay,common?require('./market_odds.js'):root.CookItUpPricing);
 if(common)module.exports=api;root.PropShopNBAParlayUI=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(parlay,pricing){
 'use strict';
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const percent=value=>Number.isFinite(value)?(100*value).toFixed(1)+'%':'unavailable';
 const labels={points:'points',rebounds:'rebounds',assists:'assists',threes:'three-pointers',pr:'points + rebounds',pa:'points + assists',ra:'rebounds + assists',pra:'points + rebounds + assists'};
 const label=c=>labels[String(c.market||'').toLowerCase()]||String(c.market||'player prop');
 const fixture=c=>c.game||c.fixture||{};
 const gameId=c=>String(c.gameId??fixture(c).id??fixture(c).game_id??'');
 const playerId=c=>String(c.playerId??c.player_id??'');
 const name=c=>String(c.name??c.player??'Player');
 const score=c=>Number.isFinite(c.score)?c.score:c.researchScore;
 const gameLabel=c=>String(fixture(c).away||'Away')+' @ '+String(fixture(c).home||'Home');
 const sourceTime=c=>fixture(c).date||fixture(c).kickoff_at;
 const numberLine=raw=>{
  if(raw===null||raw===undefined||String(raw).trim()==='')return null;
  const value=Number(raw);return Number.isFinite(value)&&value>=.5&&value<=400&&Number.isInteger(value*2)?value:null;
 };
 const hash=values=>{let h=2166136261;for(const value of values||[]){const text=String(value)+'|';for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)}}return (h>>>0).toString(16)};
 const fingerprint=c=>JSON.stringify([c.key,playerId(c),name(c),gameId(c),fixture(c).id,fixture(c).home,fixture(c).away,sourceTime(c),fixture(c).status,c.team,c.opponent,
  c.market,c.side,c.line,score(c),c.matchupRating?.score,c.eligible,c.status,c.parlayEligible,c.reviewRequired,c.outcomeSetId,c.inputTimes,c.roleEvidence,c.linePolicy,c.availabilitySensitivity,
  c.selectedLineEvidence,Array.isArray(c.samples)?c.samples.length:null,hash(c.samples)]);
 const poolSignature=payload=>JSON.stringify([payload.signature??null,payload.candidates.map(c=>[String(c.key||''),fingerprint(c)]).sort((a,b)=>a[0].localeCompare(b[0]))]);
 const complete=result=>result?.available===true&&result.status!=='PASS'&&Number.isFinite(result.jointFrequency);

 function create(options){
  const host=options.root,now=options.now||Date.now;
  let count=3,mode='cross_game',game='',pool=[],signature=null,draft=[],selection=null,message='',combinedOdds='',stake='10';
  let destroyed=false,pending=false,operation=0,edits=0;
  const quotes=new Map();
  const quote=c=>quotes.get(c.key)||{line:'',odds:''};
  const games=()=>[...new Map(pool.map(c=>[gameId(c),{id:gameId(c),label:gameLabel(c),date:sourceTime(c)}])).values()].filter(g=>g.id&&Date.parse(g.date)>now()).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date)||a.id.localeCompare(b.id));
  function clearDraft(reason=''){
   draft=[];selection=null;quotes.clear();combinedOdds='';edits++;if(reason)message=reason;
  }
  function checkedLegs(){
   if(draft.length!==count)return null;
   const rows=draft.map(c=>({c,q:quote(c),line:numberLine(quote(c).line)}));
   if(rows.some(row=>row.line===null))return null;
   return rows.map(row=>({...row.c,line:row.line}));
  }
  function evaluation(){const legs=checkedLegs();return legs?parlay.evaluate(legs,{now:now()}):null}
  function legRate(c){
   const line=numberLine(quote(c).line);if(line===null)return null;
   const result=parlay.evaluateLeg({...c,line},{now:now()});
   return result?.available===true&&Number.isFinite(result.winFrequency)?{win:result.winFrequency,push:result.pushFrequency||0}:null;
  }
  const validPrices=()=>!draft.some(c=>String(quote(c).odds).trim()&&!pricing.quote(quote(c).odds))&&(!String(combinedOdds).trim()||!!pricing.quote(combinedOdds));
  function resultHTML(){
   if(draft.length!==count)return 'A complete '+count+'-leg supported draft is required. No filler legs are added.';
   const exact=evaluation(),allEntered=checkedLegs()!==null;
   if(allEntered&&!complete(exact))return esc(exact?.reason||'The exact book lines cannot be evaluated with current evidence. Regenerate the draft.');
   const rates=allEntered?exact:parlay.evaluate(draft,{now:now()});
   if(!complete(rates))return 'Current shared-outcome evaluation is unavailable. Generate a fresh draft.';
   let html='<strong>'+(allEntered?'Exact book lines':'Unverified research targets')+' · all legs win: '+percent(rates.jointFrequency)+' simulated</strong>'+
    '<p class="muted">'+(rates.independentGames?'Separate games are assumed independent. Any same-game outcomes are counted together.':'The legs are counted together in the same simulated games; individual hit rates are not multiplied.')+' Uncalibrated model frequency, not a verified win probability.</p>';
   if(allEntered&&Number(rates.pushFrequency)>0)html+='<p class="muted">No losing leg with at least one push: '+percent(rates.pushFrequency)+'. The book’s reduced-ticket and void rules determine settlement.</p>';
   if(!allEntered)return html+'<p>Enter each exact OVER line your book offers before saving or reviewing its full-ticket payout. Default alternate lines are unverified book offerings.</p>';
   html+='<p class="muted">These exact lines are evaluated for the selected players. Editing a line does not rerank the board.</p>';
   const raw=String(combinedOdds).trim(),price=raw?pricing.quote(raw):null;
   if(raw&&!price)return html+'<p>Enter valid combined American odds, such as +500.</p>';
   if(!price)return html+'<p>Enter the book’s actual combined price to review the payout. Individual odds are not multiplied.</p>';
   const amount=Number(stake);
   if(!String(stake).trim()||!Number.isFinite(amount)||amount<=0||amount>100000)return html+'<p>Enter a stake greater than $0 and no more than $100,000.</p>';
   html+='<p><strong>Book’s combined price: '+esc(price.american>0?'+'+price.american:price.american)+'</strong><br>$'+amount.toFixed(2)+' stake returns $'+(amount*price.decimal).toFixed(2)+' on a full win ($'+(amount*(price.decimal-1)).toFixed(2)+' profit).</p>';
   if(!Number(rates.pushFrequency))html+='<p class="muted">The quoted price requires '+percent(price.implied)+' wins when there are no pushes. This price requirement does not establish a betting edge.</p>';
   return html;
  }
  function legReviewHTML(c){
   const q=quote(c),entered=String(q.line).trim()!=='';
   if(!entered)return 'Book offering unverified. Enter the actual strict OVER line; 10+ corresponds to OVER 9.5.';
   if(numberLine(q.line)===null)return 'Enter a valid whole or half-point OVER line of at least 0.5.';
   if(String(q.odds).trim()&&!pricing.quote(q.odds))return 'Enter valid American odds, such as -110 or +150, or leave the price blank.';
   const rate=legRate(c);
   return rate?'Book OVER '+esc(q.line)+': '+percent(rate.win)+' simulated wins'+(rate.push?' · '+percent(rate.push)+' pushes':'')+'. Uncalibrated.':'This line has no supported current outcome sample.';
  }
  function render(){
   if(destroyed)return;
   const fixtures=games();
   if(!fixtures.some(g=>g.id===game))game=fixtures[0]?.id||'';
   host.innerHTML='<p class="muted">Build an OVER-only research ticket from supported 75/100+ matchups (three-pointers 85/100+). Selection considers minutes stability, distinct players and joint outcomes, rather than simply taking the highest scores.</p>'+
    '<div class="sim-grid"><div class="sim-field"><label>Legs<select data-nba-parlay-count aria-label="NBA parlay leg count">'+[2,3,4].map(n=>'<option value="'+n+'"'+(n===count?' selected':'')+'>'+n+' legs</option>').join('')+'</select></label></div>'+
    '<div class="sim-field"><label>Ticket type<select data-nba-parlay-mode aria-label="NBA parlay ticket type"><option value="cross_game"'+(mode==='cross_game'?' selected':'')+'>Different games</option><option value="sgp"'+(mode==='sgp'?' selected':'')+'>Same game</option></select></label></div></div>'+
    (mode==='sgp'?'<label>Matchup<select data-nba-parlay-game aria-label="NBA parlay matchup">'+(fixtures.length?fixtures.map(g=>'<option value="'+esc(g.id)+'"'+(g.id===game?' selected':'')+'>'+esc(g.label)+'</option>').join(''):'<option value="">Load current matchups with Generate</option>')+'</select></label>':'')+
    '<button type="button" data-nba-parlay-generate'+(pending?' disabled':'')+'>Generate '+count+'-leg NBA draft</button>'+
    '<p class="muted" data-nba-parlay-status role="status">'+esc(message||'Distinct players, supported minutes and no filler legs.')+'</p>'+
    '<div data-nba-parlay-legs>'+draft.map((c,index)=>{
     const q=quote(c),role=c.roleEvidence||{},range=Number.isFinite(role.minutesLow)&&Number.isFinite(role.minutesHigh)?role.minutesLow.toFixed(1)+'–'+role.minutesHigh.toFixed(1):'unavailable';
     return '<section class="player nba-parlay-leg" data-nba-parlay-key="'+esc(c.key)+'"><strong>Leg '+(index+1)+' · '+esc(name(c))+' · '+esc(score(c))+'/100</strong>'+
      '<p class="muted">'+esc(gameLabel(c))+' · '+esc(label(c))+' · supported minutes '+esc(range)+'.</p>'+
      '<p>Research target: <strong>OVER '+esc(c.line)+' '+esc(label(c))+'</strong><br><span class="muted">Book availability unverified. '+esc(c.parlayReason||'Supported matchup quality, stable minutes and distinct player exposure.')+'</span></p>'+
      '<div class="sim-grid"><div class="sim-field"><label>Actual book OVER line<input type="number" min="0.5" max="400" step="0.5" inputmode="decimal" data-nba-parlay-line="'+esc(c.key)+'" value="'+esc(q.line)+'" aria-label="NBA parlay book OVER line for '+esc(name(c))+'" placeholder="Enter the book’s line"></label></div>'+
      '<div class="sim-field"><label>American odds · optional<input type="text" data-nba-parlay-odds="'+esc(c.key)+'" value="'+esc(q.odds)+'" aria-label="NBA parlay odds for '+esc(name(c))+'" placeholder="-110 or +150"></label></div></div>'+
      '<p class="muted" data-nba-parlay-review="'+esc(c.key)+'">'+legReviewHTML(c)+'</p></section>';
    }).join('')+'</div>'+
    (draft.length?'<div class="sim-grid"><div class="sim-field"><label>Book’s combined American odds<input type="text" data-nba-parlay-combined value="'+esc(combinedOdds)+'" aria-label="Combined NBA parlay odds" placeholder="Actual full-ticket price"></label></div>'+
     '<div class="sim-field"><label>Stake ($)<input type="number" min="0.01" max="100000" step="0.01" data-nba-parlay-stake value="'+esc(stake)+'" aria-label="NBA parlay stake"></label></div></div>'+
     '<div data-nba-parlay-result aria-live="polite">'+resultHTML()+'</div><button type="button" data-nba-parlay-add'+(pending||!complete(evaluation())||!validPrices()?' disabled':'')+'>Add exact book legs to Quick Slip</button>':'')+
    (draft.length?'<details><summary>Simulation assumptions and research limits</summary>'+(draft.some(c=>c.availabilitySensitivity)?'<p class="muted">Questionable teammate outcomes are sensitivity scenarios, not estimates of participation probability.</p>':'')+(Array.isArray(selection?.limits)?selection.limits.filter(text=>typeof text==='string').map(text=>'<p class="muted">'+esc(text)+'</p>').join(''):'')+'</details>':'')+
    '<p class="muted">This is a research draft, not a placed bet. Verify injuries, exact book lines and parlay rules. Adding a price does not change matchup scores or simulated outcomes.</p>';
  }
  function update(){
   if(destroyed)return;
   for(const node of host.querySelectorAll?.('[data-nba-parlay-review]')||[]){const c=draft.find(row=>row.key===node.dataset.nbaParlayReview);if(c)node.innerHTML=legReviewHTML(c)}
   const target=host.querySelector?.('[data-nba-parlay-result]');if(target)target.innerHTML=resultHTML();
   const status=host.querySelector?.('[data-nba-parlay-status]');if(status)status.textContent=message;
   const add=host.querySelector?.('[data-nba-parlay-add]');if(add)add.disabled=pending||!complete(evaluation())||!validPrices();
  }
  async function load(){
   const value=await options.getCandidates();
   const payload=Array.isArray(value)?{candidates:value}:value&&typeof value==='object'?value:{};
   return {...payload,candidates:payload.ready===false?[]:Array.isArray(payload.candidates)?payload.candidates:[]};
  }
  function applyPool(payload){
   const next=poolSignature(payload),changed=next!==signature;
   if(changed&&draft.length)clearDraft('The NBA board or source evidence changed. Generate a fresh draft and recheck the book’s lines.');
   pool=payload.candidates;signature=next;
   return changed;
  }
  async function refresh(){
   if(destroyed)return false;
   const id=++operation;pending=true;update();
   try{
    const payload=await load();if(destroyed||id!==operation)return false;
    const changed=applyPool(payload);
    if(draft.length&&!complete(parlay.evaluate(draft,{now:now()})))clearDraft('Current NBA eligibility or kickoff changed. Generate a fresh draft.');
    pending=false;if(changed||!draft.length){if(!pool.length&&!draft.length)message=payload.reason||'No supported NBA matchups are currently available.';render()}else update();
    return true;
   }catch(_){if(destroyed||id!==operation)return false;pending=false;clearDraft('Current NBA research could not be refreshed. Try again when source data is available.');render();return false}
  }
  async function generate(){
   if(destroyed)return [];
   const id=++operation;pending=true;clearDraft();message='Checking current NBA matchups and shared game outcomes…';render();
   try{
    const payload=await load();if(destroyed||id!==operation)return [];
    applyPool(payload);if(payload.ready===false){pending=false;selection=null;message=payload.reason||'Fresh game, injury and roster sources are required before generating an NBA draft.';render();return []}
    const fixtures=games();if(!fixtures.some(g=>g.id===game))game=fixtures[0]?.id||'';
    selection=parlay.generate(pool,{count,mode,gameId:mode==='sgp'?game:undefined,now:now()});
    draft=Array.isArray(selection?.legs)?selection.legs.map(c=>({...c})):[];pending=false;edits++;
    message=draft.length!==count||!complete(selection)?selection?.reason||payload.reason||'A complete supported NBA ticket is unavailable. No filler legs were added.':'Draft ready. Enter the exact lines your book actually offers.';render();return draft;
   }catch(_){if(destroyed||id!==operation)return [];pending=false;clearDraft('Current NBA research could not be loaded. No ticket was generated.');render();return []}
  }
  function setQuote(key,values){
   if(destroyed||!draft.some(c=>c.key===key))return false;
   const old=quotes.get(key)||{line:'',odds:''},next={...old};
   for(const field of ['line','odds'])if(Object.hasOwn(values||{},field))next[field]=typeof values[field]==='string'||typeof values[field]==='number'?String(values[field]):'';
   quotes.set(key,next);
   for(const input of host.querySelectorAll?.('[data-nba-parlay-line],[data-nba-parlay-odds]')||[]){const value=input.dataset.nbaParlayLine===key?next.line:input.dataset.nbaParlayOdds===key?next.odds:null;if(value!==null&&input.value!==value)input.value=value}
   if(old.line!==next.line||old.odds!==next.odds){edits++;combinedOdds='';const input=host.querySelector?.('[data-nba-parlay-combined]');if(input)input.value=''}
   message='';update();return true;
  }
  function setCombined(value){if(destroyed)return false;combinedOdds=typeof value==='string'||typeof value==='number'?String(value):'';const node=host.querySelector?.('[data-nba-parlay-combined]');if(node&&node.value!==combinedOdds)node.value=combinedOdds;edits++;update();return true}
  function setStake(value){if(destroyed)return false;stake=typeof value==='string'||typeof value==='number'?String(value):'';const node=host.querySelector?.('[data-nba-parlay-stake]');if(node&&node.value!==stake)node.value=stake;update();return true}
  function configure(change){if(destroyed)return false;operation++;pending=false;clearDraft();change();message='Generate a draft using the updated ticket settings.';render();return true}
  function setCount(value){const n=Number(value);return [2,3,4].includes(n)?configure(()=>{count=n}):false}
  function setMode(value){return ['cross_game','sgp'].includes(value)?configure(()=>{mode=value}):false}
  function setGame(value){return configure(()=>{game=String(value||'')})}
  async function add(){
   if(destroyed||pending)return false;
   if(draft.length!==count||!checkedLegs()||!complete(evaluation())){message='Enter every actual book OVER line for a complete current draft before saving.';update();return false}
   if(draft.some(c=>String(quote(c).odds).trim()&&!pricing.quote(quote(c).odds))||String(combinedOdds).trim()&&!pricing.quote(combinedOdds)){message='Check the entered American odds before saving.';update();return false}
   const id=++operation,edit=edits,previousSignature=signature;pending=true;update();
   try{
    const payload=await load();if(destroyed||id!==operation)return false;
    if(poolSignature(payload)!==previousSignature){applyPool(payload);pending=false;message='The NBA board or source evidence changed. Generate a fresh draft and recheck book lines.';render();return false}
    if(edit!==edits){pending=false;message='The ticket changed during the source check. Review the updated lines and save again.';update();return false}
    const result=evaluation();if(!complete(result)||draft.length!==count){pending=false;message=result?.reason||'The current ticket is no longer supported. Generate a fresh draft.';update();return false}
    const combined=pricing.quote(combinedOdds),bookLegs=checkedLegs();
    const saved=bookLegs.map(c=>{
     const q=quote(c),price=pricing.quote(q.odds),rated=result.legs?.find(row=>row.key===c.key),rate=Number.isFinite(rated?.probability)?rated.probability:legRate(c)?.win;
     return {sport:'NBA',game:gameLabel(c),gameId:gameId(c),player:name(c),playerId:playerId(c),team:c.team,opponent:c.opponent,
      position:c.position||null,market:label(c),marketKey:c.market,side:'over',line:c.line,recommendationLine:c.line,recommendation:'OVER '+c.line+' '+label(c),
      researchMethod:'nba-parlay-research',researchScore:score(c),propScore:null,scenarioRate:Number.isFinite(rate)?rate:null,
      parlayJointFrequency:result.jointFrequency,parlaySize:count,parlayType:mode,lineOfferingConfirmed:true,
      sourceInputs:{...c.inputTimes},roleEvidence:{projectedMinutes:c.roleEvidence?.projectedMinutes,minutesLow:c.roleEvidence?.minutesLow,minutesHigh:c.roleEvidence?.minutesHigh,historyGames:c.roleEvidence?.historyGames},
      linePolicy:c.linePolicy?.policy||c.linePolicy||c.selectedLineEvidence?.policy||null,
      ...(price?{americanOdds:price.american,overOdds:price.american}:{}),...(combined?{parlayCombinedOdds:combined.american}:{}),
      notes:'Exact user-entered OVER line. Supported NBA matchup and role research; simulated frequencies are uncalibrated. '+(result.independentGames?'Separate games are assumed independent. ':'Same-game legs use shared simulated outcomes. ')+'Book acceptance, injuries and settlement rules require confirmation.'};
    });
    for(const pick of saved)options.quickSlip.add(pick);
    pending=false;message='Added '+saved.length+' exact NBA book legs to Quick Slip. Existing selections were retained.';update();return true;
   }catch(_){if(destroyed||id!==operation)return false;pending=false;clearDraft('Current NBA evidence could not be verified. Refresh and generate a new draft before saving.');render();return false}
  }
  function change(event){const d=event.target.dataset;if(Object.hasOwn(d,'nbaParlayCount'))setCount(event.target.value);if(Object.hasOwn(d,'nbaParlayMode'))setMode(event.target.value);if(Object.hasOwn(d,'nbaParlayGame'))setGame(event.target.value)}
  function input(event){const d=event.target.dataset;if(d.nbaParlayLine)setQuote(d.nbaParlayLine,{line:event.target.value});if(d.nbaParlayOdds)setQuote(d.nbaParlayOdds,{odds:event.target.value});if(Object.hasOwn(d,'nbaParlayCombined'))setCombined(event.target.value);if(Object.hasOwn(d,'nbaParlayStake'))setStake(event.target.value)}
  function click(event){const button=event.target.closest?.('button');if(!button)return;if(Object.hasOwn(button.dataset,'nbaParlayGenerate'))generate();if(Object.hasOwn(button.dataset,'nbaParlayAdd'))add()}
  host.addEventListener('click',click);host.addEventListener('change',change);host.addEventListener('input',input);render();
  return {generate,refresh,add,setQuote,setCombined,setStake,setCount,setMode,setGame,
   getDraft:()=>JSON.parse(JSON.stringify(draft)),getState:()=>({count,mode,game,pending,signature}),
   destroy(){destroyed=true;operation++;host.removeEventListener('click',click);host.removeEventListener('change',change);host.removeEventListener('input',input)}};
 }
 return {create};
});
