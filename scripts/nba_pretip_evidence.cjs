'use strict';
// Evidence must be recorded strictly before tipoff. Missing values are not zero.
function validTime(value){if(typeof value!=='string'||!value.trim())return null;const n=Date.parse(value);return Number.isFinite(n)?n:null;}
function pretip(snapshot,game){
 const capture=validTime(snapshot?.captured_at);
 const tip=validTime(game?.date??game?.tipoff??game?.start_time);
 return capture!==null&&tip!==null&&capture<tip;
}
function finitePresent(v){return (typeof v==='number'&&Number.isFinite(v))||(typeof v==='string'&&v.trim()!==''&&Number.isFinite(Number(v)));}
function hasDatedInjuries(game){
 return pretip(game?.pretip_injury_snapshot,game)&&Array.isArray(game.pretip_injury_snapshot.players);
}
function hasClosingMarket(game){
 const market=game?.closing_market;
 return pretip(market,game)&&['home_spread','total','home_moneyline','away_moneyline'].every(k=>finitePresent(market?.[k]))&&Number(market.total)>0&&Number(market.home_moneyline)!==0&&Number(market.away_moneyline)!==0;
}
function hasVerifiedMarket(game){
 const market=game?.closing_market;
 return hasClosingMarket(game)&&typeof market.source==='string'&&market.source.trim().length>0&&typeof market.source_event_id==='string'&&market.source_event_id.trim().length>0&&validTime(market.source_published_at)!==null&&validTime(market.source_published_at)<=validTime(market.captured_at)&&market.verified===true;
}
function marketProbability(game){
 if(!hasVerifiedMarket(game))return null;
 const m=game.closing_market;
 const implied=o=>{const n=Number(o);return n<0?-n/(-n+100):100/(n+100)};
 const home=implied(m.home_moneyline),away=implied(m.away_moneyline),total=home+away;
 return total>0&&Number.isFinite(total)?home/total:null;
}

function pairedMarketBenchmark(rows,games){
 const lookup=new Map();
 for(const g of games||[]){
  if(!hasVerifiedMarket(g))continue;
  const key=[String(g.date),String(g.home),String(g.away)].join('|');
  if(lookup.has(key)){lookup.set(key,null);continue;} // Null is a permanent ambiguity tombstone, including for 3+ matching records.
  lookup.set(key,g);
 }
 const paired=[];
 const rowCounts=new Map();
 for(const r of rows||[]){const key=[String(r.date),String(r.home),String(r.away)].join('|');rowCounts.set(key,(rowCounts.get(key)||0)+1);}
 const clip=p=>Math.max(1e-12,Math.min(1-1e-12,p));
 for(const r of rows||[]){
  const key=[String(r.date),String(r.home),String(r.away)].join('|');
  if(rowCounts.get(key)!==1)continue; // Duplicate model forecasts cannot multiply a game's weight.
  const g=lookup.get(key);
  if(!g||![r.probability,r.outcome].every(Number.isFinite)||![0,1].includes(r.outcome)||r.probability<0||r.probability>1)continue;
  const market=marketProbability(g);if(market===null)continue;
  const brier=p=>(p-r.outcome)**2;
  const logloss=p=>-(r.outcome*Math.log(clip(p))+(1-r.outcome)*Math.log(1-clip(p)));
  paired.push({date:r.date,home:r.home,away:r.away,modelBrier:brier(r.probability),marketBrier:brier(market),modelLogLoss:logloss(r.probability),marketLogLoss:logloss(market)});
 }
 const avg=k=>paired.length?paired.reduce((a,r)=>a+r[k],0)/paired.length:null;
 return {pairedGames:paired.length,modelBrier:avg('modelBrier'),marketBrier:avg('marketBrier'),modelLogLoss:avg('modelLogLoss'),marketLogLoss:avg('marketLogLoss'),beatsMarketBrier:paired.length>=30?avg('modelBrier')<avg('marketBrier'):null,validatedForBetting:false,method:'Exact tipoff/team identity; verified pre-tip two-sided moneylines; no-vig market probability; paired historical research only. No ROI without archived executable odds.',rows:paired};
}
module.exports={hasDatedInjuries,hasClosingMarket,hasVerifiedMarket,marketProbability,pairedMarketBenchmark};
