/* Shared, optional book-line comparison for every current NBA OVER and UNDER research card.
   Uses only existing model draws; prices never change the recommendation score. */
(function(root,factory){
 const node=typeof module==='object'&&module.exports;
 const api=factory(node?require('./market_odds.js'):root.CookItUpPricing);
 if(node)module.exports=api;
 root.PropShopNBABookCompare=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(pricing){
 'use strict';
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const validLine=raw=>typeof raw==='string'&&raw.trim()!==''&&Number.isFinite(Number(raw))&&Number(raw)>=.5&&Number(raw)<=400&&Number.isInteger(Number(raw)*2);
 const pct=n=>(n*100).toFixed(1)+'%';
 function compare({line='',odds='',samples=[],projection=null,recommendedLine=null,side='over'}={}){
  const offered=String(line??'').trim(),entered=String(odds??'').trim(),direction=side==='under'?'UNDER':'OVER';
  if(!offered&&!entered)return {status:'awaiting',text:'Enter the sportsbook\'s '+direction+' line and American odds to compare the price. Both are optional for researching a play.'};
  if(!validLine(offered))return {status:'invalid',text:'Enter the exact sportsbook '+direction+' line in 0.5 increments (at least 0.5).'};
  const number=Number(offered),quote=pricing?.quote?.(entered);
  if(entered&&!quote)return {status:'invalid',text:'American odds must be -100 or lower, or +100 or higher, for example -110 or +150.'};
  const knownProjection=typeof projection==='number'&&Number.isFinite(projection)&&projection>=0;
  const validSamples=Array.isArray(samples)&&samples.length>=100&&samples.every(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0);
  const parts=['Book '+direction+' '+number+'.'];
  if(knownProjection){const gap=projection-number;parts.push('Model projection '+projection.toFixed(1)+' ('+(gap>=0?'+':'')+gap.toFixed(1)+' versus the book line).');}
  let win=null,push=null,loss=null;
  if(validSamples){
   const wins=samples.filter(x=>direction==='UNDER'?x<number:x>number).length,pushes=samples.filter(x=>x===number).length;
   win=wins/samples.length;push=pushes/samples.length;loss=1-win-push;
   parts.push(pct(win)+' simulated '+direction+' clears, '+pct(push)+' pushes, '+pct(loss)+' losses ('+samples.length+' model draws).');
  }else parts.push('A supported simulated outcome distribution is unavailable for this card. Projection-to-line comparison only.');
  if(quote){
   parts.push('Book '+(quote.american>0?'+':'')+quote.american+' requires '+pct(quote.implied)+' wins at zero pushes.');
   if(win!==null&&1-push>0)parts.push('Simulated wins among non-push outcomes: '+pct(win/(1-push))+'.');
  }else parts.push('Enter actual American odds to see the book break-even price.');
  if(typeof recommendedLine==='number'&&Number.isFinite(recommendedLine)&&recommendedLine!==number)parts.push('The original suggested '+direction+' '+recommendedLine+' is unchanged.');
  parts.push('These simulations are uncalibrated; this is not proof of positive EV or a verified betting edge. Book availability is not confirmed.');
  return {status:quote?'compared':'unpriced',text:parts.join(' '),win,push,loss,implied:quote?.implied??null};
 }
 function create({document}={}){
  const records=new Map();let seq=0;
  function render(row,{context='nba',expanded=false}={}){
   const id='nba-book-'+(++seq),recommendedLine=typeof row?.line==='number'?row.line:null;
   records.set(id,{samples:row?.samples||[],projection:Number.isFinite(row?.forecast)?row.forecast:null,recommendedLine,side:row?.side||'over'});
   // Old cards are no longer displayed after refresh; bound memory for long-lived tabs.
   if(records.size>1200)records.delete(records.keys().next().value);
   const label=row?.market||'player prop',direction=row?.side==='under'?'UNDER':'OVER';
   return '<details class="nba-book-compare" data-nba-book-card="'+id+'"'+(expanded?' open':'')+'>'+
    '<summary>▾ Optional sportsbook comparison · '+esc(label)+'</summary>'+
    '<p class="nba-book-head">Compare your book</p>'+
    '<div class="nba-book-inputs"><label>Book '+direction+' line<input type="number" min="0.5" max="400" step="0.5" inputmode="decimal" data-nba-book-input="line" placeholder="'+esc(recommendedLine??'e.g. 9.5')+'" aria-label="Sportsbook '+direction+' line for '+esc(row?.name||'player')+'"></label>'+
    '<label>American odds<input type="text" inputmode="text" data-nba-book-input="odds" placeholder="-110 or +150" aria-label="Sportsbook '+direction+' American odds for '+esc(row?.name||'player')+'"></label></div>'+
    '<p class="muted" data-nba-book-result role="status">Enter the book\'s '+direction+' line and American odds to compare the price.</p>'+
    '<details class="nba-book-help"><summary>How this comparison works</summary><p class="muted">The book line is measured against the current player projection and, when available, the same simulated stat outcomes that powered this recommendation. American odds give the price\'s break-even rate. Neither field changes matchup scores, issued picks or the Quick Slip. Uncalibrated model frequencies cannot establish a true betting edge.</p></details></details>';
  }
  function update(panel){
   if(!panel?.dataset?.nbaBookCard)return null;
   const item=records.get(panel.dataset.nbaBookCard);if(!item)return null;
   const line=panel.querySelector?.('[data-nba-book-input="line"]')?.value??'';
   const odds=panel.querySelector?.('[data-nba-book-input="odds"]')?.value??'';
   const result=compare({...item,line,odds});
   const target=panel.querySelector?.('[data-nba-book-result]');if(target)target.textContent=result.text;
   return result;
  }
  document?.addEventListener?.('input',event=>{
   if(!event.target?.dataset?.nbaBookInput)return;
   const panel=event.target.closest?.('[data-nba-book-card]');if(panel)update(panel);
  });
  return {render,update,compare};
 }
 return {compare,create};
});
