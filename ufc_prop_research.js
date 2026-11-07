/* Source-backed alternate-market research. Historical frequencies are not
   calibrated probabilities for the current fight and never establish value. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.UFCPropResearch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';
const METHODS = [
  {key:'ko', label:'KO/TKO', win:'wins_ko', loss:'losses_ko'},
  {key:'submission', label:'Submission', win:'wins_sub', loss:'losses_sub'},
  {key:'decision', label:'Decision', win:'wins_dec', loss:'losses_dec'}
];
const count = value => typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0 ? value : null;
function numeric(value) {
  if (!['number','string'].includes(typeof value) || String(value).trim()==='') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
const keyName = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toLowerCase();
function text(value) {return typeof value==='string' || typeof value==='number' ? String(value) : '';}
function roundFormat(value) {const n=numeric(value);return n===3||n===5?n:null;}
function availableLines(rounds) {rounds=roundFormat(rounds);return rounds===3?[0.5,1.5,2.5]:rounds===5?[0.5,1.5,2.5,3.5,4.5]:[];}
function methodKind(row) {
  const source = [text(row?.method),text(row?.method_display)].join(' ').toLowerCase().replace(/[-_]+/g,' ');
  if (/\b(draw|nc|no contest|overturned|disqualification|disqualified|dq)\b/.test(source) || /technical\s+decision|decision\s+technical/.test(source)) return null;
  if (/\b(ko|tko|kotko|knockout)\b/.test(source) || /ko\s*\/\s*tko/.test(source)) return 'ko';
  if (/\b(sub|submission)\b/.test(source)) return 'submission';
  if (/\b(decision|unanimous|split|majority)\b/.test(source)) return 'decision';
  return null;
}
function actualSeconds(row, scheduledRounds) {
  const endRound=numeric(row?.end_round);
  const clock=typeof row?.end_clock==='string'?row.end_clock.trim():'';
  const match=/^(\d{1,2}):(\d{2})$/.exec(clock);
  if (!Number.isInteger(endRound) || endRound<1 || endRound>scheduledRounds || !match) return null;
  const minutes=Number(match[1]), seconds=Number(match[2]);
  if (seconds>59 || minutes>5 || minutes===5&&seconds!==0) return null;
  const duration=(endRound-1)*300+minutes*60+seconds;
  return duration>0&&duration<=scheduledRounds*300?duration:null;
}
function eventCutoff(options) {
  if (options.eventDate===undefined) return Date.now();
  if (options.eventDate===null || options.eventDate==='') return NaN;
  return Date.parse(options.eventDate);
}
function rowDate(row, cutoff) {
  const precise=text(row?.starts_at).trim();
  if (precise) {
    const parsed=Date.parse(precise);
    return Number.isFinite(parsed)?parsed:null;
  }
  const date=text(row?.event_date).trim();
  const parsed=Date.parse(date);
  if (!date || !Number.isFinite(parsed)) return null;
  // A date-only result on the target event's date cannot establish ordering.
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date===new Date(cutoff).toISOString().slice(0,10)) return null;
  return parsed;
}
function identity(row, profile, name) {
  const id=text(profile?.id), a=text(row?.fighter_a), b=text(row?.fighter_b);
  let side=id&&id===a?0:id&&id===b?1:null;
  if (side===null) {
    const normalized=keyName(profile?.name || name);
    const names=[keyName(row?.fighter_a_name),keyName(row?.fighter_b_name)];
    if (normalized && names.filter(n=>n===normalized).length===1) side=names.indexOf(normalized);
  }
  const winner=text(row?.winner), normalized=keyName(winner);
  let winnerSide=null;
  if (winner && a && winner===a) winnerSide=0;
  else if (winner && b && winner===b) winnerSide=1;
  else if (normalized==='a') winnerSide=0;
  else if (normalized==='b') winnerSide=1;
  else if (normalized && normalized===keyName(row?.fighter_a_name) && normalized!==keyName(row?.fighter_b_name)) winnerSide=0;
  else if (normalized && normalized===keyName(row?.fighter_b_name) && normalized!==keyName(row?.fighter_a_name)) winnerSide=1;
  return {side,winnerSide};
}
function boutIdentity(row) {
  const id=text(row?.bout_id).trim();
  if (id) return id;
  const competitors=[text(row?.fighter_a)||keyName(row?.fighter_a_name),text(row?.fighter_b)||keyName(row?.fighter_b_name)];
  const date=text(row?.starts_at)||text(row?.event_date);
  if (competitors.every(Boolean) && date && row?.event_id) return [row.event_id,date,...competitors.sort()].join('|');
  return null;
}
function commonHistory(row, profile, name, options, cutoff) {
  if (!row || typeof row!=='object') return {reason:'invalid_row'};
  const id=boutIdentity(row);
  if (!id) return {reason:'missing_bout_identity'};
  if (options.boutId!==undefined && String(options.boutId)===text(row.bout_id)) return {reason:'current_bout'};
  if (String(row.status || '').toLowerCase()!=='final') return {reason:'not_final'};
  const date=rowDate(row,cutoff);
  if (date===null) return {reason:'unknown_date'};
  if (date>=cutoff) return {reason:'not_before_event'};
  const resolved=identity(row,profile,name);
  if (resolved.side===null) return {reason:'unresolved_fighter'};
  if (resolved.winnerSide===null) return {reason:'ambiguous_outcome'};
  const method=methodKind(row);
  if (!method) return {reason:'ambiguous_method'};
  return {id,date,method,won:resolved.side===resolved.winnerSide};
}
const rates = (over,under) => ({sample:over+under,over,under,overRate:over+under?over/(over+under):null,underRate:over+under?under/(over+under):null});
function totalsResearch(profiles,names,options,cutoff) {
  const rounds=roundFormat(options.rounds);
  const line=options.line===undefined?(rounds?2.5:null):numeric(options.line);
  const thresholdSeconds=line===null?null:line*300;
  const fighters=names.map((name,side)=>({side,name,...rates(0,0),excluded:{}}));
  const result={status:'insufficient_data',rounds,line,thresholdSeconds,lean:null,heading:'No total-rounds lean',summary:'',pooled:rates(0,0),fighters,cautions:[
    'These are frequencies in the available recorded fights, not win probabilities for the current total-rounds market.',
    'Only completed fights with the same confirmed scheduled length and a usable finish time are counted. Exact-threshold finishes and ambiguous settlements are excluded.',
    'The sample can be small or selective; no betting edge or preferred sportsbook price is established.'
  ]};
  if (!rounds) {result.status='unknown_rounds';result.summary='Confirm whether this is a three- or five-round fight before researching its total.';return result;}
  if (!availableLines(rounds).includes(line)) {result.status='invalid_line';result.summary='Choose a valid half-round line below the confirmed '+rounds+'-round distance.';return result;}
  if (!Number.isFinite(cutoff)) {result.status='invalid_event_date';result.summary='The event start time is unavailable, so pre-fight historical samples cannot be verified.';return result;}
  const eligible=[new Map(),new Map()];
  const exclude=(side,reason)=>{fighters[side].excluded[reason]=(fighters[side].excluded[reason]||0)+1;};
  for(let side=0;side<2;side++) {
    const history=Array.isArray(profiles[side]?.recent_fights)?profiles[side].recent_fights:[];
    for(const row of history) {
      const item=commonHistory(row,profiles[side],names[side],options,cutoff);
      if(item.reason){exclude(side,item.reason);continue;}
      const scheduled=roundFormat(row.scheduled_rounds);
      if(!scheduled){exclude(side,'unknown_scheduled_rounds');continue;}
      if(scheduled!==rounds){exclude(side,'different_scheduled_length');continue;}
      const seconds=actualSeconds(row,scheduled);
      if(seconds===null){exclude(side,'unknown_finish_time');continue;}
      if(item.method==='decision'&&seconds!==scheduled*300){exclude(side,'inconsistent_decision_time');continue;}
      if(seconds===thresholdSeconds){exclude(side,'exact_threshold');continue;}
      const previous=eligible[side].get(item.id);
      if(previous) {
        if(previous.seconds!==seconds || previous.method!==item.method) {
          previous.conflict=true;exclude(side,'conflicting_history');
        } else exclude(side,'duplicate_bout');
        continue;
      }
      eligible[side].set(item.id,{...item,seconds,over:seconds>thresholdSeconds});
    }
  }
  const pool=new Map();
  const conflicted=new Set();
  for(let side=0;side<2;side++)for(const [id,item] of eligible[side]) {
    const previous=pool.get(id);
    if(item.conflict || previous&&(previous.seconds!==item.seconds || previous.method!==item.method))conflicted.add(id);
    if(!previous)pool.set(id,item);
  }
  for(const id of conflicted) {
    pool.delete(id);
    for(let side=0;side<2;side++)if(eligible[side].delete(id))exclude(side,'conflicting_history');
  }
  for(let side=0;side<2;side++) {
    const over=[...eligible[side].values()].filter(x=>x.over).length;
    Object.assign(fighters[side],rates(over,eligible[side].size-over));
  }
  const over=[...pool.values()].filter(x=>x.over).length;
  result.pooled=rates(over,pool.size-over);
  const enough=fighters.every(x=>x.sample>=3)&&pool.size>=6;
  if(enough&&fighters.every(x=>x.overRate>0.5)&&result.pooled.overRate>=0.6)result.lean='over';
  else if(enough&&fighters.every(x=>x.underRate>0.5)&&result.pooled.underRate>=0.6)result.lean='under';
  if(result.lean) {
    result.status='historical_lean';
    result.heading=(result.lean==='over'?'Over ':'Under ')+line+' · historical research lean';
    result.summary='Both fighters’ eligible histories support this direction. '+result.pooled[result.lean]+' of '+pool.size+' unique recorded fights finished '+result.lean+' '+line+' rounds. This is a historical tendency, not a calibrated prediction.';
  } else if(!enough) {
    result.summary='No total-rounds lean: at least three eligible fights per fighter and six unique fights combined are required. Available: '+fighters.map(x=>x.name+' '+x.sample).join('; ')+', '+pool.size+' unique combined.';
  } else {
    result.status='mixed_history';
    result.summary='No consistent total-rounds lean. The histories do not both favor the same side with at least 60% combined support; compare the counts rather than forcing a selection.';
  }
  return result;
}
function normalRecord(raw) {
  const record={wins:count(raw?.wins),losses:count(raw?.losses)};
  for(const method of METHODS){record[method.win]=count(raw?.[method.win]);record[method.loss]=count(raw?.[method.loss]);}
  const invalid={wins:false,losses:false};
  for(const [denominator,field] of [['wins','win'],['losses','loss']]) {
    const counts=METHODS.map(m=>record[m[field]]).filter(v=>v!==null);
    if(record[denominator]!==null&&counts.reduce((a,b)=>a+b,0)>record[denominator]) {
      invalid[denominator]=true;
      for(const m of METHODS)record[m[field]]=null;
    }
  }
  return {record,invalid};
}
function methodRecord(profile,name,options,cutoff) {
  const explicit=profile?.method_record&&typeof profile.method_record==='object'&&!Array.isArray(profile.method_record);
  const supplied=explicit?profile.method_record:profile?.ufc_record;
  if(supplied&&typeof supplied==='object'&&!Array.isArray(supplied)&&(explicit||Object.keys(supplied).length)) {
    // Explicit method records can cover all professional MMA while ufc_record
    // covers only the provider's promotion dataset. Never fill across scopes.
    const scope=explicit?text(profile.method_record_scope).trim()||'unknown':'provider_promotion';
    const source=explicit?scope==='overall_professional'?'overall_professional':'provided_record':'career_record';
    const sourceLabel=explicit?text(profile.method_record_source).trim()||'Supplied method record':'FighterAPI provider record';
    const scopeLabel=scope==='overall_professional'?'Overall professional record':scope==='provider_promotion'?'Provider promotion record':scope==='ufc'?'UFC record':scope==='unknown'?'Record scope not supplied':scope.replace(/_/g,' ');
    const fetchedAt=explicit?profile.method_record_fetched_at:profile.fetched_at;
    const fetched=Date.parse(fetchedAt);
    const afterEvent=Number.isFinite(cutoff)&&Number.isFinite(fetched)&&fetched>cutoff;
    return {...normalRecord(supplied),source,scope,sourceLabel,scopeLabel,fetchedAt:text(fetchedAt)||null,sample:null,afterEvent};
  }
  const record={wins:0,losses:0,wins_ko:0,wins_sub:0,wins_dec:0,losses_ko:0,losses_sub:0,losses_dec:0};
  const seen=new Map();
  const history=Array.isArray(profile?.recent_fights)?profile.recent_fights:[];
  if(Number.isFinite(cutoff))for(const row of history) {
    const item=commonHistory(row,profile,name,options,cutoff);
    if(item.reason)continue;
    const previous=seen.get(item.id);
    if(previous) {
      if(previous.method!==item.method || previous.won!==item.won)previous.conflict=true;
      continue;
    }
    seen.set(item.id,item);
  }
  const eligible=[...seen.values()].filter(item=>!item.conflict);
  for(const item of eligible) {
    const method=METHODS.find(m=>m.key===item.method), outcome=item.won?'wins':'losses';
    record[outcome]++;
    record[item.won?method.win:method.loss]++;
  }
  return eligible.length?{...normalRecord(record),source:'recent_results',scope:'recent_results',scopeLabel:'Available recent results',sourceLabel:'Recorded bout results',fetchedAt:null,sample:eligible.length,afterEvent:false}:{...normalRecord({}),source:'unavailable',scope:'unavailable',scopeLabel:'Unavailable',sourceLabel:'Not supplied',fetchedAt:null,sample:0,afterEvent:false};
}
function methodResearch(profiles,names,options,cutoff) {
  const source=profiles.map((p,i)=>methodRecord(p,names[i],options,cutoff));
  return names.map((name,side)=>{
    const own=source[side],opponent=source[1-side];
    const rows=METHODS.map(method=>{
      const winCount=own.record[method.win],totalWins=own.record.wins;
      const opponentLossCount=opponent.record[method.loss],totalOpponentLosses=opponent.record.losses;
      const winShare=winCount!==null&&totalWins!==null&&totalWins>0?winCount/totalWins:null;
      const opponentLossShare=opponentLossCount!==null&&totalOpponentLosses!==null&&totalOpponentLosses>0?opponentLossCount/totalOpponentLosses:null;
      const sameScope=own.scope===opponent.scope&&!['unknown','unavailable'].includes(own.scope);
      const candidate=sameScope&&Number.isFinite(cutoff)&&!own.afterEvent&&!opponent.afterEvent&&totalWins>=3&&totalOpponentLosses>=3&&winShare>0.5&&opponentLossShare>0.5;
      let reason;
      if(winShare===null||opponentLossShare===null)reason='A usable win-method count and opposing loss-method count are both required. Missing counts stay unavailable; a zero-win or zero-loss record has no conditional share.';
      else if(!sameScope)reason='The win and opposing loss records cover different or unconfirmed competition scopes ('+own.scopeLabel+' versus '+opponent.scopeLabel+'). Counts stay separate; no method angle is selected across those scopes.';
      else if(candidate)reason=method.label+' accounts for '+winCount+' of '+totalWins+' recorded wins for '+name+' and '+opponentLossCount+' of '+totalOpponentLosses+' recorded losses for '+names[1-side]+'. This supports researching that route, not a forecast or betting edge.';
      else if(own.afterEvent||opponent.afterEvent)reason='These record counts were fetched after the target event start. They are shown as current context, not a verified pre-fight method angle.';
      else if(totalWins<3||totalOpponentLosses<3)reason='The counts are useful context, but fewer than three recorded wins or three opposing losses leave too little evidence to rank this angle.';
      else reason='The recorded win methods and opposing loss methods do not both concentrate on this outcome. No supported method angle is selected.';
      return {key:method.key,label:method.label,winCount,totalWins,winShare,opponentLossCount,totalOpponentLosses,opponentLossShare,candidate,reason,recordSource:own.source,opponentRecordSource:opponent.source,recordScope:own.scope,opponentRecordScope:opponent.scope,recordScopeLabel:own.scopeLabel,opponentRecordScopeLabel:opponent.scopeLabel,recordSourceLabel:own.sourceLabel,opponentRecordSourceLabel:opponent.sourceLabel,recordFetchedAt:own.fetchedAt,opponentRecordFetchedAt:opponent.fetchedAt};
    });
    const candidate=rows.find(x=>x.candidate)||null;
    const any=rows.some(x=>x.winCount!==null||x.opponentLossCount!==null);
    const cautions=['Win-method shares are conditional on recorded wins; opposing method shares are conditional on recorded losses. Neither is the probability of this fighter winning by that method.', 'The three method rows omit draws and other outcomes. They must not be normalized into an exhaustive market or treated as validated betting probabilities.'];
    if(own.invalid.wins||opponent.invalid.losses)cautions.unshift('Some method counts exceed the corresponding record total. Those inconsistent counts are withheld.');
    if(own.scope!==opponent.scope&&own.source!=='unavailable'&&opponent.source!=='unavailable')cautions.unshift('The two records cover different competition scopes. Their counts are shown separately without a method angle.');
    if(own.source==='recent_results'||opponent.source==='recent_results')cautions.unshift('At least one side uses only the available recent-results sample, not a complete career record.');
    if(own.afterEvent||opponent.afterEvent)cautions.unshift('Record counts are not verified as pre-event snapshots for this selected event.');
    return {side,name,status:candidate?'research_angle':any?'evidence_only':'insufficient_data',heading:candidate?name+' by '+candidate.label+' · research angle':'Method evidence: '+name,summary:candidate?candidate.reason:any?'Compare how this fighter has won with how the opponent has lost. These are recorded counts, not probabilities for this matchup.':'Win-method counts and opposing loss-method counts have not been supplied. Career striking volume and submission attempts cannot replace actual finish records.',candidate:candidate?.key||null,recordSource:own.source,opponentRecordSource:opponent.source,recordScope:own.scope,opponentRecordScope:opponent.scope,recordScopeLabel:own.scopeLabel,opponentRecordScopeLabel:opponent.scopeLabel,recordSourceLabel:own.sourceLabel,opponentRecordSourceLabel:opponent.sourceLabel,recordFetchedAt:own.fetchedAt,opponentRecordFetchedAt:opponent.fetchedAt,recordSample:own.sample,opponentRecordSample:opponent.sample,rows,cautions};
  });
}
function research(profiles,options={}) {
  const pair=[0,1].map(i=>profiles?.[i]&&typeof profiles[i]==='object'?profiles[i]:{});
  const names=[0,1].map(i=>typeof options.names?.[i]==='string'&&options.names[i].trim()?options.names[i].trim():text(pair[i].name)||'Fighter '+(i+1));
  const cutoff=eventCutoff(options);
  return {totals:totalsResearch(pair,names,options,cutoff),methods:methodResearch(pair,names,options,cutoff),cautions:[
    'Alternate markets can carry more risk than a moneyline and are not automatically better value.',
    'The winner lean is not converted into round or method probabilities. Sportsbook prices do not enter this research.'
  ]};
}
return {research,availableLines,actualSeconds,methodKind};
});
