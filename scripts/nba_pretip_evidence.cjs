'use strict';
// Evidence must be recorded strictly before tipoff. Missing values are not zero.
function validTime(value){if(typeof value!=='string'||!value.trim())return null;const n=Date.parse(value);return Number.isFinite(n)?n:null;}
function pretip(snapshot,game){
 const capture=validTime(snapshot?.captured_at);
 const tip=validTime(game?.date||game?.tipoff||game?.start_time);
 return capture!==null&&tip!==null&&capture<tip;
}
function finitePresent(v){return v!==null&&v!==undefined&&v!==''&&typeof v!=='boolean'&&Number.isFinite(Number(v));}
function hasDatedInjuries(game){
 return pretip(game?.pretip_injury_snapshot,game)&&Array.isArray(game.pretip_injury_snapshot.players);
}
function hasClosingMarket(game){
 const market=game?.closing_market;
 return pretip(market,game)&&['home_spread','total','home_moneyline','away_moneyline'].every(k=>finitePresent(market?.[k]));
}
module.exports={hasDatedInjuries,hasClosingMarket};
