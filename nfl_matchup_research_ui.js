/* Existing NFL score-model evidence. Matchup signals do not promote forecasts. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 root.PropShopNFLMatchupResearchUI=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const finite=v=>typeof v==='number'&&Number.isFinite(v);
 const integer=v=>Number.isInteger(v)&&v>=0;
 const signed=(v,digits)=>finite(v)?(v>0?'+':'')+v.toFixed(digits):'unavailable';
 const unavailable=reason=>'<p class="muted">'+esc(reason||'Current research is unavailable; the existing historical model remains available.')+'</p>';
 const validStrength=t=>t&&['offense_points','defense_allowed_points','net_strength_points'].every(k=>finite(t[k]))&&
  integer(t.current_season_games)&&Number.isInteger(t.ranked_teams)&&t.ranked_teams>0&&
  ['offense_rank','defense_rank','net_rank'].every(k=>Number.isInteger(t[k])&&t[k]>=1&&t[k]<=t.ranked_teams);
 function strengthHTML(strength,teams){
  if(strength?.available!==true)return unavailable(strength?.reason||'Opponent-adjusted scoring ratings are unavailable.');
  if(!integer(strength.training_games)||!finite(strength.league_points)||!teams.every(t=>validStrength(strength.teams?.[t])))return unavailable('The scoring-strength evidence is incomplete.');
  return '<h4>Opponent-adjusted team strength</h4><p class="caption">Existing scoring-model components from '+strength.training_games+' earlier games. League scoring term: '+strength.league_points.toFixed(1)+' points. Rank 1 is strongest; lower defense-allowed ratings indicate stronger defense.</p><div class="grid2">'+
   teams.map(team=>{const t=strength.teams[team];return '<div class="breakdown"><strong>'+esc(team)+'</strong><p>Offense '+signed(t.offense_points,2)+' points · rank '+t.offense_rank+'/'+t.ranked_teams+'.<br>Defense allowed '+signed(t.defense_allowed_points,2)+' points · rank '+t.defense_rank+'/'+t.ranked_teams+'.<br>Net team strength '+signed(t.net_strength_points,2)+' points · rank '+t.net_rank+'/'+t.ranked_teams+'.</p><p class="caption">'+t.current_season_games+' completed current-season games. Team terms separate historical QB effects; these are model components, not standalone score predictions.</p></div>';}).join('')+'</div>';
 }
 function opportunityHTML(label,row){
  if(row?.available!==true)return '<p><strong>'+label+':</strong> '+esc(row?.reason||'Supported pass/rush evidence is unavailable.')+'</p>';
  const fields=['offense_epa','opponent_allowed_epa','league_epa','offense_relative_to_league','opponent_allowance_relative_to_league','matchup_epa_estimate','matchup_relative_to_league'];
  if(!fields.every(k=>finite(row[k]))||!['offense_games','opponent_games','offense_plays','opponent_plays'].every(k=>integer(row[k])&&row[k]>0)||
   Math.min(row.offense_games,row.opponent_games)<3||!['FAVORABLE','ADVERSE','NEUTRAL'].includes(row.signal)||!['SUPPORTED','LIMITED'].includes(row.confidence?.level))return '<p><strong>'+label+':</strong> Supported pass/rush evidence is unavailable.</p>';
  const signal={FAVORABLE:'Favorable',ADVERSE:'Adverse',NEUTRAL:'Neutral'}[row.signal];
  return '<div class="breakdown"><strong>'+label+' · '+signal+' historical signal</strong><p>Offense '+row.offense_epa.toFixed(3)+' EPA/play · opponent allows '+row.opponent_allowed_epa.toFixed(3)+' · league '+row.league_epa.toFixed(3)+'.</p>'+
   '<p>Offense versus league '+signed(row.offense_relative_to_league,3)+'; opponent allowance versus league '+signed(row.opponent_allowance_relative_to_league,3)+'. Combined signal '+signed(row.matchup_relative_to_league,3)+' EPA/play versus league.</p>'+
   '<p class="caption">Sample support: <strong>'+esc(row.confidence.level.toLowerCase())+'</strong> · '+row.offense_games+' offense games / '+row.offense_plays+' plays; '+row.opponent_games+' defense games / '+row.opponent_plays+' plays. '+esc(row.confidence.basis||'')+'</p></div>';
 }
 function render(model){
  if(model?.sport!=='NFL')return '';
  const card=model.matchupResearch,teams=[model.away,model.home];
  const valid=card&&card.status==='RESEARCH_ONLY'&&card.score_adjustments_applied===false&&
   integer(card.season)&&card.season>=2000&&integer(card.through_week)&&card.through_week<30&&teams.every(t=>typeof t==='string'&&t.length)&&teams[0]!==teams[1]&&Array.isArray(card.opportunities);
  if(!valid)return '<section class="breakdown nfl-matchup-research"><h3>NFL matchup research</h3>'+unavailable()+'</section>';
  const directions=teams.map(team=>{
   const opponent=teams.find(t=>t!==team),rows=card.opportunities.filter(r=>r&&r.team===team&&r.opponent===opponent);
   if(rows.length!==1)return '<h4>'+esc(team)+' offense vs '+esc(opponent)+' defense</h4>'+unavailable('An unambiguous pass/rush comparison is unavailable.');
   return '<h4>'+esc(team)+' offense vs '+esc(opponent)+' defense</h4>'+opportunityHTML('Passing',rows[0].pass)+opportunityHTML('Rushing',rows[0].rush);
  }).join('');
  return '<section class="breakdown nfl-matchup-research"><h3>NFL matchup research</h3><p class="caption">'+card.season+' season · completed results through Week '+card.through_week+'. No sportsbook prices enter this analysis.</p>'+
   strengthHTML(card.strength,teams)+'<h4>Offensive opportunities to research</h4><p>Passing and rushing signals combine offensive production versus league average with the opponent’s allowance versus league average. Higher defensive EPA allowed indicates a weaker defense.</p>'+directions+
   '<p class="caption">These pass/rush signals use observed rates, separately from the opponent-adjusted scoring ratings above. Sample support describes the amount of evidence, not a win probability. '+(model.matchupScenario?'The automatic NFL matchup scenario blends EPA with supported situational evidence inside one capped scoring adjustment; net pass/rush yardage and pace affect the joint simulation. The original published scoring baseline is not changed.':'The signals do not change forecast scores or simulated percentages.')+'</p>'+
   (Array.isArray(card.limits)&&card.limits.length?'<details><summary>Research limits</summary>'+card.limits.filter(x=>typeof x==='string').map(x=>'<p class="caption">'+esc(x)+'</p>').join('')+'</details>':'')+'</section>';
 }
 return {render};
});
