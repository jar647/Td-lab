/* One transparent pre-fight selection. This is an unvalidated evidence rule,
   not a calibrated betting model. Odds never enter this module. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.UFCPickEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';
const policy = 'Unvalidated evidence rule';
const thresholds = Object.freeze({
  totalPerFighter:3, totalPooled:6, totalPooledSupport:0.75,
  totalEachSupport:2/3, methodShare:0.6, methodCombinedSample:10,
  competingAreaRatio:0.35, staleHours:12
});
const policyDescription = 'Use only pre-fight reports. Consider Over/Under 2.5 in confirmed three-round bouts or 4.5 in confirmed five-round bouts: at least three eligible fights per fighter, six unique combined, three-quarters combined support and two-thirds support per fighter. Prefer that strong total when the winner lean is absent, has fewer than two supporting areas, or opposing scored areas contribute at least 35% as much as supporting areas. Otherwise prefer an independently aligned win-method route only when a validated matching-scope candidate has at least 60% of recorded wins and 60% of opposing losses, with ten combined observations. Otherwise take the complete upstream winner lean, then a qualified total, then pass. These fixed thresholds are judgment rules, not fitted probabilities or expected-value rankings. Conditional-valid upstream winner reports with missing source fields remain labeled limited.';
const methods = {ko:'KO/TKO',submission:'submission',decision:'decision'};
const finite = value => typeof value === 'number' && Number.isFinite(value);
const count = value => finite(value) && Number.isInteger(value) && value >= 0;
const side = value => value === 0 || value === 1;
const clean = value => typeof value === 'string' ? value.trim() : '';
const missing = report => !Array.isArray(report?.missing) || report.missing.some(list=>!Array.isArray(list)||list.length>0);
function dateValue(value) {
  if (value instanceof Date) return value.getTime();
  if (finite(value)) return value;
  return clean(value) ? Date.parse(value) : NaN;
}
function state(value) {
  if (value && typeof value==='object') {
    if (value.completed === true || value.type?.completed === true) return 'post';
    value=value.type?.state || value.state || value.type?.name || value.name || value.description;
  }
  const text=clean(value).toLowerCase().replace(/^status[_ -]/,'').replace(/[_ -]+/g,' ');
  if (['post','final','completed','complete','ended','full time'].includes(text)) return 'post';
  if (['in','live','in progress','inprogress','in round','end round'].includes(text)) return 'in';
  if (['pre','scheduled','not started','unstarted'].includes(text)) return 'pre';
  if (['canceled','cancelled','postponed','suspended'].includes(text)) return 'off';
  return 'unknown';
}
function output(status,label,reason,risk,extra={}) {
  return {status,label,market:null,side:null,line:null,method:null,reason,risk,
    basis:[],policy,dataQuality:'limited',...extra};
}
function winnerEvidence(report) {
  if (report?.status!=='experimental' || !side(report.leanSide) || !finite(report.modelProbability) || report.modelProbability<=0 || report.modelProbability>=1 || report.modelProbability===0.5) return null;
  if ((report.modelProbability>0.5?0:1)!==report.leanSide || !Array.isArray(report.areas) || report.areas.length<4) return null;
  const areas=report.areas.filter(area=>side(area?.side)&&finite(area.contribution)&&area.contribution!==0);
  // Side labels must agree with the signed first-fighter score.
  if (areas.some(area=>(area.contribution>0?0:1)!==area.side)) return null;
  const supporting=areas.filter(area=>area.side===report.leanSide).sort((a,b)=>Math.abs(b.contribution)-Math.abs(a.contribution)||clean(a.title).localeCompare(clean(b.title)));
  const opposing=areas.filter(area=>area.side!==report.leanSide).sort((a,b)=>Math.abs(b.contribution)-Math.abs(a.contribution)||clean(a.title).localeCompare(clean(b.title)));
  if (!supporting.length) return null;
  const support=supporting.reduce((n,area)=>n+Math.abs(area.contribution),0);
  const oppose=opposing.reduce((n,area)=>n+Math.abs(area.contribution),0);
  if (support<=oppose) return null;
  return {side:report.leanSide,supporting,opposing,contested:supporting.length<2||oppose>=support*thresholds.competingAreaRatio,quality:missing(report)?'limited':'complete'};
}
function validCounts(row) {
  return row && count(row.sample) && count(row.over) && count(row.under) && row.over+row.under===row.sample;
}
function totalEvidence(reports,rounds) {
  const line=rounds===3?2.5:rounds===5?4.5:null;
  if (line===null) return null;
  const eligible=[];
  for (const report of reports) {
    const total=report?.totals;
    if (total?.status!=='historical_lean' || total.rounds!==rounds || total.line!==line || !['over','under'].includes(total.lean) || !validCounts(total.pooled) || !Array.isArray(total.fighters) || total.fighters.length!==2) continue;
    const pair=[0,1].map(i=>total.fighters.find(fighter=>fighter?.side===i));
    if (pair.some(fighter=>!validCounts(fighter)||fighter.sample<thresholds.totalPerFighter)) continue;
    const pool=total.pooled, direction=total.lean;
    if (pool.sample<thresholds.totalPooled || pool.sample>pair[0].sample+pair[1].sample || pool.sample<Math.max(pair[0].sample,pair[1].sample)) continue;
    if (pool[direction]/pool.sample<thresholds.totalPooledSupport || pair.some(fighter=>fighter[direction]/fighter.sample<thresholds.totalEachSupport)) continue;
    eligible.push({line,direction,pool,pair});
  }
  // Repeated reports cannot increase the evidence. Conflicting eligible totals
  // are withheld instead of choosing whichever report was passed first.
  if (new Set(eligible.map(item=>item.direction)).size>1) return null;
  eligible.sort((a,b)=>b.pool.sample-a.pool.sample||b.pool[b.direction]/b.pool.sample-a.pool[a.direction]/a.pool.sample||a.pair[0].sample-b.pair[0].sample||a.pair[1].sample-b.pair[1].sample||a.pair[0][a.direction]-b.pair[0][b.direction]||a.pair[1][a.direction]-b.pair[1][b.direction]);
  return eligible[0]||null;
}
function methodEvidence(reports,winner,eventDate,now) {
  if (!winner) return null;
  const eligible=[];
  for (const report of reports) for (const fighter of Array.isArray(report?.methods)?report.methods:[]) {
    if (fighter?.side!==winner.side || fighter.status!=='research_angle' || !Array.isArray(fighter.rows)) continue;
    for (const row of fighter.rows) {
      if (!row?.candidate || !Object.hasOwn(methods,row.key) || fighter.candidate!==row.key) continue;
      const scope=clean(row.recordScope), opponentScope=clean(row.opponentRecordScope);
      if (!scope || ['unknown','unavailable'].includes(scope) || scope!==opponentScope) continue;
      if (![row.totalWins,row.totalOpponentLosses,row.winCount,row.opponentLossCount].every(count) || row.totalWins<3 || row.totalOpponentLosses<3 || row.winCount>row.totalWins || row.opponentLossCount>row.totalOpponentLosses) continue;
      const winShare=row.winCount/row.totalWins, lossShare=row.opponentLossCount/row.totalOpponentLosses;
      if (!finite(row.winShare)||!finite(row.opponentLossShare)||Math.abs(row.winShare-winShare)>1e-9||Math.abs(row.opponentLossShare-lossShare)>1e-9) continue;
      if (winShare<thresholds.methodShare || lossShare<thresholds.methodShare || row.totalWins+row.totalOpponentLosses<thresholds.methodCombinedSample) continue;
      // Upstream already validates snapshots; reject any explicit future or
      // post-event record timestamp again at the selection boundary.
      if ([row.recordFetchedAt,row.opponentRecordFetchedAt].some(value=>{
        // A supplied but invalid timestamp is not evidence of a valid pre-fight snapshot.
        // Absent timestamps retain legacy support for explicitly scoped historical records.
        if (value===undefined||value===null||value==='') return false;
        const timestamp=dateValue(value);
        return !Number.isFinite(timestamp)||((Number.isFinite(eventDate)&&timestamp>=eventDate)||timestamp>now);
      })) continue;
      eligible.push({side:winner.side,method:row.key,row,scope,concentration:Math.min(winShare,lossShare),sample:row.totalWins+row.totalOpponentLosses});
    }
  }
  eligible.sort((a,b)=>b.concentration-a.concentration||b.sample-a.sample||a.method.localeCompare(b.method)||a.row.totalWins-b.row.totalWins||a.row.winCount-b.row.winCount||a.row.totalOpponentLosses-b.row.totalOpponentLosses||a.row.opponentLossCount-b.row.opponentLossCount||a.scope.localeCompare(b.scope));
  return eligible[0]||null;
}
function counterEvidence(matchup,winner) {
  const counter=matchup?.counterargument;
  return counter?.side===1-winner.side && clean(counter.title) ? counter : winner.opposing[0]||null;
}
function counterFacts(matchup,winner) {
  const summary=clean(counterEvidence(matchup,winner)?.summary);
  return summary?[summary]:[];
}
function winnerRisk(matchup,winner,names) {
  const title=clean(counterEvidence(matchup,winner)?.title).toLowerCase();
  if (title) return names[1-winner.side]+' leads the '+title+' comparison and could overturn this lean.';
  return 'Career averages may miss recent form, injuries or style changes; '+names[1-winner.side]+' still has a path to win.';
}
function choose(options={}) {
  const names=[0,1].map(i=>clean(options.names?.[i])||'Fighter '+(i+1));
  const fightState=state(options.status);
  if (fightState==='post') return output('unavailable','Fight completed','A new pre-fight pick is unavailable after the fight.','Review a saved pre-fight selection rather than applying current statistics retrospectively.');
  if (fightState==='in') return output('unavailable','Live fight — pre-fight pick unavailable','The fight is in progress.','This rule uses pre-fight evidence and does not evaluate live conditions.');
  if (fightState!=='pre') return output('unavailable',fightState==='off'?'Fight unavailable':'Fight status unavailable','A scheduled pre-fight status is required before making a new selection.','Refresh the fight status.');
  const now=options.now===undefined?Date.now():dateValue(options.now), eventDate=dateValue(options.eventDate);
  if (!Number.isFinite(now)) return output('unavailable','Refresh fight data','The evaluation time is unavailable.','A valid evaluation time is needed to check the pre-fight data.');
  if (Number.isFinite(eventDate)&&now-eventDate>thresholds.staleHours*3600000) return output('unavailable','Refresh fight status','The listed start time is over 12 hours old, but the fight still appears scheduled.','Confirm the updated status before using a pre-fight pick.');
  const matchup=options.matchup, winner=winnerEvidence(matchup);
  const reports=Array.isArray(options.propReports)?options.propReports:[];
  const rounds=options.rounds===3||options.rounds===5?options.rounds:Number(options.rounds);
  const total=totalEvidence(reports,rounds);
  const method=methodEvidence(reports,winner,eventDate,now);
  function chooseTotal() {
    const label=(total.direction==='over'?'Over ':'Under ')+total.line+' rounds';
    return output('pick',label,'Both fighters’ same-distance histories support '+label.toLowerCase()+': '+total.pool[total.direction]+' of '+total.pool.sample+' unique eligible fights finished '+total.direction+' this line.',
      'Historical fight lengths are a selective sample; this matchup may develop differently. A finish near the line can decide this bet.',
      {market:'total',line:total.line,basis:total.pair.map((fighter,i)=>names[i]+': '+fighter[total.direction]+' of '+fighter.sample+' eligible fights '+total.direction+' '+total.line+' rounds.').concat([total.pool[total.direction]+' of '+total.pool.sample+' unique fights combined; confirmed '+rounds+'-round format.',winner?'The winner evidence has narrow support or competing areas, so the stronger shared length pattern takes priority.':'An independent winner lean is unavailable; the total has separate historical support.']),dataQuality:winner?.quality||'limited'});
  }
  if (total&&(!winner||winner.contested)) return chooseTotal();
  if (method) {
    const row=method.row, name=names[method.side];
    return output('pick',name+' by '+methods[method.method],
      name+' has the independent winner lean. '+methods[method.method]+' accounts for '+row.winCount+' of '+row.totalWins+' recorded wins and '+row.opponentLossCount+' of '+row.totalOpponentLosses+' opposing losses in the same record scope.',
      'This narrower pick loses if '+name+' wins another way. '+winnerRisk(matchup,winner,names),
      {market:'method',side:method.side,method:method.method,basis:[clean(matchup.leanReason)||'The independent complete rate comparison supports '+name+'.','Matching record scope: '+(clean(row.recordScopeLabel)||method.scope.replace(/_/g,' '))+'.','Win-method shares describe recorded wins; they are not this matchup’s method probability.'].concat(counterFacts(matchup,winner)),dataQuality:method.scope==='recent_results'?'limited':winner.quality});
  }
  if (winner) {
    const name=names[winner.side], leading=winner.supporting.slice(0,2).map(area=>clean(area.title).toLowerCase());
    return output('pick',name+' to win',name+' has the independent career-rate lean, led by '+leading.join(' and ')+'.',winnerRisk(matchup,winner,names),
      {market:'winner',side:winner.side,basis:winner.supporting.slice(0,2).map(area=>clean(area.summary)||clean(area.title)+' favors '+name+'.').concat(counterFacts(matchup,winner),['No eligible alternate market takes priority under the fixed evidence rule.']),dataQuality:winner.quality});
  }
  if (total) return chooseTotal();
  return output('pass','PASS — no supported pick',matchup?.status==='balanced'?'The career-rate comparison is level, and no round or method selection meets the evidence requirements.':'The available evidence does not support a complete independent winner lean or a strong standard total.',
    'Missing or mixed evidence is not a reason to force a fighter or prop.',{basis:['No odds are used. Method records alone cannot establish which fighter wins.'],dataQuality:matchup?.status==='balanced'&&!missing(matchup)?'complete':'limited'});
}
return {choose,policy,policyDescription,thresholds};
});
