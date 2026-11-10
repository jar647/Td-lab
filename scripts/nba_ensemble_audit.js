/* Compare a possession-model NBA score against the separately frozen historical
 * scoring baseline. Static blends NEVER change live scores or sportsbook picks.
 * Every shadow variant is frozen before tipoff for prospective evaluation.
 */
'use strict';
const VERSION='nba-frozen-ensemble-shadow-v1';
const WEIGHTS=[0,0.25,0.5,0.75,1];
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const mean=xs=>xs.length?xs.reduce((s,x)=>s+x,0)/xs.length:null;
const round=x=>Math.round(x*10)/10;
const validInput=x=>x&&!x.rotation_fallback&&x.baseline&&
 [x.home,x.away,x.baseline.home,x.baseline.away].every(finite)&&
 [x.home,x.away,x.baseline.home,x.baseline.away].every(n=>n>=0)&&
 Date.parse(x.locked_at)<Date.parse(x.tipoff)&&
 Number.isFinite(Date.parse(x.locked_at))&&Number.isFinite(Date.parse(x.tipoff))&&
 String(x.game_id||'').length>0;
function variants(lock){
 if(!validInput(lock))return null;
 return {status:'SHADOW_ONLY',version:VERSION,approved:false,
  method:'Static pre-registered 0%,25%,50%,75%,100% historical-score-baseline blends of frozen scores. Independent of final results, sportsbook lines and win probabilities.',
  scores:WEIGHTS.map(w=>({baseline_weight:w,
   home:round((1-w)*lock.home+w*lock.baseline.home),
   away:round((1-w)*lock.away+w*lock.baseline.away)}))};
}
const onePerGame=(snapshots,version)=>{
 const latest=new Map();
 for(const x of snapshots||[]){
  if(x.model!==version||!validInput(x)||![x.grade?.home,x.grade?.away].every(finite))continue;
  const old=latest.get(String(x.game_id));
  if(!old||Date.parse(x.locked_at)>Date.parse(old.locked_at))latest.set(String(x.game_id),x);
 }
 return [...latest.values()].sort((a,b)=>Date.parse(a.tipoff)-Date.parse(b.tipoff)||String(a.game_id).localeCompare(String(b.game_id)));
};
function scoreMetrics(rows){
 const scored=rows.filter(x=>x?.projection&&[x.actual?.home,x.actual?.away,x.projection.home,x.projection.away].every(finite));
 return {games:scored.length,
  margin_mae:mean(scored.map(x=>Math.abs(x.projection.home-x.projection.away-x.actual.home+x.actual.away))),
  total_mae:mean(scored.map(x=>Math.abs(x.projection.home+x.projection.away-x.actual.home-x.actual.away))),
  home_mae:mean(scored.map(x=>Math.abs(x.projection.home-x.actual.home))),
  away_mae:mean(scored.map(x=>Math.abs(x.projection.away-x.actual.away)))};
}
function evaluate(snapshots,version){
 const items=onePerGame(snapshots,version);
 const retrospective=WEIGHTS.map(w=>{
  const rows=items.map(x=>({actual:x.grade,projection:variants(x).scores.find(v=>v.baseline_weight===w)}));
  return {baseline_weight:w,...scoreMetrics(rows)};
 });
 // Only predictions carrying this candidate in the immutable pregame archive
 // count as prospective. Historical arithmetic cannot become such evidence.
 const actualFrozen=items.filter(x=>x.ensemble_shadow?.version===VERSION&&
  x.ensemble_shadow.status==='SHADOW_ONLY'&&x.ensemble_shadow.approved===false&&
  Array.isArray(x.ensemble_shadow.scores)&&x.ensemble_shadow.scores.length===WEIGHTS.length&&
  x.ensemble_shadow.scores.every((v,i)=>v.baseline_weight===WEIGHTS[i]&&
   [v.home,v.away].every(finite) &&
   v.home===variants(x).scores[i].home&&v.away===variants(x).scores[i].away));
 const prospective=WEIGHTS.map((w,i)=>({baseline_weight:w,...scoreMetrics(actualFrozen.map(x=>({actual:x.grade,projection:x.ensemble_shadow.scores[i]})))}));
 const diff=x=>Math.abs(x.home+x.away-x.baseline.home-x.baseline.away);
 const segmented=[{label:'Small score-model disagreement (<8 total pts)',games:items.filter(x=>diff(x)<8)},
  {label:'Large score-model disagreement (8+ total pts)',games:items.filter(x=>diff(x)>=8)}]
  .map(s=>({label:s.label,raw:scoreMetrics(s.games.map(x=>({actual:x.grade,projection:x}))),baseline:scoreMetrics(s.games.map(x=>({actual:x.grade,projection:x.baseline})))}));
 return {status:'RESEARCH ONLY',approved:false,version:VERSION,graded_games:items.length,
  retrospective:{source:'Post-hoc fixed arithmetic using independent scores originally frozen before tipoff; NOT prospective validation of these variants',weights:retrospective},
  frozen:{source:'Variants explicitly frozen together with the original pregame capture; graded only after final',weights:prospective},
  disagreement:segmented,
  rollout_gate:'Only independently review 50/50 after 100 new distinct, genuinely frozen games with >=5% lower total AND margin MAE vs unblended possession scores. All model win probabilities, market prices, props and picks remain unchanged.'};
}
module.exports={VERSION,WEIGHTS,validInput,variants,onePerGame,scoreMetrics,evaluate};
