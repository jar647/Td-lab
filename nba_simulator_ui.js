(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.CookNBASimulatorUI=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),pct=x=>(100*x).toFixed(1)+'%',fmt=x=>Number(x).toFixed(1),KEY='nba-possession-forecast-locks-v1';
function slipLegs(game,slip){return (slip?.getPicks?.()||[]).map(p=>({...p,side:String(p.side||p.ratedSide||(/^(over|under)\b/i.exec(p.recommendation||'')||[])[1]||'').toLowerCase()})).filter(p=>p.sport==='NBA'&&p.game===game.away+' @ '+game.home&&['over','under'].includes(p.side)&&p.line!==null&&p.line!==undefined&&Number.isFinite(Number(p.line))).slice(0,5).map(p=>({player:p.player,market:p.market,line:Number(p.line),side:p.side}));}

const ENSEMBLE_VERSION='nba-device-forward-ensemble-v1';
const ENSEMBLE_WEIGHTS=[0,.5,.75,1];
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const avg=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const rounded=n=>Math.round(n*10)/10;
function blendScores(home,away,baseline){
 if(![home,away,baseline?.home,baseline?.away].every(finite))return null;
 return ENSEMBLE_WEIGHTS.map(w=>({baselineWeight:w,home:rounded((1-w)*home+w*baseline.home),away:rounded((1-w)*away+w*baseline.away)}));
}
function frozenBlend(lock){
 const expected=blendScores(lock?.projection?.home,lock?.projection?.away,lock?.baseline);
 const actual=lock?.ensemble;
 if(!expected||actual?.version!==ENSEMBLE_VERSION||!Array.isArray(actual.scores)||actual.scores.length!==expected.length)return null;
 if(!actual.scores.every((x,i)=>x.baselineWeight===expected[i].baselineWeight&&x.home===expected[i].home&&x.away===expected[i].away))return null;
 return actual.scores;
}
function entries(storage){
 try{const x=JSON.parse(storage?.getItem(KEY)||'[]');return Array.isArray(x)?x:[]}catch(_){return []}
}
function selectedLocks(locks){
 const selected=new Map();
 for(const lock of locks){
  if(!lock||!String(lock.gameId||'')||!Number.isFinite(Date.parse(lock.lockedAt))||!(Date.parse(lock.lockedAt)<Date.parse(lock.tipoff)))continue;
  const key=String(lock.gameId),old=selected.get(key);
  if(!old||Date.parse(lock.lockedAt)>Date.parse(old.lockedAt))selected.set(key,lock);
 }
 return [...selected.values()];
}
function capture(result,model,storage,now=Date.now()){
 if(!result.possession||!storage||now>=Date.parse(model.date)||!Number.isFinite(Date.parse(model.date)))return {saved:false,reason:'Pregame storage unavailable'};
 try{
  const locks=entries(storage),fingerprint=JSON.stringify([model.possessionModel.teams,model.possessionModel.pace]);
  let hash=2166136261;for(const c of fingerprint)hash=Math.imul(hash^c.charCodeAt(0),16777619);
  const id=JSON.stringify([model.id,result.possession.model,hash>>>0,result.market,result.markets.map(x=>x.price)]);
  if(locks.some(x=>x.id===id))return {saved:true,existing:true};
  const baseline=result.possession.baseline||model.baseline||null;
  const variantScores=blendScores(result.simulated.home,result.simulated.away,baseline);
  const lock={id,gameId:String(model.id),model:result.possession.model,home:model.home,away:model.away,tipoff:model.date,
   lockedAt:new Date(now).toISOString(),projection:result.simulated,baseline,market:result.market,
   prices:result.markets.map(x=>({key:x.key,price:x.price})),lineSource:'user-entered, not verified',
   ensemble:variantScores?{version:ENSEMBLE_VERSION,scores:variantScores,status:'SHADOW_ONLY'}:null,
   inputs:model.possessionModel.inputTimes,context:model.possessionModel.context};
  locks.push(lock);storage.setItem(KEY,JSON.stringify(locks));return {saved:true,existing:false};
 }catch(_){return {saved:false,reason:'Browser forecast storage is full or unavailable'}}
}
function winSide(pred,market,actual){
 if(!finite(pred)||!finite(market)||!finite(actual))return 'NO LINE';
 const side=Math.sign(pred-market);
 if(!side)return 'NO LEAN';
 const settled=Math.sign(actual-market);
 return !settled?'PUSH':settled===side?'WIN':'LOSS';
}
function marketGrade(lock,score){
 const line=lock.market||{},h=lock.grade?.home,a=lock.grade?.away;
 if(![h,a].every(finite))return {ats:'NO RESULT',total:'NO RESULT'};
 return {ats:winSide(score.home-score.away,-line.homeSpread,h-a),
  total:winSide(score.home+score.away,line.total,h+a)};
}
function gradedEnsemble(rows){
 const withFrozen=rows.flatMap(x=>{const v=frozenBlend(x);return v?[{lock:x,scores:v}]:[]});
 const weights=ENSEMBLE_WEIGHTS.map((w,i)=>{
  const records=withFrozen.map(x=>({lock:x.lock,score:x.scores[i]}));
  const evalMarket=key=>{
   const r=records.map(x=>marketGrade(x.lock,x.score)[key]);
   const wins=r.filter(s=>s==='WIN').length,losses=r.filter(s=>s==='LOSS').length,pushes=r.filter(s=>s==='PUSH').length;
   return {gamesWithLean:wins+losses+pushes,wins,losses,pushes,hitRate:wins+losses?wins/(wins+losses):null};
  };
  return {baselineWeight:w,games:records.length,
   marginMAE:avg(records.map(x=>Math.abs((x.score.home-x.score.away)-(x.lock.grade.home-x.lock.grade.away)))),
   totalMAE:avg(records.map(x=>Math.abs(x.score.home+x.score.away-x.lock.grade.home-x.lock.grade.away))),
   ats:evalMarket('ats'),total:evalMarket('total')};
 });
 const marketRecords=withFrozen.filter(x=>finite(x.lock.market?.total)||finite(x.lock.market?.homeSpread));
 return {games:withFrozen.length,quotedGames:marketRecords.length,weights,
  methodology:'Only new device-local pregame captures with both model forecasts frozen are counted. Spread and total direction is a hypothetical model lean, NOT a placed bet or an approved edge. Pushes excluded from hit rate; no line means no evaluation.'};
}
function grade(feed,storage,now=Date.now()){
 if(!storage)return {graded:0};
 try{
  const locks=entries(storage);
  let changed=false;
  for(const lock of locks){
   if(lock.grade||!Number.isFinite(Date.parse(lock.lockedAt))||Date.parse(lock.lockedAt)>=Date.parse(lock.tipoff)||now<Date.parse(lock.tipoff))continue;
   const g=(feed.games||[]).find(g=>String(g.id)===String(lock.gameId)&&g.status==='STATUS_FINAL');
   if(!g)continue;
   const points=team=>{const ps=(g.players||[]).filter(p=>p.team===team&&!p.didNotPlay);return ps.length>=5&&ps.every(p=>p.stats?.PTS!==undefined)?ps.reduce((s,p)=>s+Number(p.stats.PTS),0):null};
   const h=points(g.home),a=points(g.away);
   if(h===null||a===null||h===a||!Number.isFinite(h+a))continue;
   lock.grade={home:h,away:a,gradedAt:feed.generated_at};changed=true;
  }
  if(changed)storage.setItem(KEY,JSON.stringify(locks));
  const rows=selectedLocks(locks).filter(x=>x.grade&&finite(x.grade.home)&&finite(x.grade.away));
  const metrics={graded:rows.length,
   marginMAE:avg(rows.map(x=>Math.abs((x.projection.home-x.projection.away)-(x.grade.home-x.grade.away)))),
   totalMAE:avg(rows.map(x=>Math.abs(x.projection.home+x.projection.away-x.grade.home-x.grade.away))),
   brier:avg(rows.map(x=>(x.projection.homeWin-Number(x.grade.home>x.grade.away))**2)),
   margin80Coverage:avg(rows.map(x=>Number(x.grade.home-x.grade.away>=x.projection.margin.p10&&x.grade.home-x.grade.away<=x.projection.margin.p90))),
   total80Coverage:avg(rows.map(x=>Number(x.grade.home+x.grade.away>=x.projection.total.p10&&x.grade.home+x.grade.away<=x.projection.total.p90))),
   ensemble:gradedEnsemble(rows),totalLocks:locks.length};
  for(const weight of [0,.25,.5,1]){
   const priced=rows.filter(x=>finite(x.market?.total)&&finite(x.market?.homeSpread));
   const mlRows=rows.map(x=>{const hp=x.prices.find(p=>p.key==='homeML')?.price,ap=x.prices.find(p=>p.key==='awayML')?.price,prob=p=>p===null||p===undefined||!finite(p)?null:p>0?100/(100+p):-p/(100-p);const h=prob(hp),a=prob(ap);return h!==null&&a!==null?{...x,marketHome:h/(h+a)}:null}).filter(Boolean);
   metrics['marketBlend'+weight]={games:priced.length,mlGames:mlRows.length,
    brier:avg(mlRows.map(x=>((1-weight)*x.projection.homeWin+weight*x.marketHome-Number(x.grade.home>x.grade.away))**2)),
    marginMAE:avg(priced.map(x=>Math.abs((1-weight)*(x.projection.home-x.projection.away)+weight*(-x.market.homeSpread)-(x.grade.home-x.grade.away)))),
    totalMAE:avg(priced.map(x=>Math.abs((1-weight)*(x.projection.home+x.projection.away)+weight*x.market.total-x.grade.home-x.grade.away)))};
  }
  return metrics;
 }catch(_){return {graded:0}}
}
function exportCSV(storage){
 const cols=['game_id','away','home','tipoff_utc','captured_utc','model','line_source',
  'home_spread_line','total_line','home_moneyline_odds','away_moneyline_odds','home_spread_odds','away_spread_odds','over_odds','under_odds',
  'possession_home','possession_away','baseline_home','baseline_away','blend50_home','blend50_away','blend75_home','blend75_away',
  'actual_home','actual_away','ats50_lean_result','total50_lean_result','ats75_lean_result','total75_lean_result'];
 const q=x=>{let s=x===null||x===undefined?'':String(x);if(/^[=+\-@\t\r]/.test(s)&&!(/^-?\d+(\.\d+)?$/.test(s)))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
 const rows=entries(storage).map(lock=>{
  const prices=Object.fromEntries((lock.prices||[]).map(p=>[p.key,p.price]));
  const scores=frozenBlend(lock),score50=scores?.find(x=>x.baselineWeight===.5),score75=scores?.find(x=>x.baselineWeight===.75);
  const graded=lock.grade&&finite(lock.grade.home)&&finite(lock.grade.away);
  return [lock.gameId,lock.away,lock.home,lock.tipoff,lock.lockedAt,lock.model,lock.lineSource||'user-entered, not verified',
   lock.market?.homeSpread,lock.market?.total,prices.homeML,prices.awayML,prices.homeATS,prices.awayATS,prices.over,prices.under,
   lock.projection?.home,lock.projection?.away,lock.baseline?.home,lock.baseline?.away,score50?.home,score50?.away,score75?.home,score75?.away,
   graded?lock.grade.home:null,graded?lock.grade.away:null,graded&&score50?marketGrade(lock,score50).ats:null,graded&&score50?marketGrade(lock,score50).total:null,
   graded&&score75?marketGrade(lock,score75).ats:null,graded&&score75?marketGrade(lock,score75).total:null].map(q).join(',');
 });
 return [cols.map(q).join(','),...rows].join('\r\n')+'\r\n';
}
function audit(result,model){const x=result.possession;if(!x)return '';const home=result.simulated.home,away=result.simulated.away,total=home+away,base=x.baseline||model.baseline||{};const n=v=>Number.isFinite(Number(v))?fmt(v):'unavailable';const delta=(v,b)=>Number.isFinite(Number(v))&&Number.isFinite(Number(b))?((v-b)>=0?'+':'')+fmt(v-b):'unavailable';const teams=Object.entries(x.rotation||{}).map(([name,t])=>{const minutes=Object.values(t.minutes||{}).reduce((sum,v)=>sum+(Number(v)||0),0);return '<p><strong>'+esc(name)+'</strong>: '+n(t.pace)+' historical possessions/game ('+esc(t.games)+' games); '+n(t.rest)+' rest days; '+(t.venueChanged?'venue changed':'same venue')+'; '+n(minutes)+' allocated regulation minutes; '+esc((t.absent||[]).join(', ')||'no listed absences')+'.</p>'}).join('');const pace=Number(x.pace);const efficiency=Number.isFinite(pace)&&pace>0?'<p>Implied points per 100 modeled possessions: '+esc(model.away)+' '+n(100*away/pace)+'; '+esc(model.home)+' '+n(100*home/pace)+'. These are score/pace diagnostics, not independently fitted offensive ratings.</p>':'';return '<details class="nba-matchup-details"><summary>Simulation audit · what drove this score</summary><p>Modeled possessions: <strong>'+n(x.pace)+'</strong>. Independent projected total: <strong>'+n(total)+'</strong>.</p>'+efficiency+'<p>Historical scoring baseline: '+esc(model.away)+' '+n(base.away)+'; '+esc(model.home)+' '+n(base.home)+'. Model minus baseline: '+esc(model.away)+' '+delta(away,base.away)+'; '+esc(model.home)+' '+delta(home,base.home)+'; combined '+delta(total,Number(base.away)+Number(base.home))+'. This difference includes all modeled effects, not just injuries.</p>'+teams+'<p>Defensive inputs: opponent shooting splits, turnover pressure, free throws and offensive-rebound opportunities. The engine does not currently expose a verified point-by-point attribution for each factor.</p>'+(x.uncertain?.length?'<p class="warn">Uncertain availability: '+esc(x.uncertain.join(', '))+'. Questionable players are scenario assumptions, not confirmed starters.</p>':'')+'<p class="muted">Input timestamps: games '+esc(model.possessionModel?.inputTimes?.games||'unknown')+'; injuries '+esc(model.possessionModel?.inputTimes?.injuries||'unknown')+'; rosters '+esc(model.possessionModel?.inputTimes?.rosters||'unknown')+'. Rest, home court and rotation adjustments remain uncalibrated. This audit explains inputs and outputs; it does not prove causation or probability accuracy.</p></details>';}
function detail(result,model){const x=result.possession;if(!x)return '';const rotations=Object.entries(x.rotation).map(([team,t])=>'<p><strong>'+esc(team)+'</strong> · '+t.games+' games · '+(t.rotationProfileGames||0)+' with reconciled quarter rotations · lineup '+esc(t.lineupStatus||'UNAVAILABLE')+' ('+esc(t.lineupSource||'not sourced')+') · starters: '+esc((t.starters||[]).join(', ')||'projected from recent roles')+' · '+t.shotProfileGames+' with verified shot-description buckets · rest '+fmt(t.rest)+' days · venue changed '+(t.venueChanged?'yes':'no')+' · absent: '+esc(t.absent.join(', ')||'none listed')+'</p>').join('');
 const market=result.market,total=market.total,spread=market.homeSpread,hasMarket=Number.isFinite(total)&&Number.isFinite(spread);
 return '<section class="panel"><h3>Possessions + player rotations</h3><p>Estimated regulation possessions: <strong>'+fmt(x.pace)+'</strong> · overtime '+pct(x.overtimeRate)+' · final margin 18+ '+pct(x.blowoutRate)+'.</p>'+
 (x.uncertain.length?'<p class="warn">Questionable availability: '+esc(x.uncertain.join(', '))+'. Equal-weight in/out sensitivity assumptions; not confirmed injury probabilities.</p>':'')+
 '<p>Independent simulation: '+esc(model.away)+' '+fmt(result.simulated.away)+' · '+esc(model.home)+' '+fmt(result.simulated.home)+'.</p>'+
 (hasMarket?'<p>Entered market benchmark: '+esc(model.away)+' '+fmt((total+spread)/2)+' · '+esc(model.home)+' '+fmt((total-spread)/2)+'. Your lines do not change the independent simulation. No automatic market blend is applied.</p>':'<p>Enter both spread and total to display the market score benchmark.</p>')+
 audit(result,model)+'<details><summary>Player outcomes, rotations & model assumptions</summary>'+rotations+(x.context?'<p>Snapshot retrieved: '+esc(x.context.observedAt||'unavailable')+'. Lineup check: '+esc(x.context.lineups)+'; defender tracking: '+esc(x.context.tracking)+' ('+esc(x.context.trackingLocation||'published snapshot')+'). '+esc(x.context.assignments)+' '+esc(x.context.coaching)+(x.context.trackingWarning?' '+esc(x.context.trackingWarning):'')+'</p>':'')+'<div style="overflow-x:auto"><table class="sim-table"><thead><tr><th>Player</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th></tr></thead><tbody>'+x.players.map(p=>'<tr><td>'+esc(p.player)+'</td><td>'+fmt(p.minutes)+'</td><td>'+fmt(p.points)+'</td><td>'+fmt(p.rebounds)+'</td><td>'+fmt(p.assists)+'</td></tr>').join('')+'</tbody></table></div>'+Object.values(x.rotation).flatMap(t=>Array.isArray(t?.players)?t.players:[]).filter(p=>p&&Object.keys(p.defenderExposure||{}).length).map(p=>'<p class="muted">'+esc(p.name)+' · estimated defender mixture: '+esc(Object.values(p.defenderExposure).sort((a,b)=>b.weight-a.weight).slice(0,3).map(d=>d.name).join(', '))+' · '+fmt(p.matchupSample||0)+' historical matchup possessions; not confirmed assignments.</p>').join('')+'<p class="muted">Player points sum to team scores within every draw; combos use those same player outcomes. Regulation rotations sum to 240 minutes per team; overtime adds 25 team minutes per period. Blowout rotations change in the fourth quarter.</p><p class="muted">'+esc(model.warning)+'</p></details>'+
 (x.legs.length?'<details><summary>Saved same-game legs · shared simulation</summary>'+x.legs.map(l=>'<p>'+esc(l.player)+' '+esc(l.side)+' '+l.line+' '+esc(l.market)+' · clears line in '+pct(l.hitRate)+' of draws.</p>').join('')+'<p>All legs clear their lines together: '+pct(x.jointHitRate)+'. This strict-hit fraction counts pushes and DNP scenarios as non-hits, not as settled sportsbook losses. It is not a sportsbook-settled ticket win probability. No combined quote or SGP value is inferred.</p><p>Pairwise joint-hit matrix: '+esc(JSON.stringify(x.pairHitRates.map(row=>row.map(pct))))+'</p></details>':'<p class="muted">Save same-game props in Quick Slip to compare them in these shared simulations.</p>')+'</section>';
}
function localValidation(report){
 const f=x=>finite(x)?x.toFixed(2):'pending';
 const ens=report.ensemble||{},rows=ens.weights||[],br=rows.filter(x=>x.baselineWeight===.5||x.baselineWeight===.75);
 const score=br.map(x=>{
  const label=Math.round(x.baselineWeight*100)+'% baseline / '+Math.round((1-x.baselineWeight)*100)+'% possession';
  const outcome=x.ats||{},tot=x.total||{};
  return '<p><strong>'+label+'</strong> · '+x.games+' graded frozen games; margin MAE '+f(x.marginMAE)+'; total MAE '+f(x.totalMAE)+'. From entered lines, hypothetical spread leans '+outcome.wins+'W-'+outcome.losses+'L-'+outcome.pushes+'P ('+outcome.gamesWithLean+' cases); total leans '+tot.wins+'W-'+tot.losses+'L-'+tot.pushes+'P ('+tot.gamesWithLean+' cases).</p>';
 }).join('');
 return '<details><summary>Your frozen NBA simulations, entered lines & results</summary><p>Stored on this device: '+(report.totalLocks||0)+' pregame revisions, '+(report.graded||0)+' distinct graded games. Original model margin MAE '+f(report.marginMAE)+'; total MAE '+f(report.totalMAE)+'; winner Brier '+f(report.brier)+'.</p>'+
  '<p>New forward-test records: '+(ens.games||0)+' completed games with blends frozen before tipoff; '+(ens.quotedGames||0)+' with an entered spread or total.</p>'+score+
  '<p class="muted">These are direction-of-model leans at your manually entered lines, not sportsbook bets, verified odds or profits. A push is counted separately. Blank prices are never filled in. Local storage stays on this device/browser; clearing site data may erase records. Use Export CSV for backup. No blend is applied to live picks.</p>'+
  [0,.25,.5,1].map(w=>{const m=report['marketBlend'+w];return m?'<p>'+w*100+'% market-score benchmark: '+m.games+' games; margin MAE '+f(m.marginMAE)+'; total MAE '+f(m.totalMAE)+'; ML Brier '+f(m.brier)+' ('+m.mlGames+' paired-price games).</p>':''}).join('')+'</details>';
}
function validation(report){
 if(!report)return '<p class="muted">Frozen forecast report is loading.</p>';
 const p=report.prospective||{},r=report.retrospective||{},b=report.prospective_bias||{},a=b.all||{},f=x=>Number.isFinite(x)?x.toFixed(2):'pending',signed=x=>Number.isFinite(x)?(x>=0?'+':'')+x.toFixed(2):'pending';
 const bias=a.games?'<p>Prospective score bias ('+a.games+' frozen games; forecast minus actual): home '+signed(a.home_bias)+' points, away '+signed(a.away_bias)+'; total '+signed(a.total_bias)+'; home-minus-away margin '+signed(a.margin_bias)+'. Positive means projected too many points.</p><p>Model-projected favorite by 8+ points: '+(b.projected_favorite_8plus?.games||0)+' graded games; winner accuracy '+(Number.isFinite(b.projected_favorite_8plus?.projected_winner_accuracy)?pct(b.projected_favorite_8plus.projected_winner_accuracy):'not enough games')+'. These are model favorites, NOT sportsbook favorites or verified betting edges.</p>':'';
  const sc=report.shadow_score_calibration||{},replay=sc.replay||{},frozen=sc.frozen||{};
 const shadowReport=sc.status?
  '<p><strong>Score-bias correction experiment (NOT applied)</strong>: '+(replay.games||0)+' earlier pregame games in a chronological replay. Margin MAE raw '+f(replay.raw_margin_mae)+' vs proposed '+f(replay.shadow_margin_mae)+'; total MAE raw '+f(replay.raw_total_mae)+' vs proposed '+f(replay.shadow_total_mae)+'.</p>'+
  (frozen.games?'<p>Truly prospective shadow predictions already frozen before tipoff: '+frozen.games+' graded. Margin MAE '+f(frozen.raw_margin_mae)+' vs '+f(frozen.shadow_margin_mae)+'; total MAE '+f(frozen.raw_total_mae)+' vs '+f(frozen.shadow_total_mae)+'.</p>':'<p>Prospective shadow evaluation: no graded shadow forecasts yet. Earlier-game replay is not proof of forward improvement.</p>')+
  '<p class="muted">Score-bias corrections use only earlier same-version games with an 18-hour final-score embargo. They cannot change existing picks, betting lines, player stats or winning chances. Approval remains OFF pending at least 100 future frozen shadow games and independent review.</p>':'';
 const ens=report.ensemble_score_audit||{};
 const historical=ens.retrospective?.weights||[],future=ens.frozen?.weights||[];
 const ensembleHtml=historical.length?
  '<p><strong>Score model vs historical baseline · fixed-weight experiment (NOT applied)</strong></p>'+
  '<p>The original historical score baseline is evaluated against the possession model and fixed blends. All components were saved before tipoff, but these combinations are being assessed after the fact.</p>'+
  '<div style="overflow-x:auto"><table><thead><tr><th>Baseline share</th><th>Graded games</th><th>Margin MAE</th><th>Total MAE</th></tr></thead><tbody>'+
  historical.map(w=>'<tr><td>'+Math.round(w.baseline_weight*100)+'%</td><td>'+(w.games||0)+'</td><td>'+f(w.margin_mae)+'</td><td>'+f(w.total_mae)+'</td></tr>').join('')+'</tbody></table></div>'+
  '<p>Genuinely forward-tested frozen 50/50 blend: '+(future.find(w=>w.baseline_weight===.5)?.games||0)+' graded games. At least 100 independently captured future games and improvement in both error metrics are needed before even considering approval.</p>'+
  '<p class="muted">All five static blends are shadow tests only; actual game predictions, market prices, player props and recommendations stay unchanged.</p>':'';
 const fallback=Number.isInteger(report.fallback_forecasts)&&report.fallback_forecasts?'<p class="warn">'+report.fallback_forecasts+' upcoming matchup(s) use a clearly labeled team-score history fallback because the uncertain rotation cannot be supported. No player stats or injury-adjusted claims are made for those games.</p>':'';
 return '<details><summary>Frozen forecasts & model comparison</summary>'+ensembleHtml+shadowReport+'<p>Prospective graded games: '+(p.games||0)+' · margin MAE '+f(p.margin_mae)+' · total MAE '+f(p.total_mae)+' · winner Brier '+f(p.brier)+'.</p>'+bias+fallback+'<p>Earlier-box-score walk-forward check ('+(r.games||0)+' games): possession margin MAE '+f(r.margin_mae)+' vs score baseline '+f(r.baseline_margin_mae)+'; total MAE '+f(r.total_mae)+' vs '+f(r.baseline_total_mae)+'. Lower is better. This comparison does not establish improvement.</p><p class="muted">Historical injury/roster announcements and market prices are unavailable in this retrospective check. Current injury adjustments require prospective testing. Promotion remains off. <a href="./data/nba_simulator_report.json">Full model report</a></p></details>';
}
function modelNote(model){if(!model.rotationFallback)return '';return '<section class="panel"><strong>Team-score history simulation · limited rotation coverage</strong><p class="warn">'+esc(model.rotationFallback.reason)+'</p><p>Scores use completed team games. Tonight’s lineup and injury changes are not modeled, and player props are unavailable. These results are not betting recommendations.</p></section>';}
function compact(result,model){return '<h3>Simulation Results · '+result.runCount.toLocaleString()+' runs</h3>'+modelNote(model)+'<p><strong>'+esc(model.away)+' '+fmt(result.simulated.away)+' · '+esc(model.home)+' '+fmt(result.simulated.home)+'</strong></p><p>Home win '+pct(result.simulated.homeWin)+' · away win '+pct(result.simulated.awayWin)+'. Margin 10–90% range '+fmt(result.simulated.margin.p10)+' to '+fmt(result.simulated.margin.p90)+'; total '+fmt(result.simulated.total.p10)+' to '+fmt(result.simulated.total.p90)+'.</p><div style="overflow-x:auto"><table class="sim-table"><thead><tr><th>Market</th><th>Win</th><th>Odds</th><th>Modeled EV</th><th>Status</th></tr></thead><tbody>'+result.markets.map(m=>'<tr><td>'+esc(m.label)+'</td><td>'+pct(m.win)+'</td><td>'+esc(m.price??'—')+'</td><td>'+(m.ev===null?'—':pct(m.ev))+'</td><td>'+esc(m.signal)+'</td></tr>').join('')+'</tbody></table></div>'+detail(result,model)+'<p class="muted">Candidate model, not demonstrated more accurate. Compare frozen forecasts with actual results. Larger run counts reduce random simulation noise, not model bias.</p>';}
return {KEY,slipLegs,capture,grade,detail,compact,validation,localValidation,modelNote,exportCSV,ensembleScores:blendScores,frozenBlend,gradedEnsemble,marketGrade};
});

