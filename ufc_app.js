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
    result[key] = numeric(value);
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
const ODDS_KEY = 'prop-shop-ufc-odds-v1', SCHEDULE_KEY = 'prop-shop-ufc-schedule-v1';
function read(key, fallback) {try {return JSON.parse(localStorage.getItem(key)) ?? fallback;} catch (_) {return fallback;}}
function save(key, value) {try {localStorage.setItem(key, JSON.stringify(value));} catch (_) {/* Storage may be disabled. */}}
const storedOdds = read(ODDS_KEY, {});
let odds = storedOdds && typeof storedOdds === 'object' && !Array.isArray(storedOdds) ? storedOdds : {};
let events = [], active = '', filter = 'all', query = '', order = 'time', cache = {}, cacheDate = '', generation = 0, loaded = false;
const labels = {early:'EARLY PRELIMS',prelim:'PRELIMS',main:'MAIN CARD',unknown:'CARD POSITION UNVERIFIED'};
const dateText = (value, options = {dateStyle:'medium',timeStyle:'short'}) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(undefined, options) : 'Time TBA';
const fighterName = c => c?.athlete?.displayName || c?.athlete?.fullName || c?.displayName || 'Fighter TBD';
const boutKey = c => String(active)+':'+String(c.id || (c.competitors || []).map(x => x.id || nameKey(fighterName(x))).sort().join('|'));
function profileFor(c) {return cache[nameKey(fighterName(c))] || {};}
function fighterStats(c) {return {...statsFrom(c), ...(profileFor(c).stats || {})};}
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
  const result = fighters.length === 2 && root.UFCResearch ? root.UFCResearch.evaluate(...fighters.map(fighterStats)) : {status:'insufficient_data',reason:'Two confirmed fighters and the research engine are required.'};
  if (result.status !== 'experimental') return '<span class="pass">PASS · INSUFFICIENT VERIFIED DATA</span><p class="muted">'+escape(result.reason)+'</p><p class="muted">Open Fighter comparison to see which metrics are available.</p>';
  const features = Object.entries(result.features).map(([k,v]) => k+': '+(v>=0?'+':'')+v.toFixed(2)).join(' · ');
  return '<span class="pass">EXPERIMENTAL · UNVALIDATED</span><div class="grid" style="margin-top:14px">'+fighters.map((c,i)=>'<div class="stat"><span>'+escape(fighterName(c))+'</span><strong>'+(result.probabilities[i]*100).toFixed(1)+'%</strong><span>Experimental win estimate</span></div>').join('')+'</div><p class="muted">'+escape(features)+'. Positive feature scores favor '+escape(fighterName(fighters[0]))+'.</p><p class="muted">'+result.draws.toLocaleString()+' seeded draws. First fighter simulation interval: '+result.simulationInterval.map(x=>(x*100).toFixed(1)+'%').join('–')+'. This interval measures simulation sampling error only. The heuristic has not been calibrated or backtested and does not establish betting value.</p>';
}
function marketResult(key) {
  const prices = odds[key] || {}, result = market(prices.a, prices.b);
  if (!result) return '<p class="muted">'+(prices.a || prices.b ? 'Enter valid American odds for both fighters, such as −125 and +105 (whole numbers with absolute value of at least 100).' : 'Enter both sportsbook prices to compare implied probabilities and the margin.')+'</p>';
  return '<div class="grid">'+result.fair.map((p,i)=>'<div class="stat"><span>Fighter '+(i===0?'1':'2')+' · no-vig baseline</span><strong>'+(p*100).toFixed(1)+'%</strong><span>Raw implied '+(result.implied[i]*100).toFixed(1)+'%</span></div>').join('')+'</div><p class="muted">Bookmaker margin: '+(result.margin*100).toFixed(2)+' percentage points.'+(result.margin < 0 ? ' These prices form an underround; check that both are current and from the same market.' : '')+' These market-derived numbers are not independent fight predictions.</p>';
}
function renderFight(c) {
  const fighters = [...(c.competitors || [])].sort((a,b)=>(a.order||0)-(b.order||0));
  while (fighters.length < 2) fighters.push({});
  const two = fighters.slice(0,2), key = boutKey(c), prices = odds[key] || {};
  const state = c.status?.type || {}, completed = state.completed || state.state === 'post';
  const isLive = state.state === 'in';
  const outcome = completed ? state.detail || state.description || 'Final' : isLive ? [state.description, c.status?.period ? 'Round '+c.status.period : '', c.status?.displayClock].filter(Boolean).join(' · ') : dateText(c.date || c.startDate);
  const meta = [c.type?.abbreviation || c.type?.text, c.format?.regulation?.periods ? c.format.regulation.periods+' rounds' : '', c.broadcast || c.broadcasts?.flatMap(x=>x.names||[]).join(', ')].filter(Boolean).join(' · ');
  return '<article class="panel fight" data-id="'+escape(key)+'"><div class="fight-top"><span class="badge">'+labels[tier(c)]+'</span><span class="badge '+(isLive?'live':completed?'result':'')+'">'+(isLive?'● LIVE':completed?'FINAL':'SCHEDULED')+'</span></div><div class="matchup">'+two.map((x,i)=>(i?'<div class="vs">VS</div>':'')+'<div class="fighter"><div class="avatar" aria-hidden="true">'+escape(initials(fighterName(x)))+'</div><h3>'+escape(fighterName(x))+'</h3><p class="muted">'+escape(recordFor(x))+'</p>'+(completed&&x.winner?'<span class="winner">WINNER</span>':'')+'</div>').join('')+'</div><div class="bout-meta">'+escape(meta)+'<br>'+escape(outcome)+'</div><details data-section="comparison"><summary>Fighter comparison</summary><div class="detail-body">'+comparison(two)+'</div></details><details data-section="analysis"><summary>Independent matchup research</summary><div class="detail-body">'+analysis(two)+'</div></details><details data-section="market"><summary>Moneyline comparison</summary><div class="detail-body"><div class="grid">'+two.map((x,i)=>'<label class="odds-label">'+(i+1)+'. '+escape(fighterName(x))+'<input type="text" inputmode="text" autocomplete="off" spellcheck="false" class="ufc-odds" data-bout="'+escape(key)+'" data-side="'+(i?'b':'a')+'" value="'+escape(prices[i?'b':'a'] || '')+'" placeholder="'+(i?'+105':'−125')+'" aria-label="'+escape(fighterName(x))+' American moneyline odds"></label>').join('')+'</div><div class="market-result" aria-live="polite" data-market="'+escape(key)+'">'+marketResult(key)+'</div><p class="muted small">Use American moneyline odds for the same two-way market. Saved on this device.</p></div></details></article>';
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
  $('fights').innerHTML = bouts.length ? bouts.map(renderFight).join('') : '<div class="panel empty"><h2>No matching fights</h2>Try another fighter, weight class or card segment.<br><button type="button" data-reset>Clear filters</button></div>';
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
  cache = {}; cacheDate = '';
  try {
    const data = await request('./ufc_fighter_data.json',6000);
    const age = Date.now()-Date.parse(data.generated_at);
    if (!Number.isFinite(age) || age< -86400000 || age>30*86400000 || !data.source || !data.fighters || Array.isArray(data.fighters)) throw new Error('Missing provenance or outdated cache');
    cache = Object.fromEntries(Object.entries(data.fighters).filter(([,p])=>p && typeof p.stats==='object').map(([name,p])=>[nameKey(name),p]));
    cacheDate = data.generated_at;
  } catch (_) {/* Provider metrics can still be used without the optional cache. */}
  $('research-status').textContent = cacheDate ? Object.keys(cache).length+' cached fighter profiles · updated '+dateText(cacheDate)+'. Cache profiles older than 30 days are excluded.' : 'No current fighter research cache is available. Provider-supplied statistics still appear; incomplete matchups stay PASS.';
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
    const [schedule] = await Promise.all([scheduleTask,researchCache()]);
    if (run!==generation) return;
    const next = eventsFrom(schedule.data);
    if (!next.length) throw new Error('No UFC cards are currently published in the next six weeks.');
    events = next; loaded = true;
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
