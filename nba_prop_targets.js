/* Matchup-adjusted assist/rebound research targets, not verified sportsbook odds. */
window.CookNBAPropTargets={
render(player,perPlayer,esc){
 const forecast=perPlayer.get(String(player.id));
 if(!forecast)return '';
 const markets=[['assists','AST'],['rebounds','REB']];
 const cards=markets.map(([key,label])=>{
  const x=forecast[key];if(!x||!Number.isFinite(x.adjusted)||x.adjusted<0)return '';
  const projection=x.adjusted;
  const baseline=Number.isFinite(x.expected)?x.expected:projection;
  const suggested=Math.max(0.5,Math.floor(projection)+0.5);
  const margin=projection-suggested;
  const side=margin>=0.75?'Over':margin<=-0.75?'Under':'PASS';
  const games=Number(player.sampleGames)||0;
  const confidence=games>=10&&Math.abs(margin)>=1.5?'Moderate':games>=5&&Math.abs(margin)>=1?'Limited':'Low';
  return '<div><strong>'+label+'</strong> forecast '+projection.toFixed(1)+' · research line '+suggested.toFixed(1)+' · <strong>'+side+'</strong> · confidence '+confidence+'<br><small>Baseline '+baseline.toFixed(1)+'; matchup adjustment '+(projection-baseline>=0?'+':'')+(projection-baseline).toFixed(1)+'. '+esc(x.matchupReason||'Based on available matchup data')+'. Not a live sportsbook line.</small></div>';
 }).filter(Boolean);
 return cards.length?'<div class="muted"><strong>Assist / rebound prop research</strong>'+cards.join('')+'<small>Enter the actual sportsbook line and odds before betting. No verified tracking opportunities are implied.</small></div>':'';
}
};