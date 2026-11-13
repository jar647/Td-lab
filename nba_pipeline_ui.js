/* Published-model UI: the displayed forecast is the exact record frozen/graded. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CookNBAPipeline=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const pct=x=>Number.isFinite(x)?(x*100).toFixed(1)+'%':'unavailable';
 const fmt=x=>Number.isFinite(x)?x.toFixed(1):'—';
 const valid=(stamp,now,hours)=>{const t=Date.parse(stamp),age=now-t;return Number.isFinite(t)&&age>=0&&age<=hours*3600000};
 const labels={points:'points',rebounds:'rebounds',assists:'assists',threes:'three-pointers',points_rebounds:'points + rebounds',points_assists:'points + assists',rebounds_assists:'rebounds + assists',pra:'PRA'};
 const baseLeg=p=>'<div class="player"><strong>'+esc(p.player)+' · '+esc(p.side)+' '+esc(p.line)+' '+esc(labels[p.market]||p.market)+'</strong><p>Projection '+fmt(p.projection)+' · '+fmt(p.minutes)+' MIN'+(p.bookmaker?' · '+(p.american_odds>0?'+':'')+esc(p.american_odds):'')+'</p><details class="nba-price-details"><summary>Why?</summary><p class="muted">'+esc(p.reason)+' · '+esc(p.sample)+' prior games · '+esc(p.status)+'</p>'+(p.bookmaker?'<p class="muted">'+esc(p.bookmaker)+' · model '+pct(p.probability)+' · break-even '+pct(p.break_even)+' · estimated EV '+pct(p.estimated_ev)+(Number.isFinite(p.no_vig_edge)?' · no-vig edge '+pct(p.no_vig_edge):'')+'</p>':'')+'</details></div>';

 function render(record,audit,now=Date.now(),matchupRows=[]){
  if(!record)return '<p>No published pregame analysis for this game. No retrospective forecast substituted.</p>';
  const a=record;
  if(!valid(a.generated_at,now,6)||!Number.isFinite(Date.parse(a.tipoff))||Date.parse(a.tipoff)<=now)return '<p class="warn">PASS · Analysis stale, invalid, or game already started.</p>';
  const quoteExpired=a.sgp&&(!valid(a.sgp.observed_at,now,1)||!(a.sgp.legs||[]).every(p=>valid(p.observed_at,now,1)));
  let html='<h3>'+esc(a.game||a.game_id)+' · '+esc(quoteExpired?'PASS · quote expired':a.status)+'</h3>';
  html+='<p class="warn">'+(a.reasons||[]).map(x=>esc(x==='No qualifying offered SGP quote'?'Combined sportsbook price unavailable.':x)).join(' · ')+'</p>';
  const blocked=(a.blockers||[]).length>0;
  const canonical={points_rebounds:['points','rebounds'],points_assists:['points','assists'],rebounds_assists:['rebounds','assists'],pra:['points','rebounds','assists']};
  const rating=p=>{const parts=(canonical[p.market]||[p.market]).map(k=>matchupRows.find(r=>String(r.playerId)===String(p.player_id)&&r.market===k&&(r.side||'over')===String(p.side).toLowerCase()));return parts.every(r=>r?.eligible&&Number.isFinite(r.researchScore)&&r.researchScore>=85&&r.researchScore<=100)?Math.min(...parts.map(r=>r.researchScore)):null};
  const supported=p=>rating(p)!==null&&String(p.side).toLowerCase()==='over'&&Object.hasOwn(labels,p.market);
  const leg=p=>baseLeg(p).replace('</strong>','</strong><p>Matchup quality '+rating(p)+'/100 · not win probability</p>');
  const freshLeg=p=>supported(p)&&valid(p.observed_at,now,1);
  if(a.sgp?.legs?.length&&!blocked&&valid(a.sgp.observed_at,now,1)&&(a.sgp.legs||[]).every(freshLeg)){
   html+='<h3>SGP research lean · '+esc(a.sgp.bookmaker)+'</h3>'+a.sgp.legs.map(leg).join('')+'<p>Actual combined decimal price '+esc(a.sgp.decimal_odds)+' · modeled joint chance '+pct(a.sgp.joint_probability)+' · conservative estimated EV '+pct(a.sgp.estimated_ev)+'</p>';
  }else if(a.sgp)html+='<p class="warn">SGP quote expired or inputs blocked. PASS until refreshed.</p>';
  if(!a.sgp&&a.research_ticket?.legs?.length&&!blocked&&(a.research_ticket.legs||[]).every(supported)){const t=a.research_ticket;
   html+='<h3>Unpriced SGP research target — not a bet</h3>'+t.legs.map(leg).join('')+'<p>Modeled joint chance '+pct(t.joint_probability)+' · model fair decimal price '+Number(t.fair_decimal).toFixed(2)+' · requires an actual same-book combined price of at least '+Number(t.minimum_decimal_for_5pct_ev).toFixed(2)+' for a 5% modeled EV margin.</p><p class="warn">No sportsbook combined quote is available. Payout and positive value are not established.</p>';
  }
  if(a.best_single&&!blocked&&freshLeg(a.best_single))html+='<h3>Best single · research lean</h3>'+leg(a.best_single);
  else html+='<h3>Best single</h3><p>PASS · No supported OVER matchup rated 85+/100 with a current quote.</p>';
  const top=(a.top_players||[]).filter(freshLeg);
  if(top.length&&!blocked)html+='<h3>Top three player recommendations</h3>'+top.map((p,i)=>'<h4>#'+(i+1)+'</h4>'+leg(p)).join('');
  html+='<h3>Projected starting lineups</h3><p class="muted">Projected from recent starts and rotation minutes; not confirmed.</p>';
  for(const team of [a.away,a.home].filter(Boolean)){
   html+='<h4>'+esc(team)+'</h4>';
   for(const p of a.starters?.[team]||[])html+='<p><strong>'+esc(p.player)+'</strong> · '+fmt(p.minutes)+' MIN · '+esc(p.status)+'</p>';
   const context=a.team_context?.[team];if(context)html+='<p class="muted">'+esc(context.games)+' team games · rest '+fmt(context.rest_days)+' days · projected rotation '+fmt(context.rotation_minutes)+' minutes · absent: '+esc(context.absences.join(', ')||'none listed')+'</p>';
  }
  html+='<details class="nba-price-details"><summary>Full player projections</summary><h3>Player projections · same model used for grading</h3><table class="sim-table"><thead><tr><th>Player</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>PRA</th></tr></thead><tbody>';
  for(const player of a.rotation||[]){const ps=(a.projections||[]).filter(p=>p.player_id===player.player_id);const v=k=>fmt(ps.find(p=>p.market===k)?.projection);
   html+='<tr><td>'+esc(player.player)+'<br><span class="muted">'+esc(player.status)+'</span></td><td>'+fmt(player.minutes)+'</td><td>'+v('points')+'</td><td>'+v('rebounds')+'</td><td>'+v('assists')+'</td><td>'+v('pra')+'</td></tr>';
  }
  html+='</tbody></table></details><details class="nba-price-details"><summary>Model details &amp; grading</summary><p class="muted">'+esc(a.model)+' · '+esc(a.simulation_runs)+' scenarios · updated '+esc(a.generated_at)+'</p><p class="muted">Capture '+esc(a.frozen?a.capture_id:'not frozen — inputs blocked')+'</p><p class="muted">'+esc(a.limits)+'</p>';
  if(audit&&audit.model===a.model)html+='<h3>Frozen model grading</h3><p>'+esc(audit.graded_games)+' graded games · '+esc(audit.graded_projections)+' graded player-stat forecasts · MAE '+fmt(audit.mae)+'</p><p class="muted">'+esc(audit.method)+'</p>';
  return html+'</details>';
 }
 return {render,valid};
});

