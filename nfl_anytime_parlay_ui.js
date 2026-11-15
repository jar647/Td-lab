/* Five highest-ranked anytime TD research picks. No invented TD probabilities. */
(function(root,factory){
 const common=typeof module==='object'&&module.exports;
 const api=factory(common?require('./nfl_parlay.js'):root.PropShopNFLParlay,common?require('./market_odds.js'):root.CookItUpPricing);
 if(common)module.exports=api;root.PropShopNFLAnytimeParlayUI=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(parlay,pricing){
 'use strict';
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const gameId=c=>String(c.fixture?.game_id??c.fixture?.id??'');
 const fingerprint=rows=>JSON.stringify(rows.map(c=>[c.key,c.researchScore,c.score,gameId(c),c.fixture?.kickoff_at,c.p.availability,c.p.injuryReportStatus,c.p.injuryPracticeStatus]));
 function create(options){
  const host=options.root,now=options.now||Date.now,odds=new Map();
  let signature=null,lastReady=null,draft=[],draftFingerprint='',message='',combinedOdds='',stake='10',destroyed=false;
  const state=()=>options.getState();
  const ready=s=>s.tdReady===undefined?s.ready===true:s.tdReady===true;
  const selection=s=>ready(s)?parlay.generateAnytime(s.candidates,{now:now()}):{legs:[],requested:5,shortfall:5,reason:s.reason||'Current TD rankings are unavailable.'};
  function current(){
   const s=state();if(!ready(s)||s.signature!==signature||!draft.length)return null;
   const rows=selection(s).legs;
   return fingerprint(rows)===draftFingerprint?{state:s,rows}:null;
  }
  function payoutHTML(){
   if(draft.length!==5)return 'Five current qualifying scorers are required before reviewing a five-leg payout.';
   const quote=String(combinedOdds).trim()?pricing.quote(combinedOdds):null;
   if(String(combinedOdds).trim()&&!quote)return 'Enter valid combined American odds, such as +1200.';
   if(!quote)return 'Enter your book’s actual combined odds to review the payout. Individual odds are not multiplied.';
   const amount=Number(stake);
   if(!String(stake).trim()||!Number.isFinite(amount)||amount<=0||amount>100000)return 'Enter a stake greater than $0 and no more than $100,000.';
   return '<strong>Book’s combined price: '+esc(quote.american>0?'+'+quote.american:quote.american)+'</strong><br>$'+amount.toFixed(2)+' stake returns $'+(amount*quote.decimal).toFixed(2)+' on a full win ($'+(amount*(quote.decimal-1)).toFixed(2)+' profit).';
  }
  function render(){
   if(destroyed)return;
   const s=state();
   host.innerHTML='<p class="muted">Five distinct scorers with the highest eligible anytime-TD matchup scores. Scores rank matchup quality; they are not touchdown probabilities.</p>'+
    '<p class="pill">5 ANYTIME TD LEGS</p><button type="button" class="primary" data-td-parlay-generate'+(!ready(s)?' disabled':'')+'>Generate best 5 anytime TD scorers</button>'+
    '<p class="statsline" data-td-parlay-status role="status">'+esc(message||(!ready(s)?s.reason||'Loading current TD rankings…':'Uses the same score order as the Anytime TD board.'))+'</p>'+
    '<div data-td-parlay-legs>'+draft.map((c,i)=>{
     const q=odds.get(c.key)||'',questionable=[c.p.availability,c.p.injuryReportStatus].some(v=>String(v).toUpperCase()==='QUESTIONABLE');
     const practice=String(c.p.injuryPracticeStatus||'').toUpperCase();
     return '<section class="nfl-parlay-leg" data-td-parlay-key="'+esc(c.key)+'"><div class="row"><strong>Leg '+(i+1)+' · '+esc(c.p.player)+'</strong><span class="pill">'+c.researchScore+'/100</span></div>'+
      '<p class="statsline">'+esc(c.fixture.away+' @ '+c.fixture.home)+' · '+esc(c.p.pos)+'</p><p class="statsline"><strong>Anytime rushing / receiving TD</strong></p>'+
      (questionable?'<p class="notice">QUESTIONABLE · confirm the official active list.</p>':'')+
      (/DNP|LIMITED/.test(practice)?'<p class="notice">Practice report: '+esc(practice.replace('_PRACTICE',''))+'. Game-day status requires confirmation.</p>':'')+
      '<label>Book American odds · optional<input type="text" data-td-parlay-odds="'+esc(c.key)+'" value="'+esc(q)+'" placeholder="+150 or -110" aria-label="Anytime TD odds for '+esc(c.p.player)+'"></label></section>';
    }).join('')+'</div>'+
    (draft.length?'<label>Book’s combined American odds<input type="text" data-td-parlay-combined value="'+esc(combinedOdds)+'" placeholder="Enter the book’s five-leg price" aria-label="Combined anytime TD parlay odds"></label>'+
     '<label>Stake ($)<input type="number" min="0.01" max="100000" step="0.01" data-td-parlay-stake value="'+esc(stake)+'" aria-label="Anytime TD parlay stake"></label>'+
     '<div class="statsline" data-td-parlay-result aria-live="polite">'+payoutHTML()+'</div>'+
     '<p class="muted">A combined TD hit percentage is unavailable because the current simulator does not model touchdowns. Confirm game-day actives and the book’s parlay rules.</p>'+
     '<button type="button" class="smallbtn" data-td-parlay-add'+(draft.length!==5?' disabled':'')+'>Add 5 anytime TD legs to Quick Slip</button>':'');
  }
  function refresh(){
   const s=state(),changed=s.signature!==signature;
   const invalid=draft.length&&(!ready(s)||fingerprint(selection(s).legs)!==draftFingerprint);
   if(changed||invalid){const hadDraft=draft.length;draft=[];draftFingerprint='';odds.clear();combinedOdds='';signature=s.signature;message=hadDraft?'The TD board changed. Generate the current top five.':'';render()}
   else if(lastReady!==ready(s))render();
   lastReady=ready(s);
  }
  function generate(){
   refresh();const s=state(),result=selection(s);
   if(!ready(s)){message=result.reason;render();return []}
   draft=result.legs;draftFingerprint=fingerprint(draft);combinedOdds='';
   message=result.shortfall?result.reason:'Top five ready. Check active status and your book’s prices.';render();return draft;
  }
  function update(){
   if(!current()){refresh();return}
   const result=host.querySelector?.('[data-td-parlay-result]');
   if(result)result.innerHTML=payoutHTML();else render();
  }
  function setOdds(key,value){
   if(!current()||!draft.some(c=>c.key===key)){refresh();return false}
   const entered=typeof value==='string'||typeof value==='number'?String(value):'';
   const changed=(odds.get(key)||'')!==entered;odds.set(key,entered);
   const input=Array.from(host.querySelectorAll?.('[data-td-parlay-odds]')||[]).find(n=>n.dataset.tdParlayOdds===key);if(input&&input.value!==entered)input.value=entered;
   if(changed){combinedOdds='';const combined=host.querySelector?.('[data-td-parlay-combined]');if(combined)combined.value=''}
   update();return true;
  }
  function add(){
   const fresh=current();
   if(!fresh||fresh.rows.length!==5){refresh();message='Five current qualifying TD scorers are required. Generate the latest draft.';render();return false}
   const checked=fresh.rows.map(c=>({c,raw:odds.get(c.key)||'',price:pricing.quote(odds.get(c.key))}));
   if(checked.some(row=>row.raw.trim()&&!row.price)||String(combinedOdds).trim()&&!pricing.quote(combinedOdds)){message='Check the entered American odds before saving.';render();return false}
   const combined=pricing.quote(combinedOdds);
   for(const {c,price}of checked)options.quickSlip.add({sport:'NFL',game:c.fixture.away+' @ '+c.fixture.home,gameId:gameId(c),
    player:c.p.player,playerId:String(c.p.player_id),team:c.p.team,opponent:c.p.opp,market:c.d.label,marketKey:'anytime_td',
    side:'winner',line:null,recommendationLine:null,recommendation:'Anytime rushing / receiving TD',researchScore:c.researchScore,scenarioRate:null,
    ...(price?{americanOdds:price.american}:{}),...(combined?{parlayCombinedOdds:combined.american}:{}),parlayType:'anytime_td_top5',parlaySize:5,
    notes:'Top-five anytime TD matchup ranking. Game-day status and book acceptance require confirmation. No simulated TD probability is supplied.'});
   message='Added 5 anytime TD legs to Quick Slip. Existing selections were retained.';render();return true;
  }
  function input(event){
   const data=event.target.dataset;
   if(data.tdParlayOdds)setOdds(data.tdParlayOdds,event.target.value);
   if(Object.hasOwn(data,'tdParlayCombined')){combinedOdds=event.target.value;update()}
   if(Object.hasOwn(data,'tdParlayStake')){stake=event.target.value;update()}
  }
  function click(event){const button=event.target.closest?.('button');if(!button)return;if(Object.hasOwn(button.dataset,'tdParlayGenerate'))generate();if(Object.hasOwn(button.dataset,'tdParlayAdd'))add()}
  host.addEventListener('click',click);host.addEventListener('input',input);refresh();
  return {refresh,generate,setOdds,add,getDraft:()=>draft.map(c=>({...c})),destroy(){destroyed=true;host.removeEventListener('click',click);host.removeEventListener('input',input)}};
 }
 return {create};
});
