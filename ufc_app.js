/* Shared data helpers are exported for regression tests; browser setup is below. */
(function (root) {
'use strict';
const METRICS = {
  slpm: ['Sig. strikes landed / min', ['slpm', 'significantStrikesLandedPerMinute']],
  sapm: ['Sig. strikes absorbed / min', ['sapm', 'significantStrikesAbsorbedPerMinute']],
  strAcc: ['Striking accuracy', ['strAcc', 'significantStrikeAccuracy']],
  strDef: ['Striking defense', ['strDef', 'significantStrikeDefense']],
  tdAvg: ['Takedowns / 15 min', ['tdAvg', 'takedownAverage']],
  tdAcc: ['Takedown accuracy', ['tdAcc', 'takedownAccuracy']],
  tdDef: ['Takedown defense', ['tdDef', 'takedownDefense']],
  subAvg: ['Sub. attempts / 15 min', ['subAvg', 'submissionAverage']]
};
const PERCENT = new Set(['strAcc', 'strDef', 'tdAcc', 'tdDef']);
const nameKey = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function numeric(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (String(value).trim() === '') return null;
  const n = Number(String(value).trim().replace(/%$/, ''));
  return Number.isFinite(n) ? n : null;
}
function implied(value) {
  const n = numeric(value);
  return n === null || !Number.isInteger(n) || Math.abs(n) < 100 || Math.abs(n) > 100000 ? null : n > 0 ? 100 / (n + 100) : -n / (-n + 100);
}
function market(a, b) {
  const pa = implied(a), pb = implied(b);
  if (pa === null || pb === null) return null;
  const total = pa + pb;
  return {implied:[pa,pb], fair:[pa/total,pb/total], margin:total-1};
}
function tier(c) {
  const texts = [c.cardSegment, c.cardType, c.type?.text, c.type?.name, c.note, c.headline];
  for (const note of Array.isArray(c.notes) ? c.notes : [c.notes]) texts.push(note?.headline, note?.text);
  const text = texts.map(x => typeof x === 'object' ? x?.text || x?.name || '' : x || '').join(' ').toLowerCase();
  return /early\s*prelim/.test(text) ? 'early' : /prelim/.test(text) ? 'prelim' : /main\s*card/.test(text) ? 'main' : 'unknown';
}
function statsFrom(competitor) {
  const source = competitor?.athlete?.statistics || competitor?.statistics || {};
  const entries = Array.isArray(source) ? source : source.splits?.categories?.flatMap(c => c.stats || []) || [];
  const result = {};
  for (const [key, [,aliases]] of Object.entries(METRICS)) {
    let value = aliases.map(alias => source[alias]).find(v => v !== undefined);
    if (value === undefined) {
      const item = entries.find(x => aliases.some(alias => [x.name, x.abbreviation].some(n => String(n || '').toLowerCase() === alias.toLowerCase())));
      // displayValue carries explicit percent units; a bare fraction is ambiguous.
      value = item?.displayValue ?? item?.value;
    }
    const parsed = numeric(value);
    // Bare provider fractions for percentage metrics use 0–1; explicit '%' values already use 0–100.
    result[key] = parsed !== null && PERCENT.has(key) && parsed > 0 && parsed <= 1 && !(typeof value === 'string' && value.includes('%')) ? parsed * 100 : parsed;
  }
  return result;
}
function eventsFrom(data) {
  if (!Array.isArray(data?.events)) throw new Error('The schedule response has an unexpected format.');
  const seen = new Set();
  return data.events.filter(e => e && e.id && !seen.has(String(e.id)) && Array.isArray(e.competitions) && e.competitions.length && Number.isFinite(Date.parse(e.date)) && seen.add(String(e.id))).sort((a,b) => Date.parse(a.date)-Date.parse(b.date));
}
function scheduleUrl(now = new Date()) {
  const stamp = d => d.getUTCFullYear()+String(d.getUTCMonth()+1).padStart(2,'0')+String(d.getUTCDate()).padStart(2,'0');
  const start = new Date(now), end = new Date(now);
  start.setUTCDate(start.getUTCDate()-7); end.setUTCDate(end.getUTCDate()+42);
  return 'https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard?dates='+stamp(start)+'-'+stamp(end)+'&limit=100';
}
const api = {METRICS, PERCENT, nameKey, numeric, implied, market, tier, statsFrom, eventsFrom, scheduleUrl, escape};
if (typeof module === 'object' && module.exports) module.exports = api;
root.UFCApp = api;
if (typeof document === 'undefined') return;
const $ = id => document.getElementById(id);
const ODDS_KEY = 'prop-shop-ufc-odds-v1', SCHEDULE_KEY = 'prop-shop-ufc-schedule-v1', PROP_KEY='prop-shop-ufc-props-v1';
function read(key, fallback) {try {return JSON.parse(localStorage.getItem(key)) ?? fallback;} catch (_) {return fallback;}}
function save(key, value) {try {localStorage.setItem(key, JSON.stringify(value));} catch (_) {/* Storage may be disabled. */}}
const storedOdds = read(ODDS_KEY, {});
let odds = storedOdds && typeof storedOdds === 'object' && !Array.isArray(storedOdds) ? storedOdds : {};
const initialProps=read(PROP_KEY,{});
const propInputs=initialProps&&typeof initialProps==='object'&&!Array.isArray(initialProps)?initialProps:{};
let events = [], active = '', filter = 'all', query = '', order = 'time', cache = {}, cacheDate = '', cacheBouts = [], publicHistory = {}, generation = 0, loaded = false;
const labels = {early:'EARLY PRELIMS',prelim:'PRELIMS',main:'MAIN CARD',unknown:'CARD POSITION UNVERIFIED'};
const dateText = (value, options = {dateStyle:'medium',timeStyle:'short'}) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(undefined, options) : 'Time TBA';
const fighterName = c => c?.athlete?.displayName || c?.athlete?.fullName || c?.displayName || 'Fighter TBD';
const boutKey = c => String(active)+':'+String(c.id || (c.competitors || []).map(x => x.id || nameKey(fighterName(x))).sort().join('|'));
function profileFor(c) {
  const profile = cache[nameKey(fighterName(c))] || {};
  // Never merge a same-name cache record for a different provider fighter ID.
  const providerId = c?.athlete?.id || c?.id;
  if (providerId && profile.id && String(providerId) !== String(profile.id)) return {};
  const fetched = Date.parse(profile.fetched_at || cacheDate);
  if (!Number.isFinite(fetched) || fetched > Date.now()+86400000 || Date.now()-fetched > 30*86400000) return {};
  return profile;
}
function fighterStats(c) {
  const result = statsFrom(c);
  for (const [key,value] of Object.entries(profileFor(c).stats || {})) if (numeric(value)!==null) result[key]=value;
  return result;
}
function freshHistorySource(value){const age=Date.now()-Date.parse(value);return Number.isFinite(age)&&age>=-86400000&&age<=7*86400000;}
function propProfileFor(c) {
  const base=profileFor(c),id=String(c?.athlete?.id||c?.id||base.id||'');
  const extra=publicHistory[id];
  if(!extra||String(extra.id)!==id)return base;
  const historyFresh=freshHistorySource(extra.history_fetched_at),recordFresh=freshHistorySource(extra.method_record_fetched_at);
  if(!historyFresh&&!recordFresh)return base;
  const histories=[...(historyFresh?extra.recent_fights||[]:[]),...(base.recent_fights||[])];
  return {...base,id,name:fighterName(c),...(extra.method_record&&recordFresh?{method_record:extra.method_record,method_record_scope:extra.method_record_scope,method_record_source:extra.method_record_source,method_record_fetched_at:extra.method_record_fetched_at}:{}),recent_fights:histories.sort((a,b)=>Date.parse(b.starts_at||b.event_date)-Date.parse(a.starts_at||a.event_date)),history_source:historyFresh?extra.history_source:base.history_source,history_fetched_at:historyFresh?extra.history_fetched_at:base.history_fetched_at};
}
function matchupReport(fighters) {
  return root.UFCMatchupResearch?.describe(...fighters.map(fighterStats),{names:fighters.map(fighterName),profiles:fighters.map(propProfileFor)});
}
function researchPreview(fighters) {
  const report=matchupReport(fighters);
  if(!report)return '';
  const available=report.areas.filter(area=>area.complete&&area.side!==null).sort((a,b)=>Math.abs(b.contribution)-Math.abs(a.contribution))[0];
  const heading=report.status==='incomplete'&&available?available.title+' favors '+fighterName(fighters[available.side]):report.heading;
  const missing=report.missing.map((items,i)=>items.length?fighterName(fighters[i])+': '+items.length+' career metrics unavailable':'').filter(Boolean);
  const exploit=(report.exploits||[])[0];
  return '<div class="research-preview"><span class="eyebrow">MATCHUP RESEARCH</span><h3>'+escape(heading)+'</h3><p class="muted">'+escape(report.status==='incomplete'?'Partial comparison · '+missing.join(' · '):report.leanReason)+'</p>'+(exploit?'<p class="muted"><strong>Matchup opportunity:</strong> '+escape(exploit.title)+'. '+escape(exploit.summary)+'</p>':'')+'<span class="small muted">'+(report.status==='incomplete'?'Available evidence is shown in the fight breakdown below.':'Experimental statistical lean · independent of sportsbook prices')+'</span></div>';
}
function recentHistory(c) {
  const profile=propProfileFor(c), name=fighterName(c), id=String(profile.id||c.id||'');
  const seen=new Set();
  const rows=(Array.isArray(profile.recent_fights)?profile.recent_fights:[]).filter(f=>{if(!f||(!f.winner&&!/final|complete|post/i.test(String(f.status||''))))return false;const id=String(f.bout_id||'');if(id&&seen.has(id))return false;if(id)seen.add(id);return true;}).slice(0,5);
  const ufc=profile.ufc_record;
  const record=typeof ufc==='string'?ufc:ufc&&typeof ufc==='object'?[ufc.wins,ufc.losses,ufc.draws].every(x=>numeric(x)!==null)?[ufc.wins,ufc.losses,ufc.draws].join('-'):null:null;
  return '<section class="history-side"><h4>'+escape(name)+'</h4>'+(record?'<p class="muted">Provider fight record: '+escape(record)+'</p>':'')+(rows.length?'<ol class="fight-history">'+rows.map(f=>{
    const a=String(f.fighter_a||''), b=String(f.fighter_b||''), side=a===id?0:b===id?1:nameKey(f.fighter_a_name)===nameKey(name)?0:nameKey(f.fighter_b_name)===nameKey(name)?1:null;
    const opponent=side===0?f.fighter_b_name:side===1?f.fighter_a_name:'Opponent unavailable';
    const rawWinner=String(f.winner||'');
    const winner=rawWinner.toLowerCase()==='a'?a:rawWinner.toLowerCase()==='b'?b:rawWinner;
    const own=Boolean(winner)&&Boolean(id)&&(winner===id || nameKey(winner)===nameKey(name));
    const otherId=side===0?b:a;
    const lost=winner && (winner===otherId || nameKey(winner)===nameKey(opponent));
    const result=own?'W':lost?'L':/draw/i.test(winner)?'D':'Result unavailable';
    return '<li><strong class="'+(own?'winner':'')+'">'+escape(result)+'</strong> vs '+escape(opponent||'Opponent unavailable')+'<small>'+escape([f.event_name,f.method_display,f.end_round?'Round '+f.end_round:'',f.event_date?dateText(f.event_date,{dateStyle:'medium'}):f.starts_at?dateText(f.starts_at,{dateStyle:'medium'}):''].filter(Boolean).join(' · '))+'</small></li>';
  }).join('')+'</ol>':'<p class="muted">Recent results have not been supplied for this fighter. A professional record alone does not establish opponent quality or matchup strength.</p>')+'</section>';
}
function showValue(value, key) {const n = numeric(value); return n === null ? 'Unavailable' : n.toLocaleString(undefined,{maximumFractionDigits:2})+(PERCENT.has(key) ? '%' : '');}
function recordFor(c) {return (c.records || []).find(x => x.type === 'total' || x.name === 'overall')?.summary || c.records?.[0]?.summary || profileFor(c).record || 'Record unavailable';}
function initials(name) {return name.split(/\s+/).filter(Boolean).map(x=>x[0]).slice(0,2).join('');}
function comparison(fighters) {
  const basic = [
    ['Overall record', c => recordFor(c)],
    ['Height', c => c.athlete?.displayHeight || profileFor(c).height || 'Unavailable'],
    ['Weight', c => c.athlete?.displayWeight || profileFor(c).weight || 'Unavailable'],
    ['Reach', c => c.athlete?.displayReach || profileFor(c).reach || 'Unavailable'],
    ['Stance', c => c.athlete?.stance?.text || (typeof c.athlete?.stance === 'string' ? c.athlete.stance : '') || profileFor(c).stance || 'Unavailable']
  ];
  const rows = basic.map(([label, get]) => '<tr><th scope="row">'+label+'</th>'+fighters.map(c => '<td>'+escape(get(c))+'</td>').join('')+'</tr>').join('') + Object.entries(METRICS).map(([key,[label]]) => '<tr><th scope="row">'+label+'</th>'+fighters.map(c => '<td>'+escape(showValue(fighterStats(c)[key], key))+'</td>').join('')+'</tr>').join('');
  return '<table class="comparison"><caption class="sr-only">Fighter records, measurements and career rates</caption><thead><tr><th scope="col">Career metrics</th>'+fighters.map(c=>'<th scope="col">'+escape(fighterName(c))+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table><p class="muted">Records: ESPN'+(cacheDate ? ' · Research cache: '+escape(dateText(cacheDate)) : '')+'. Unavailable means the source has not supplied this metric. Percentages use a 0–100 scale.</p>';
}
function analysis(fighters) {
  const report=matchupReport(fighters);
  if(!report)return '<p class="muted">Matchup research is temporarily unavailable. Refresh to retry.</p>';
  const facts=report.areas.map(area=>'<section class="research-area"><div class="row"><h4>'+escape(area.title)+'</h4><span class="badge">'+escape(area.side===null?'NO COMPARATIVE EDGE':fighterName(fighters[area.side]))+'</span></div><p class="muted">'+escape(area.summary)+'</p></section>').join('');
  const gaps=report.missing.map((items,i)=>items.length?'<p class="muted"><strong>'+escape(fighterName(fighters[i]))+'</strong>: '+escape(items.join(', '))+'.</p>':'').join('');
  const paths=(report.paths||[]).map(path=>'<p class="muted"><strong>'+escape(fighterName(fighters[path.side]))+'</strong>: '+escape(path.summary)+'</p>').join('');
  const exploits=(report.exploits||[]).slice(0,4).map(x=>'<section class="research-area"><h4>'+escape(x.title)+'</h4><p class="muted">'+escape(x.summary)+'</p><p class="muted">'+escape(x.route)+'</p></section>').join('');
  const recent=(report.recentEvidence||[]).map(x=>'<p class="muted"><strong>'+escape(x.name)+'</strong>: '+x.wins+' wins / '+x.losses+' losses across '+x.sample+' verified recent results; '+x.koWins+' KO/TKO wins, '+x.submissionWins+' submission wins, '+x.decisionWins+' decision wins; '+x.koLosses+' KO/TKO losses, '+x.submissionLosses+' submission losses.</p>').join('');
  const finish=(report.finishRoutes||[]).map(x=>'<p class="muted">'+escape(x)+'</p>').join('');
  const counter=report.counterargument?'<section class="research-counter"><h4>The case against the lean</h4><p class="muted">'+escape(report.counterargument.summary)+'</p></section>':'';
  const timestamps=fighters.map(c=>fighterName(c)+': '+(profileFor(c).fetched_at?dateText(profileFor(c).fetched_at):cacheDate?dateText(cacheDate):'provider only')).join(' · ');
  return '<span class="pass">'+(report.status==='incomplete'?'PARTIAL RESEARCH · NO PICK':'EXPERIMENTAL · UNVALIDATED')+'</span><h3 class="research-heading">'+escape(report.heading)+'</h3><p class="muted">'+escape(report.leanReason)+'</p>'+(exploits?'<section class="research-paths"><h4>Where each fighter can exploit the opponent</h4>'+exploits+'</section>':'')+(recent?'<section class="research-paths"><h4>Recent form and finishing evidence</h4>'+recent+(finish?'<h4>Possible finish routes</h4>'+finish:'')+'</section>':'')+facts+counter+(paths?'<section class="research-paths"><h4>Possible paths · statistical inferences</h4>'+paths+'</section>':'')+'<details class="research-history"><summary>Recent results &amp; experience</summary><div class="history-grid">'+fighters.map(recentHistory).join('')+'</div></details>'+(gaps?'<section class="research-gaps"><h4>What is missing</h4>'+gaps+'</section>':'')+'<p class="muted research-limit">'+escape((report.cautions||[]).join(' '))+'</p><p class="muted source-note">Sources: ESPN records and fight results; FighterAPI career rates where available. Career profile fetch times: '+escape(timestamps)+'. Recent results appear only when supplied.</p>';
}
function marketResult(key) {
  const prices = odds[key] || {}, result = market(prices.a, prices.b);
  if (!result) return '<p class="muted">'+(prices.a || prices.b ? 'Enter valid American odds for both fighters, such as −125 and +105 (whole numbers with absolute value of at least 100).' : 'Enter both sportsbook prices to compare implied probabilities and the margin.')+'</p>';
  return '<div class="grid">'+result.fair.map((p,i)=>'<div class="stat"><span>Fighter '+(i===0?'1':'2')+' · no-vig baseline</span><strong>'+(p*100).toFixed(1)+'%</strong><span>Raw implied '+(result.implied[i]*100).toFixed(1)+'%</span></div>').join('')+'</div><p class="muted">Bookmaker margin: '+(result.margin*100).toFixed(2)+' percentage points.'+(result.margin < 0 ? ' These prices form an underround; check that both are current and from the same market.' : '')+' These market-derived numbers are not independent fight predictions.</p>';
}
function storedProps(key) {
  if(!Object.hasOwn(propInputs,key)||!propInputs[key]||typeof propInputs[key]!=='object'||Array.isArray(propInputs[key]))propInputs[key]={};
  return propInputs[key];
}
function confirmedRounds(c) {
  const n=Number(c.format?.regulation?.periods ?? c.scheduledRounds);
  return n===3||n===5?n:null;
}
function propQuoteKey(kind,line,side,method) {return kind==='total'?'total:'+line+':'+side:'method:'+side+':'+method;}
function breakEvenText(value) {
  const p=implied(value);
  return p===null?(String(value||'').trim()?'Enter valid signed American odds, such as -125 or +200.':'Enter the sportsbook price to see its break-even rate.'):'Needs '+(p*100).toFixed(1)+'% to break even at this price. This is a price calculation, not a predicted hit rate.';
}
function propPriceInput(key,quote,label,value,placeholder='+150') {
  return '<label class="prop-price-label">'+escape(label)+'<input class="ufc-prop-price" data-bout="'+escape(key)+'" data-quote="'+escape(quote)+'" value="'+escape(value||'')+'" inputmode="text" autocomplete="off" spellcheck="false" placeholder="'+placeholder+'" aria-label="'+escape(label)+' American odds"></label><p class="prop-break-even muted" data-quote-result="'+escape(quote)+'">'+escape(breakEvenText(value))+'</p>';
}
function methodCount(count,total,outcome) {
  if(count===null)return 'Method count unavailable'+(total===null?'':' · '+total+' recorded '+outcome);
  return count+(total===null?' recorded · total '+outcome+' unavailable':' of '+total+' recorded '+outcome);
}
function propResearchBody(fighters,c) {
  if(!root.UFCPropResearch)return '<p class="muted">Round and method research is loading. Refresh to retry.</p>';
  const key=boutKey(c), saved=storedProps(key), rounds=confirmedRounds(c), lines=root.UFCPropResearch.availableLines(rounds);
  const line=lines.includes(Number(saved.line))?Number(saved.line):2.5;
  const event=events.find(e=>String(e.id)===active);
  const report=root.UFCPropResearch.research(fighters.map(propProfileFor),{names:fighters.map(fighterName),rounds,line,boutId:c.id,eventDate:c.date||c.startDate||event?.date||null});
  const totals=report.totals;
  const threshold=totals.thresholdSeconds;
  const thresholdLabel=threshold===null?'':Math.floor(threshold/60)+':'+String(threshold%60).padStart(2,'0');
  const samples=totals.fighters.map(f=>'<div class="prop-sample"><strong>'+escape(f.name)+'</strong><span>'+f.over+' over · '+f.under+' under · '+f.sample+' eligible fights</span></div>').join('');
  const totalPrices=['over','under'].map(side=>{const quote=propQuoteKey('total',line,side);return '<div>'+propPriceInput(key,quote,(side==='over'?'Over ':'Under ')+line+' price',saved[quote],side==='over'?'-115':'+100')+'</div>';}).join('');
  const sources={overall_professional:'Overall professional record (ESPN)',career_record:'Provider promotion record',recent_results:'Available recent results',unavailable:'Not supplied'};
  const methods=report.methods.map(method=>'<section class="prop-method-side"><h4>'+escape(method.name)+'</h4><p class="muted">'+escape(method.summary)+'</p><p class="prop-source muted">Win counts: '+sources[method.recordSource]+'. Opposing loss counts: '+sources[method.opponentRecordSource]+'.</p>'+method.rows.map(row=>{
    const quote=propQuoteKey('method',line,method.side,row.key);
    return '<section class="prop-method-row'+(row.candidate?' prop-candidate':'')+'"><h5>'+escape(row.label)+(row.candidate?' <span class="badge">METHOD TO RESEARCH</span>':'')+'</h5><p class="muted">'+escape(method.name)+' won by this method: <strong>'+escape(methodCount(row.winCount,row.totalWins,'wins'))+'</strong>.<br>'+escape(fighterName(fighters[1-method.side]))+' lost by this method: <strong>'+escape(methodCount(row.opponentLossCount,row.totalOpponentLosses,'losses'))+'</strong>.</p><p class="muted">'+escape(row.reason)+'</p>'+propPriceInput(key,quote,method.name+' by '+row.label+' price',saved[quote])+'</section>';
  }).join('')+'<p class="muted prop-source">'+escape(method.cautions.join(' '))+'</p></section>').join('');
  return '<p class="muted">Research another market for this fight: total rounds, KO/TKO, submission or decision. An alternative to a short moneyline still needs evidence and a suitable price.</p><section class="prop-totals"><div class="row"><h3>Total rounds</h3><span class="badge">'+(rounds?rounds+' ROUNDS CONFIRMED':'FORMAT UNCONFIRMED')+'</span></div><label class="prop-line-label">Sportsbook round line<select class="ufc-total-line" data-bout="'+escape(key)+'" '+(!rounds?'disabled':'')+'>'+(lines.length?lines.map(n=>'<option value="'+n+'" '+(n===line?'selected':'')+'>'+n+' rounds</option>').join(''):'<option>Format unavailable</option>')+'</select></label>'+(rounds?'<p class="muted">'+line+' rounds = '+thresholdLabel+' elapsed. Over means the fight lasts beyond that point; Under means it ends before it. Check your book’s settlement rules.</p>':'')+'<h4 class="prop-lean">'+escape(totals.heading)+'</h4><p class="muted">'+escape(totals.summary)+'</p><div class="prop-samples">'+samples+'</div><p class="prop-source muted">'+totals.pooled.sample+' unique fights combined; shared bouts counted once. Only the same scheduled fight length is compared. Historical counts are not probabilities for this matchup.</p><div class="grid">'+totalPrices+'</div></section><section class="prop-methods"><h3>Win method · KO/TKO, submission or decision</h3><p class="muted">Compare the fighter’s recorded winning methods with the opponent’s recorded losing methods. A win-method share describes how past wins happened; it is not the chance of winning this prop.</p>'+methods+'</section><p class="prop-limit muted">No calibrated totals or method probabilities are available. These research angles and your entered prices do not establish a betting edge. Missing or mixed evidence stays unranked.</p>';
}
function propResearch(fighters,c) {
  return '<details data-section="props"><summary>Round totals &amp; win method</summary><div class="detail-body prop-root" data-bout="'+escape(boutKey(c))+'">'+propResearchBody(fighters,c)+'</div></details>';
}
function findCurrentBout(key) {
  return events.find(e=>String(e.id)===active)?.competitions.find(c=>boutKey(c)===key);
}

function cardResearchSummary(competitions) {
  const rows=competitions.map(c=>{
    const fighters=(c.competitors||[]).slice(0,2);
    if(fighters.length!==2)return null;
    const result=root.UFCResearch?.evaluate?.(fighterStats(fighters[0]),fighterStats(fighters[1]),{draws:10000,seed:49271});
    if(result?.status!=='experimental')return {names:fighters.map(fighterName),available:false};
    const side=result.modelProbability>=0.5?0:1;
    return {names:fighters.map(fighterName),available:true,strength:Math.abs(result.modelProbability-0.5),side,probability:Math.max(result.modelProbability,1-result.modelProbability)};
  });
  const valid=rows.filter(r=>r?.available).sort((a,b)=>b.strength-a.strength);
  const unavailable=rows.filter(r=>r&&!r.available).length;
  return '<section class="panel" aria-label="Card research ranking"><h2>Card-wide matchup research</h2><p class="muted">Ranked by an <strong>uncalibrated</strong> career-statistics heuristic, not verified accuracy, betting value or confidence. No approved bets.</p>'+(valid.length?'<ol>'+valid.map(r=>'<li><strong>'+escape(r.names[r.side])+'</strong> vs '+escape(r.names[1-r.side])+' · heuristic '+(r.probability*100).toFixed(1)+'% <span class="muted">EXPERIMENTAL · PASS</span></li>').join('')+'</ol>':'<p class="muted">No fights have sufficient statistics to calculate a model lean.</p>')+(unavailable?'<p class="muted">'+unavailable+' matchup(s) excluded because required fighter statistics are missing.</p>':'')+'</section>';
}
function methodPreview(fighters,c) {
  if(!root.UFCPropResearch?.research)return '';
  const report=root.UFCPropResearch.research(fighters.map(propProfileFor),{names:fighters.map(fighterName),eventDate:c.date||c.startDate||events.find(e=>String(e.id)===active)?.date||null,boutId:c.id,rounds:c.format?.regulation?.periods});
  const angles=report.methods.filter(x=>x.status==='research_angle');
  if(!angles.length)return '<p class="muted small">Method-of-victory research: no supported historical angle for this matchup. Expand Round totals &amp; win method for the available records.</p>';
  return '<section class="research-preview"><span class="eyebrow">HISTORICAL METHOD RESEARCH</span>'+angles.map(x=>'<p><strong>'+escape(x.heading)+'</strong></p><p class="muted">'+escape(x.summary)+'</p>').join('')+'<p class="muted small">Recorded win/loss methods only. Not a calibrated finish probability or approved bet.</p></section>';
}
function simulationPreview(fighters) {
  if (!root.UFCResearch?.evaluate) return '<p class="muted">Simulation engine unavailable.</p>';
  const result=root.UFCResearch.evaluate(fighterStats(fighters[0]),fighterStats(fighters[1]),{draws:10000,seed:49271});
  if(result.status!=='experimental') return '<section class="research-preview"><span class="eyebrow">FIGHT SIMULATOR</span><p class="muted">No prediction: '+escape(result.reason)+ '</p></section>';
  const percentages=result.probabilities.map(p=>(p*100).toFixed(1)+'%');
  return '<section class="research-preview"><span class="eyebrow">EXPERIMENTAL FIGHT SIMULATOR · 10,000 DRAWS</span><h3>'+escape(fighterName(fighters[0]))+' '+percentages[0]+' · '+escape(fighterName(fighters[1]))+' '+percentages[1]+'</h3><p class="muted">Uncalibrated career-statistics heuristic, not validated win probabilities. Monte Carlo draws are NOT independent fight simulations. Method-of-victory probabilities unavailable until backtested. NO APPROVED BET.</p></section>';
}
function renderFight(c) {
  const fighters = [...(c.competitors || [])].sort((a,b)=>(a.order||0)-(b.order||0));
  while (fighters.length < 2) fighters.push({});
  const two = fighters.slice(0,2), key = boutKey(c), prices = odds[key] || {};
  const state = c.status?.type || {}, completed = state.completed || state.state === 'post';
  const isLive = state.state === 'in';
  const outcome = completed ? state.detail || state.description || 'Final' : isLive ? [state.description, c.status?.period ? 'Round '+c.status.period : '', c.status?.displayClock].filter(Boolean).join(' · ') : dateText(c.date || c.startDate);
  const meta = [c.type?.abbreviation || c.type?.text, c.format?.regulation?.periods ? c.format.regulation.periods+' rounds' : '', c.broadcast || c.broadcasts?.flatMap(x=>x.names||[]).join(', ')].filter(Boolean).join(' · ');
  return '<article class="panel fight" data-id="'+escape(key)+'"><div class="fight-top"><span class="badge">'+labels[tier(c)]+'</span><span class="badge '+(isLive?'live':completed?'result':'')+'">'+(isLive?'● LIVE':completed?'FINAL':'SCHEDULED')+'</span></div><div class="matchup">'+two.map((x,i)=>(i?'<div class="vs">VS</div>':'')+'<div class="fighter"><div class="avatar" aria-hidden="true">'+escape(initials(fighterName(x)))+'</div><h3>'+escape(fighterName(x))+'</h3><p class="muted">'+escape(recordFor(x))+'</p>'+(completed&&x.winner?'<span class="winner">WINNER</span>':'')+'</div>').join('')+'</div><div class="bout-meta">'+escape(meta)+'<br>'+escape(outcome)+'</div>'+simulationPreview(two)+methodPreview(two,c)+researchPreview(two)+propResearch(two,c)+'<details data-section="analysis"><summary>Fight breakdown · reasons and risks</summary><div class="detail-body">'+analysis(two)+'</div></details><details data-section="comparison"><summary>Fighter comparison · all career metrics</summary><div class="detail-body">'+comparison(two)+'</div></details><details data-section="market"><summary>Sportsbook price calculator</summary><div class="detail-body"><div class="grid">'+two.map((x,i)=>'<label class="odds-label">'+(i+1)+'. '+escape(fighterName(x))+'<input type="text" inputmode="text" autocomplete="off" spellcheck="false" class="ufc-odds" data-bout="'+escape(key)+'" data-side="'+(i?'b':'a')+'" value="'+escape(prices[i?'b':'a'] || '')+'" placeholder="'+(i?'+105':'−125')+'" aria-label="'+escape(fighterName(x))+' American moneyline odds"></label>').join('')+'</div><div class="market-result" aria-live="polite" data-market="'+escape(key)+'">'+marketResult(key)+'</div><p class="muted small">Use American moneyline odds for the same two-way market. Saved on this device.</p></div></details></article>';
}
function show() {
  const event = events.find(e=>String(e.id)===active);
  const competitions = event?.competitions || [];
  const counts = Object.fromEntries(['all','early','prelim','main'].map(t=>[t, t==='all'?competitions.length:competitions.filter(c=>tier(c)===t).length]));
  for (const b of $('filters').querySelectorAll('button')) {
    const t = b.dataset.filter;
    b.classList.toggle('on',t===filter); b.setAttribute('aria-pressed',String(t===filter));
    b.disabled = t!=='all' && !counts[t];
    b.title = b.disabled ? 'The provider has not published any bouts in this card segment.' : '';
    b.textContent = ({all:'All fights',early:'Early prelims',prelim:'Prelims',main:'Main card'})[t]+' ('+counts[t]+')';
  }
  let bouts = competitions.filter(c=>(filter==='all'||tier(c)===filter) && nameKey([...(c.competitors||[]).map(fighterName),c.type?.abbreviation,c.type?.text].join(' ')).includes(nameKey(query)));
  bouts = bouts.map((c,i)=>({c,i})).sort((a,b)=>{const da=Date.parse(a.c.date||a.c.startDate),db=Date.parse(b.c.date||b.c.startDate);return ((Number.isFinite(da)&&Number.isFinite(db)?da-db:0)||a.i-b.i)*(order==='reverse'?-1:1);}).map(x=>x.c);
  $('fight-count').textContent = bouts.length+' of '+competitions.length+' fights'+(competitions.some(c=>tier(c)==='unknown')?' · Some card positions unpublished':'');
  const open = new Set([...$('fights').querySelectorAll('details[open]')].map(d=>d.closest('article').dataset.id+'/'+d.dataset.section));
  $('fights').innerHTML = bouts.length ? cardResearchSummary(bouts)+bouts.map(renderFight).join('') : '<div class="panel empty"><h2>No matching fights</h2>Try another fighter, weight class or card segment.<br><button type="button" data-reset>Clear filters</button></div>';
  for (const d of $('fights').querySelectorAll('details')) d.open = open.has(d.closest('article').dataset.id+'/'+d.dataset.section);
}
function select() {
  active = $('event').value;
  const event = events.find(e=>String(e.id)===active);
  if (!event) return;
  if (filter!=='all' && !event.competitions.some(c=>tier(c)===filter)) filter='all';
  $('status').textContent = (event.name||'UFC event')+' · '+dateText(event.date)+' · '+event.competitions.length+' listed fights';
  const venue = event.venues?.[0] || event.competitions.find(c=>c.venue)?.venue || {};
  const location = [venue.address?.city, venue.address?.state || venue.address?.country].filter(Boolean).join(', ');
  $('event-info').innerHTML = '<div class="event-facts"><div><strong>VENUE</strong>'+escape(venue.fullName||'To be announced')+(location?' · '+escape(location):'')+'</div><div><strong>TIME ZONE</strong>'+escape(Intl.DateTimeFormat().resolvedOptions().timeZone)+'</div><div><strong>RESEARCH COVERAGE</strong>'+event.competitions.filter(c=>c.competitors?.length===2 && c.competitors.every(x=>Object.keys(METRICS).every(k=>numeric(fighterStats(x)[k])!==null))).length+' / '+event.competitions.length+' complete matchups</div></div>';
  show();
}
async function request(url, timeout = 12000) {
  const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),timeout);
  try {const r = await fetch(url,{cache:'no-store',signal:controller.signal});if(!r.ok)throw new Error('HTTP '+r.status);return await r.json();} finally {clearTimeout(timer);}
}
async function researchCache() {
  cache = {}; cacheDate = ''; cacheBouts = [];
  try {
    const data = await request('./ufc_fighter_data.json',6000);
    const age = Date.now()-Date.parse(data.generated_at);
    if (!Number.isFinite(age) || age< -86400000 || age>30*86400000 || !data.source || !data.fighters || Array.isArray(data.fighters)) throw new Error('Missing provenance or outdated cache');
    cache = Object.fromEntries(Object.entries(data.fighters).filter(([,p])=>p && typeof p.stats==='object').map(([name,p])=>[nameKey(name),p]));
    cacheDate = data.generated_at;
    cacheBouts = Array.isArray(data.bouts)?data.bouts:[];
  } catch (_) {/* Provider metrics can still be used without the optional cache. */}
  $('research-status').textContent = cacheDate ? Object.keys(cache).length+' fighter profiles, including available partial data · cache updated '+dateText(cacheDate)+'. Cache profiles older than 30 days are excluded.' : 'No current fighter research cache is available. Provider-supplied statistics still appear; incomplete matchups stay PASS.';
}
async function publicHistoryCache() {
  publicHistory={};
  try{
    const data=await request('./ufc_history_data.json',6000);
    if(!data.source||!data.fighters||Array.isArray(data.fighters))return;
    for(const [id,p] of Object.entries(data.fighters)){
      if(!p||typeof p!=='object')continue;
      if(String(p.id)===String(id)&&(freshHistorySource(p.history_fetched_at)||freshHistorySource(p.method_record_fetched_at)))publicHistory[id]=p;
    }
  }catch(_){/* The original fighter cache remains available. */}
}
function cachedSchedule(data) {
  const age = Date.now()-Date.parse(data?.generated_at);
  if (!Number.isFinite(age)||age< -86400000||age>7*86400000) return [];
  return eventsFrom(data).filter(e=>Date.parse(e.date)>Date.now()-7*86400000);
}
async function load() {
  const run = ++generation, previous = active;
  $('refresh').disabled = true; $('refresh').textContent = 'Refreshing…';
  $('fights').setAttribute('aria-busy','true'); $('status').textContent='Loading UFC schedule…';
  $('feed-notice').hidden = true;
  try {
    const scheduleTask = request(scheduleUrl()).then(data=>{if(!eventsFrom(data).length)throw new Error('No published events');return {data,source:'live'};}).catch(async()=>{
      const candidates = [read(SCHEDULE_KEY,null)];
      try {candidates.push(await request('./ufc_schedule.json',6000));} catch (_) {}
      for (const data of candidates.filter(Boolean).sort((a,b)=>Date.parse(b.generated_at)-Date.parse(a.generated_at))) {
        try {if(cachedSchedule(data).length)return {data,source:'saved'};} catch (_) {}
      }
      throw new Error('The live provider could not be reached and no recent saved schedule is available.');
    });
    const [schedule] = await Promise.all([scheduleTask,researchCache(),publicHistoryCache()]);
    if (run!==generation) return;
    const next = eventsFrom(schedule.data);
    if (!next.length) throw new Error('No UFC cards are currently published in the next six weeks.');
    events = next.map(event=>({...event,competitions:event.competitions.map(c=>{
      const bout=cacheBouts.find(b=>String(b.event_id)===String(event.id)&&String(b.bout_id)===String(c.id));
      const segment=({main:'main',prelim:'prelim',prelims:'prelim',prelims1:'prelim',prelims2:'prelim',early:'early',early_prelims:'early',early_prelim:'early'})[bout?.card_segment];
      return {...c,...(segment?{cardSegment:segment==='main'?'Main Card':segment==='early'?'Early Prelims':'Prelims'}:{}),...(Number(bout?.scheduled_rounds)===3||Number(bout?.scheduled_rounds)===5?{scheduledRounds:Number(bout.scheduled_rounds)}:{})};
    })})); loaded = true;
    if(schedule.source==='live')save(SCHEDULE_KEY,{events,generated_at:new Date().toISOString()});
    $('event').innerHTML=events.map(e=>'<option value="'+escape(e.id)+'">'+escape(e.name||'UFC event')+' · '+escape(dateText(e.date,{month:'short',day:'numeric'}))+'</option>').join('');
    $('event').disabled = false;
    const upcoming = events.find(e=>e.status?.type?.state==='in') || events.find(e=>Date.parse(e.date)>=Date.now()-12*3600000) || events[events.length-1];
    $('event').value=events.some(e=>String(e.id)===previous)?previous:String(upcoming.id);
    if(schedule.source==='saved') {$('feed-notice').hidden=false;$('feed-notice').textContent='Saved schedule · last fetched '+dateText(schedule.data.generated_at)+'. Live provider unavailable. Bout changes and results may be out of date; refresh to retry.';}
    select();
  } catch (error) {
    if (run!==generation) return;
    $('feed-notice').hidden=false;$('feed-notice').textContent=error.message;
    if(loaded){select();$('feed-notice').textContent+=' Showing the previously loaded card; it may be out of date.';}
    else {$('event').innerHTML='<option>Schedule unavailable</option>';$('event').disabled=true;$('status').textContent='Could not load the UFC schedule.';$('fight-count').textContent='';$('fights').innerHTML='<div class="panel empty"><h2>The card is taking a corner break.</h2>The event provider is unavailable. No placeholder fights or results are shown.<br><button type="button" data-retry>Try again</button></div>';}
  } finally {if(run===generation){$('refresh').disabled=false;$('refresh').textContent='↻ Refresh';$('fights').setAttribute('aria-busy','false');}}
}
$('event').addEventListener('change',select);
$('refresh').addEventListener('click',load);
$('search').addEventListener('input',()=>{query=$('search').value;if(events.length)show();});
$('sort').addEventListener('change',()=>{order=$('sort').value;if(events.length)show();});
$('filters').addEventListener('click',e=>{const b=e.target.closest('button[data-filter]');if(b&&!b.disabled){filter=b.dataset.filter;if(events.length)show();}});
$('fights').addEventListener('click',e=>{if(e.target.closest('[data-retry]'))load();if(e.target.closest('[data-reset]')){filter='all';query='';$('search').value='';show();}});
$('fights').addEventListener('change',e=>{
  if(!e.target.matches('.ufc-total-line'))return;
  const key=e.target.dataset.bout,c=findCurrentBout(key);
  if(!c)return;
  const value=Number(e.target.value);
  if(!root.UFCPropResearch.availableLines(confirmedRounds(c)).includes(value))return;
  storedProps(key).line=value;save(PROP_KEY,propInputs);
  const fighters=[...(c.competitors||[])].sort((a,b)=>(a.order||0)-(b.order||0)).slice(0,2);
  while(fighters.length<2)fighters.push({});
  e.target.closest('.prop-root').innerHTML=propResearchBody(fighters,c);
});
$('fights').addEventListener('input',e=>{
  if(!e.target.matches('.ufc-prop-price'))return;
  const key=e.target.dataset.bout,quote=e.target.dataset.quote;
  if(!findCurrentBout(key)||!/^total:(0\.5|1\.5|2\.5|3\.5|4\.5):(over|under)$|^method:[01]:(ko|submission|decision)$/.test(quote))return;
  const value=e.target.value.replace(/−/g,'-');storedProps(key)[quote]=value;save(PROP_KEY,propInputs);
  const out=[...e.target.closest('.prop-root').querySelectorAll('[data-quote-result]')].find(x=>x.dataset.quoteResult===quote);
  if(out)out.textContent=breakEvenText(value);
});
$('fights').addEventListener('input',e=>{
  if(!e.target.matches('.ufc-odds'))return;
  const key=e.target.dataset.bout, side=e.target.dataset.side;
  if(!Object.hasOwn(odds,key))odds[key]={};
  odds[key][side]=e.target.value.replace(/−/g,'-');save(ODDS_KEY,odds);
  const out=[...$('fights').querySelectorAll('[data-market]')].find(x=>x.dataset.market===key);
  if(out)out.innerHTML=marketResult(key);
});
load();
})(typeof globalThis!=='undefined'?globalThis:this);
