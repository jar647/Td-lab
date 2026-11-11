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
module.exports={hasDatedInjuries,hasClosingMarket,hasVerifiedMarket,marketProbability};
