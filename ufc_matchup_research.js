/* Explain the existing experimental career-rate heuristic without using odds.
   Observed rates are facts; matchup advantages and possible routes are inferences. */
(function (root, factory) {
  const engine = typeof module === 'object' && module.exports ? require('./ufc_research_engine.js') : root.UFCResearch;
  const api = factory(engine);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.UFCMatchupResearch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (engine) {
'use strict';
const METRICS = {
  slpm: 'Significant strikes landed per minute',
  sapm: 'Significant strikes absorbed per minute',
  strAcc: 'Striking accuracy',
  strDef: 'Striking defense',
  tdAvg: 'Takedowns per 15 minutes',
  tdAcc: 'Takedown accuracy',
  tdDef: 'Takedown defense',
  subAvg: 'Submission attempts per 15 minutes'
};
const PERCENT = new Set(['strAcc', 'strDef', 'tdAcc', 'tdDef']);
function number(value, key) {
  if (!['number','string'].includes(typeof value) || String(value).trim() === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || PERCENT.has(key) && n > 100) return null;
  return n;
}
function normalize(stats) {
  return Object.fromEntries(Object.keys(METRICS).map(key => [key, number(stats?.[key], key)]));
}
const format = value => value === null ? 'unavailable' : Number(value.toFixed(2)).toString();
const percent = value => value === null ? 'unavailable' : format(value)+'%';
const has = (stats, keys) => keys.every(key => stats[key] !== null);
const signSide = value => Math.abs(value) < 1e-10 ? null : value > 0 ? 0 : 1;
const allHave = (stats, keys) => stats.every(s => has(s,keys));
function facts(stats, names, keys, describe) {
  return stats.map((s,i) => names[i]+': '+keys.filter(k=>s[k]!==null).map(k=>describe(k,s[k])).join(', ')+(keys.every(k=>s[k]===null)?'no supplied rates for this area':'')).join('. ')+'.';
}
function area(title, keys, stats, names, value, weight, observed, inference, complete=allHave(stats, keys)) {
  const side = complete ? signSide(value) : null;
  return {
    title, side, complete,
    summary: observed+' '+(complete ? side === null ? 'This component is level in the career-rate heuristic.' : 'Inference: this component favors '+names[side]+'.' : 'The missing opposing rates prevent a complete comparison in this area.'),
    contribution: complete ? value*weight : null,
    route: complete && side !== null ? inference(side) : null
  };
}
function describe(a,b,options={}) {
  const names = [0,1].map(i => typeof options.names?.[i] === 'string' && options.names[i].trim() ? options.names[i].trim() : 'Fighter '+(i+1));
  // Historical comparisons must never reuse career aggregates captured after
  // the bout. A pre-fight timestamp is required for each supplied profile.
  const cutoff=typeof options.asOf==='string'&&Number.isFinite(Date.parse(options.asOf))?Date.parse(options.asOf):null;
  const raw=[a,b];
  const effectiveRaw=raw.map((value,i)=>{
    if(cutoff===null)return value;
    const profile=options.profiles?.[i];
    const stamp=profile?.stats_as_of||profile?.snapshot_at||profile?.fetched_at;
    const timestamp=typeof stamp==='string'?Date.parse(stamp):NaN;
    return Number.isFinite(timestamp)&&timestamp<cutoff?value:null;
  });
  const stats=effectiveRaw.map(normalize);
  const A=stats[0], B=stats[1];
  const missing = stats.map(s=>Object.keys(METRICS).filter(k=>s[k]===null).map(k=>METRICS[k]));
  // Preserve provided values for validation, but only after historical snapshots
  // have been excluded. Normalizing first would hide malformed unused inputs.
  const evaluated = engine?.evaluate ? engine.evaluate(effectiveRaw[0],effectiveRaw[1]) : null;
  const complete = evaluated?.status==='experimental';
  const unusedMissing = evaluated?.unusedMissing || [];
  const dataQuality = evaluated?.dataQuality || {limited:missing.some(list=>list.length>0)};
  const grapplingComplete = stats.every((s,side)=>['tdAvg','tdAcc','tdDef'].every(key=>s[key]!==null||unusedMissing.some(item=>item.side===side&&item.key===key)));
  const striking = allHave(stats,['slpm','strAcc','strDef']) ? A.slpm*(A.strAcc/50)*(1-B.strDef/130)-B.slpm*(B.strAcc/50)*(1-A.strDef/130) : 0;
  const absorption = allHave(stats,['sapm']) ? (B.sapm-A.sapm)*0.45 : 0;
  const takedownTerm=(fighter,opponent)=>fighter.tdAvg===0&&(fighter.tdAcc===null||opponent.tdDef===null)?0:fighter.tdAvg*(fighter.tdAcc/50)*(1-opponent.tdDef/120);
  const grappling = grapplingComplete ? takedownTerm(A,B)-takedownTerm(B,A) : 0;
  const submissions = allHave(stats,['subAvg']) ? A.subAvg-B.subAvg : 0;
  const strikingFacts = facts(stats,names,['slpm','strAcc','strDef'],(k,v)=>k==='slpm'?format(v)+' significant strikes landed/min':k==='strAcc'?percent(v)+' striking accuracy':percent(v)+' striking defense');
  const defenseFacts = facts(stats,names,['sapm'],(_k,v)=>format(v)+' significant strikes absorbed/min');
  const grapplingFacts = facts(stats,names,['tdAvg','tdAcc','tdDef'],(k,v)=>k==='tdAvg'?format(v)+' takedowns/15 min':k==='tdAcc'?percent(v)+' takedown accuracy':percent(v)+' takedown defense')+(unusedMissing.length?' A verified zero takedown rate makes that fighter\'s takedown term zero. The unused missing accuracy/defense percentages remain unavailable; they are not treated as 0%.':'');
  const submissionFacts = facts(stats,names,['subAvg'],(_k,v)=>format(v)+' submission attempts/15 min');
  const areas = [
    area('Striking attack',['slpm','strAcc','strDef'],stats,names,striking,0.26,strikingFacts,i=>'Possible route (inference): '+names[i]+' could try to keep exchanges standing and sustain the striking advantage suggested by their '+format(stats[i].slpm)+' significant strikes landed/min and '+percent(stats[i].strAcc)+' accuracy. Their opponent\'s recorded striking defense is '+percent(stats[1-i].strDef)+'.'),
    area('Defense and damage absorbed',['sapm'],stats,names,absorption,0.18,defenseFacts,i=>'Possible route (inference): '+names[i]+' could try to limit exchanges and exploit the lower recorded damage rate: '+format(stats[i].sapm)+' significant strikes absorbed/min versus '+format(stats[1-i].sapm)+'/min. Absorbed strikes do not measure power or finishing ability.'),
    area('Takedown matchup',['tdAvg','tdAcc','tdDef'],stats,names,grappling,0.24,grapplingFacts,i=>'Possible route (inference): '+names[i]+' could pursue takedowns, with '+format(stats[i].tdAvg)+' takedowns/15 min and '+percent(stats[i].tdAcc)+' accuracy against '+percent(stats[1-i].tdDef)+' opponent takedown defense. The career rates do not establish how much control time would follow.',grapplingComplete),
    area('Submission activity',['subAvg'],stats,names,submissions,0.16,submissionFacts,i=>'Possible route (inference): '+names[i]+' could seek grappling opportunities to use their higher submission activity: '+format(stats[i].subAvg)+' attempts/15 min versus '+format(stats[1-i].subAvg)+'/15 min. Attempts are not submission finishes.')
  ];
  // Cross-match attack against the opponent's specific defensive weakness.
  // These are matchup hypotheses, not measured finish probabilities.
  const exploits=[];
  for(let i=0;i<2;i++){
    const own=stats[i],opp=stats[1-i],name=names[i],other=names[1-i];
    if(has(own,['slpm','strAcc'])&&has(opp,['sapm','strDef'])){
      const strikingPressure=own.slpm*(own.strAcc/50)*(1-opp.strDef/100);
      exploits.push({side:i,kind:'striking',score:strikingPressure,
        title:name+' striking against '+other+' striking defense',
        summary:name+' lands '+format(own.slpm)+' significant strikes/min at '+percent(own.strAcc)+' accuracy; '+other+' absorbs '+format(opp.sapm)+'/min with '+percent(opp.strDef)+' striking defense.',
        route:name+' may exploit openings in '+other+'\'s striking defense by maintaining distance and volume. This does not establish knockout power.'});
    }
    if(has(own,['tdAvg','tdAcc'])&&has(opp,['tdDef'])){
      const wrestlingPressure=own.tdAvg*(own.tdAcc/50)*(1-opp.tdDef/100);
      exploits.push({side:i,kind:'wrestling',score:wrestlingPressure,
        title:name+' takedowns against '+other+' takedown defense',
        summary:name+' averages '+format(own.tdAvg)+' takedowns/15 min with '+percent(own.tdAcc)+' accuracy; '+other+' defends '+percent(opp.tdDef)+' of takedown attempts.',
        route:name+' may exploit '+other+'\'s takedown defense by forcing wrestling exchanges. Ground control and submission success remain unverified.'});
    }
    if(has(own,['subAvg'])&&has(opp,['tdDef'])&&own.subAvg>0){
      exploits.push({side:i,kind:'submission',score:own.subAvg*(1-opp.tdDef/100),
        title:name+' submission activity against '+other+' takedown defense',
        summary:name+' attempts '+format(own.subAvg)+' submissions/15 min; '+other+'\'s takedown defense is '+percent(opp.tdDef)+'.',
        route:name+' could pursue submissions if grappling exchanges develop. Submission attempts are not submission wins.'});
    }
  }
  exploits.sort((x,y)=>y.score-x.score);
  // Historical finish tendencies are descriptive only; opponent quality and pace are not established.
  const asOf=cutoff;
  const histories=(options.profiles||[]).map(profile=>{
    const rows=Array.isArray(profile?.recent_fights)?profile.recent_fights:[];
    const ownId=String(profile?.id||'');
    const known=rows.filter(f=>{
      if(!f||!ownId||!f.winner||!f.method_display)return false;
      if(!/^(final|completed)$/i.test(String(f.status||'')))return false;
      if(/draw|no contest|overturned/i.test(String(f.winner)+' '+String(f.method_display)))return false;
      const fighterA=String(f.fighter_a||''),fighterB=String(f.fighter_b||'');
      if(fighterA===fighterB||(fighterA!==ownId&&fighterB!==ownId))return false;
      const winner=String(f.winner);
      const winnerId=winner.toLowerCase()==='a'?fighterA:winner.toLowerCase()==='b'?fighterB:winner;
      if(winnerId!==fighterA&&winnerId!==fighterB)return false;
      if(asOf!==null){
        const boutDate=Date.parse(f.starts_at||f.event_date);
        if(!Number.isFinite(boutDate)||boutDate>=asOf)return false;
      }
      return true;
    });
    const seen=new Set();
    const unique=known.filter(f=>{const key=String(f.bout_id||[f.event_date,f.fighter_a,f.fighter_b].join('|'));if(seen.has(key))return false;seen.add(key);return true;});
    unique.sort((a,b)=>(Date.parse(b.starts_at||b.event_date)||0)-(Date.parse(a.starts_at||a.event_date)||0));
    unique.length=Math.min(unique.length,5);
    const outcomes=unique.map(f=>{
      const winner=String(f.winner||'');
      const winnerId=winner.toLowerCase()==='a'?String(f.fighter_a):winner.toLowerCase()==='b'?String(f.fighter_b):winner;
      const method=String(f.method_display||'');
      return {win:winnerId===ownId,ko:/knockout|\bko\b|\btko\b/i.test(method),submission:/submission/i.test(method),decision:/decision/i.test(method)};
    });
    return {sample:outcomes.length,wins:outcomes.filter(x=>x.win).length,losses:outcomes.filter(x=>!x.win).length,koWins:outcomes.filter(x=>x.win&&x.ko).length,submissionWins:outcomes.filter(x=>x.win&&x.submission).length,decisionWins:outcomes.filter(x=>x.win&&x.decision).length,koLosses:outcomes.filter(x=>!x.win&&x.ko).length,submissionLosses:outcomes.filter(x=>!x.win&&x.submission).length};
  });
  const recentEvidence=names.map((name,i)=>({
    name,...(histories[i]||{sample:0,wins:0,losses:0,koWins:0,submissionWins:0,decisionWins:0,koLosses:0,submissionLosses:0})
  }));
  // Opponent quality is displayed only when an explicitly sourced opponent record exists.
  // Never estimate strength of schedule from the fighter's own wins or rankings.
  const opponentQuality=names.map((_,i)=>options.profiles?.[i]||null).map(profile=>{
    const ownId=String(profile?.id||'');
    const seen=new Set();
    const bouts=(Array.isArray(profile?.recent_fights)?profile.recent_fights:[])
      .filter(f=>f&&String(f.fighter_a||'')!==String(f.fighter_b||'')&&
        (String(f.fighter_a||'')===ownId||String(f.fighter_b||'')===ownId))
      .sort((a,b)=>(Date.parse(b.starts_at||b.event_date)||0)-(Date.parse(a.starts_at||a.event_date)||0));
    const records=[];
    for(const f of bouts){
      const key=String(f.bout_id||[f.event_date,f.fighter_a,f.fighter_b].join('|'));
      if(seen.has(key))continue;seen.add(key);
      if(asOf!==null){
        const boutDate=Date.parse(f.starts_at||f.event_date);
        if(!Number.isFinite(boutDate)||boutDate>=asOf)continue;
      }
      // A historical bout alone does not prove its opponent record was known
      // before the prediction. Require a timestamped record snapshot as well.
      if(asOf!==null){
        const recordAsOf=Date.parse(f.opponent_record_as_of||'');
        const boutDate=Date.parse(f.starts_at||f.event_date);
        // Opponent quality must reflect what was knowable at the earlier bout,
        // not a later improved record captured before this prediction.
        if(!Number.isFinite(recordAsOf)||!Number.isFinite(boutDate)||recordAsOf> boutDate||recordAsOf>=asOf)continue;
      }
      const record=f.opponent_record;
      if(!record||!Number.isInteger(record.wins)||!Number.isInteger(record.losses)||record.wins<0||record.losses<0||record.wins+record.losses===0||!f.opponent_record_source)continue;
      records.push({opponent:String(f.fighter_a)===ownId?f.fighter_b_name:f.fighter_a_name,record:record.wins+'-'+record.losses,winRate:record.wins/(record.wins+record.losses),source:String(f.opponent_record_source)});
      if(records.length===5)break;
    }
    return {verified:records.length,opponents:records,averageWinRate:records.length?records.reduce((sum,x)=>sum+x.winRate,0)/records.length:null};
  });
  const physical=names.map((_,i)=>options.profiles?.[i]||null).map(p=>({
    stance:typeof p?.stance==='string'&&/^(orthodox|southpaw|switch)$/i.test(p.stance.trim())?p.stance.trim():null,
    reach:Number.isFinite(Number(p?.reach_in))&&Number(p.reach_in)>40&&Number(p.reach_in)<100?Number(p.reach_in):null,
    height:Number.isFinite(Number(p?.height_in))&&Number(p.height_in)>48&&Number(p.height_in)<96?Number(p.height_in):null
  }));
  const styleEvidence=[];
  if(physical.length===2){
    const [x,y]=physical;
    if(x.stance&&y.stance)styleEvidence.push(names[0]+' fights '+x.stance+'; '+names[1]+' fights '+y.stance+'. Stance alone does not establish an advantage.');
    if(x.reach!==null&&y.reach!==null){
      const diff=x.reach-y.reach;
      styleEvidence.push(diff===0?'Both fighters have equal listed reach.':names[diff>0?0:1]+' has a '+format(Math.abs(diff))+'-inch listed reach advantage; distance management remains a tactical inference.');
    }
    if(x.height!==null&&y.height!==null&&x.height!==y.height)styleEvidence.push(names[x.height>y.height?0:1]+' is '+format(Math.abs(x.height-y.height))+' inches taller. Height alone does not establish grappling or striking superiority.');
  }
  const contextualFlags=[];
  for(let i=0;i<2;i++){
    const h=recentEvidence[i],name=names[i];
    if(h.sample>=3){
      contextualFlags.push(name+': '+h.wins+'-'+h.losses+' in '+h.sample+' recorded recent decisive fights. Recent results describe form, not opponent quality.');
      if(h.koLosses>=2)contextualFlags.push(name+': multiple recent KO/TKO losses warrant a durability review; chin and medical status cannot be inferred.');
      if(h.submissionLosses>=2)contextualFlags.push(name+': multiple recent submission losses warrant a grappling-defense review.');
    }else contextualFlags.push(name+': insufficient verified recent decisive results to assess form.');
    if(stats[i].slpm!==null&&stats[i].sapm!==null&&stats[i].sapm>stats[i].slpm)
      contextualFlags.push(name+': absorbs more significant strikes per minute than landed across career; opponent quality and fight context are unknown.');
  }
  const unresolved=['Opponent quality: only explicitly sourced opponent records can be compared; no opponent-adjusted model is validated','Cardio: no round-by-round output or pace decay supplied','Durability: recorded KO/TKO losses are not medical or chin assessments','Fighting style: striking and takedown rates do not reveal stance, cage control, clinch work or tactical tendencies'];
  const finishRoutes=[];
  for(let i=0;i<2;i++){
    const own=recentEvidence[i],opp=recentEvidence[1-i];
    if(own.sample>=2&&opp.sample>=2){
      if(own.koWins>0&&opp.koLosses>0)finishRoutes.push(names[i]+' has '+own.koWins+' KO/TKO win(s) in '+own.sample+' verified recent fights; '+names[1-i]+' has '+opp.koLosses+' KO/TKO loss(es) in '+opp.sample+'. Potential striking finish route, not a probability.');
      if(own.submissionWins>0&&opp.submissionLosses>0)finishRoutes.push(names[i]+' has '+own.submissionWins+' submission win(s) in '+own.sample+' verified recent fights; '+names[1-i]+' has '+opp.submissionLosses+' submission loss(es) in '+opp.sample+'. Potential submission route, not a probability.');
    }
  }
  const probability = evaluated?.status==='experimental' ? evaluated.modelProbability : null;
  const leanSide = probability===null ? null : signSide(probability-0.5);
  const status = probability===null ? 'incomplete' : leanSide===null ? 'balanced' : 'experimental';
  const ranked = side => areas.filter(x=>x.side===side).sort((x,y)=>Math.abs(y.contribution)-Math.abs(x.contribution));
  const supportive = leanSide===null ? [] : ranked(leanSide);
  const opposing = leanSide===null ? [] : ranked(1-leanSide);
  const counterargument = opposing.length ? {side:1-leanSide,title:opposing[0].title,summary:opposing[0].summary} : null;
  const paths = [0,1].map(side=>({side,summary:ranked(side)[0]?.route || 'No comparative advantage for '+names[side]+' is established by the available career rates. More matchup evidence is needed to describe a supported route.'}));
  // Always supply a directional pick when two fighters are named. This is a
  // deterministic scouting lean, NOT a calibrated win probability.
  const evidenceCount=areas.filter(x=>x.complete).length;
  const contributions=areas.filter(x=>x.complete).map(x=>x.contribution);
  const careerScore=contributions.reduce((sum,v)=>sum+v,0);
  const recentScore=recentEvidence.every(x=>x.sample>0)?
    (recentEvidence[0].wins/recentEvidence[0].sample-recentEvidence[1].wins/recentEvidence[1].sample)*0.25:0;
  const qualityScore=opponentQuality.every(x=>x&&x.verified>0)?
    (opponentQuality[0].averageWinRate-opponentQuality[1].averageWinRate)*0.1:0;
  const combinedScore=careerScore+recentScore+qualityScore;
  const scoreAvailable=evidenceCount>0||recentEvidence.every(x=>x.sample>0)||opponentQuality.every(x=>x&&x.verified>0);
  // Tie-breaking is intentionally stable across refreshes. Never mistake a tie
  // or missing evidence for a statistically supported advantage.
  const predictedSide=combinedScore>1e-10?0:combinedScore< -1e-10?1:
    names[0].localeCompare(names[1],undefined,{sensitivity:'base'})<=0?0:1;
  const tied=Math.abs(combinedScore)<=1e-10;
  const decision={
    status:!scoreAvailable?'NO_DATA_LEAN':tied?'TIEBREAK_LEAN':'PREDICTED_WINNER',
    fighter:names[predictedSide],
    side:predictedSide,
    reason:!scoreAvailable?'No comparative evidence is available. This is a deterministic placeholder pick, not an evidence-based prediction.':
      tied?'The available weighted comparisons are tied. A deterministic tiebreak supplies a pick, not a statistical advantage.':
      'Directional lean from available career-rate comparisons'+(recentScore?' and recent results':'')+(qualityScore?' and sourced opponent records':'')+'. Missing data reduces reliability.',
    primaryRoute:exploits.find(x=>x.side===predictedSide)?.route||paths[predictedSide].summary,
    counterRoute:exploits.find(x=>x.side===1-predictedSide)?.route||paths[1-predictedSide].summary,
    evidence:{careerAreas:evidenceCount,recentResults:recentEvidence.map(x=>x.sample),sourcedOpponentRecords:opponentQuality.map(x=>x.verified)},
    confidence:!scoreAvailable||tied?'VERY_LOW':!complete||!recentEvidence.every(x=>x.sample>=2)?'LOW':'UNVALIDATED',
    calibratedProbability:null
  };
  const cautions = ['This is an unvalidated career-rate heuristic. It has not been calibrated or backtested and does not establish a betting edge.', 'Career averages can hide differences in opponent quality, recent form, injuries, weight cuts and changes in fighting style. Those factors are not established by these rate comparisons.'];
  if (!complete) cautions.unshift('Incomplete data: a provisional directional winner is shown from available comparisons, not a validated edge; missing career rates reduce reliability.');
  else if (dataQuality.limited) cautions.unshift('Limited source data: unavailable percentages are listed for each fighter. A verified zero takedown rate makes those specific percentage inputs unnecessary for this heuristic; no missing percentage was filled with zero.');
  if(cutoff!==null&&stats.some((_,i)=>{const p=options.profiles?.[i];const t=Date.parse(p?.stats_as_of||p?.snapshot_at||p?.fetched_at);return !Number.isFinite(t)||t>=cutoff;}))cautions.unshift('Historical safety: career statistics without a verified pre-fight snapshot were excluded to prevent future-data leakage.');
  if (leanSide!==null&&!counterargument) cautions.push('No scored rate component favors the other fighter. That does not establish that the other fighter has no path to win.');
  return {
    status, heading:status==='incomplete'?'Research incomplete':status==='balanced'?'No statistical lean':'Statistical lean: '+names[leanSide],
    leanSide,
    leanReason:status==='incomplete'?'The missing rates are listed separately for each fighter below.':status==='balanced'?'The underlying career-rate score is level; simulation noise is not used to break the tie.':'The rate-based score favors '+names[leanSide]+(supportive.length?', led by '+supportive.slice(0,2).map(x=>x.title.toLowerCase()).join(' and '):'')+'.',
    decision,areas,exploits,recentEvidence,opponentQuality,styleEvidence,contextualFlags,unresolved,finishRoutes,missing,unusedMissing,dataQuality,paths,counterargument,cautions,modelProbability:probability
  };
}
return {describe,normalize,METRICS};
});

