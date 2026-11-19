/* Compact, shared evidence presentation; no price or score changes. */
(function(root,factory){const common=typeof module==='object'&&module.exports,api=factory(common?require('./unpriced-alt-lines'):root.PropShopAltLines);if(common)module.exports=api;root.PropShopAltCards=api;})(typeof globalThis!=='undefined'?globalThis:this,function(alt){
 'use strict';
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function nfl(row,settlement,context){return alt.fromSettlement(settlement,(row.alternatives||[]).map(r=>r.line-.5),{...context,rating:row.researchScore});}
 function nba(row,thresholds,context){return alt.overResearch(row.samples,thresholds,{...context,minSamples:1000,rating:row.score,injuryUnresolved:row.reviewRequired||row.eligible!==true});}
 function html(research,{line,historyGames,opportunity,caveats=[]}={}){
  if(research.status!=='research-only')return '<p class="notice">Alternate-line research unavailable: '+esc(research.reason)+'</p>';
  const selected=research.lines.find(r=>r.line===line),rate=selected?'<strong>'+(100*selected.probability).toFixed(1)+'% simulated probability</strong>':'';
  return '<section class="auto-alt-evidence"><p><strong>Unpriced research target</strong> · '+rate+'</p><p class="muted">Matchup confidence '+esc(research.rating)+'/100 · heuristic rating, not win probability.</p><p class="muted">'+research.sampleSize.toLocaleString()+' model runs · '+esc(historyGames??'Unknown')+' recorded appearances · Source '+esc(research.sourceUpdatedAt)+'.</p>'+(opportunity?'<p class="muted">'+esc(opportunity)+'</p>':'')+caveats.map(c=>'<p class="notice">'+esc(c)+'</p>').join('')+'<p class="muted">Uncalibrated estimates. Thresholds are research targets; sportsbook availability is unverified. Odds are optional.</p></section>';
 }
 return {nfl,nba,html};
});
