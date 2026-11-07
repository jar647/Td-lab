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
function area(title, keys, stats, names, value, weight, observed, inference) {
  const complete = allHave(stats, keys);
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
  const stats = [normalize(a),normalize(b)], A=stats[0], B=stats[1];
  const missing = stats.map(s=>Object.keys(METRICS).filter(k=>s[k]===null).map(k=>METRICS[k]));
  const complete = missing.every(list=>list.length===0);
  const striking = allHave(stats,['slpm','strAcc','strDef']) ? A.slpm*(A.strAcc/50)*(1-B.strDef/130)-B.slpm*(B.strAcc/50)*(1-A.strDef/130) : 0;
  const absorption = allHave(stats,['sapm']) ? (B.sapm-A.sapm)*0.45 : 0;
  const grappling = allHave(stats,['tdAvg','tdAcc','tdDef']) ? A.tdAvg*(A.tdAcc/50)*(1-B.tdDef/120)-B.tdAvg*(B.tdAcc/50)*(1-A.tdDef/120) : 0;
  const submissions = allHave(stats,['subAvg']) ? A.subAvg-B.subAvg : 0;
  const strikingFacts = facts(stats,names,['slpm','strAcc','strDef'],(k,v)=>k==='slpm'?format(v)+' significant strikes landed/min':k==='strAcc'?percent(v)+' striking accuracy':percent(v)+' striking defense');
  const defenseFacts = facts(stats,names,['sapm'],(_k,v)=>format(v)+' significant strikes absorbed/min');
  const grapplingFacts = facts(stats,names,['tdAvg','tdAcc','tdDef'],(k,v)=>k==='tdAvg'?format(v)+' takedowns/15 min':k==='tdAcc'?percent(v)+' takedown accuracy':percent(v)+' takedown defense');
  const submissionFacts = facts(stats,names,['subAvg'],(_k,v)=>format(v)+' submission attempts/15 min');
  const areas = [
    area('Striking attack',['slpm','strAcc','strDef'],stats,names,striking,0.26,strikingFacts,i=>'Possible route (inference): '+names[i]+' could try to keep exchanges standing and sustain the striking advantage suggested by their '+format(stats[i].slpm)+' significant strikes landed/min and '+percent(stats[i].strAcc)+' accuracy. Their opponent\'s recorded striking defense is '+percent(stats[1-i].strDef)+'.'),
    area('Defense and damage absorbed',['sapm'],stats,names,absorption,0.18,defenseFacts,i=>'Possible route (inference): '+names[i]+' could try to limit exchanges and exploit the lower recorded damage rate: '+format(stats[i].sapm)+' significant strikes absorbed/min versus '+format(stats[1-i].sapm)+'/min. Absorbed strikes do not measure power or finishing ability.'),
    area('Takedown matchup',['tdAvg','tdAcc','tdDef'],stats,names,grappling,0.24,grapplingFacts,i=>'Possible route (inference): '+names[i]+' could pursue takedowns, with '+format(stats[i].tdAvg)+' takedowns/15 min and '+percent(stats[i].tdAcc)+' accuracy against '+percent(stats[1-i].tdDef)+' opponent takedown defense. The career rates do not establish how much control time would follow.'),
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
  const evaluated = complete && engine?.evaluate ? engine.evaluate(A,B) : null;
  const probability = evaluated?.status==='experimental' ? evaluated.modelProbability : null;
  const leanSide = probability===null ? null : signSide(probability-0.5);
  const status = probability===null ? 'incomplete' : leanSide===null ? 'balanced' : 'experimental';
  const ranked = side => areas.filter(x=>x.side===side).sort((x,y)=>Math.abs(y.contribution)-Math.abs(x.contribution));
  const supportive = leanSide===null ? [] : ranked(leanSide);
  const opposing = leanSide===null ? [] : ranked(1-leanSide);
  const counterargument = opposing.length ? {side:1-leanSide,title:opposing[0].title,summary:opposing[0].summary} : null;
  const paths = [0,1].map(side=>({side,summary:ranked(side)[0]?.route || 'No comparative advantage for '+names[side]+' is established by the available career rates. More matchup evidence is needed to describe a supported route.'}));
  const cautions = ['This is an unvalidated career-rate heuristic. It has not been calibrated or backtested and does not establish a betting edge.', 'Career averages can hide differences in opponent quality, recent form, injuries, weight cuts and changes in fighting style. Those factors are not established by these rate comparisons.'];
  if (!complete) cautions.unshift('Incomplete data: the available facts can be compared, but a winner lean is withheld until both fighters have all required valid rates.');
  if (leanSide!==null&&!counterargument) cautions.push('No scored rate component favors the other fighter. That does not establish that the other fighter has no path to win.');
  return {
    status, heading:status==='incomplete'?'Research incomplete':status==='balanced'?'No statistical lean':'Statistical lean: '+names[leanSide],
    leanSide,
    leanReason:status==='incomplete'?'The missing rates are listed separately for each fighter below.':status==='balanced'?'The underlying career-rate score is level; simulation noise is not used to break the tie.':'The rate-based score favors '+names[leanSide]+(supportive.length?', led by '+supportive.slice(0,2).map(x=>x.title.toLowerCase()).join(' and '):'')+'.',
    areas,exploits,missing,paths,counterargument,cautions,modelProbability:probability
  };
}
return {describe,normalize,METRICS};
});
