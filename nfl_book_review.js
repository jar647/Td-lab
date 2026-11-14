/* Exact sportsbook OVER settlement and American-odds research comparison.
   Frequencies describe the model's floored whole-number outcomes, not a
   calibrated probability or verified betting edge. No recommendation signal.
*/
(function(root,factory){
 const api=factory(typeof module==='object'&&module.exports?require('./market_odds.js'):root.CookItUpPricing);
 if(typeof module==='object'&&module.exports)module.exports=api;
 root.PropShopNFLBookReview=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(pricing){
 'use strict';
 const markets=new Set(['passYards','rushYards','recYards','receptions']);
 function parseLine(raw){
  if(typeof raw!=='number'&&typeof raw!=='string')return null;
  if(typeof raw==='string'&&!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw.trim()))return null;
  const line=Number(raw);
  return Number.isFinite(line)&&line>=0&&line<=10000&&Number.isInteger(line*2)?line:null;
 }
 function validSettlement(row){
  if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.id!=='string'||!row.id.trim()||
   !markets.has(row.market)||!Number.isSafeInteger(row.count)||row.count<1000||!Array.isArray(row.bins)||!row.bins.length)return false;
  const seen=new Set();let total=0;
  for(const bin of row.bins){
   if(!Array.isArray(bin)||bin.length!==2||!Number.isSafeInteger(bin[0])||bin[0]<0||
    !Number.isSafeInteger(bin[1])||bin[1]<0||seen.has(bin[0]))return false;
   seen.add(bin[0]);total+=bin[1];
   if(!Number.isSafeInteger(total)||total>row.count)return false;
  }
  return total===row.count;
 }
 function evaluate({settlement,line,odds}={}){
  const unavailable=status=>({status,play:false,verifiedValue:false});
  const posted=parseLine(line);
  if(posted===null)return unavailable('invalid-line');
  const price=pricing?.quote(odds);
  if(!price)return unavailable('invalid-odds');
  if(!validSettlement(settlement))return unavailable('unavailable');
  let winCount=0,pushCount=0,lossCount=0;
  for(const [value,n] of settlement.bins){
   if(value>posted)winCount+=n;
   else if(value===posted)pushCount+=n;
   else lossCount+=n;
  }
  const count=settlement.count,winRate=winCount/count,pushRate=pushCount/count,lossRate=lossCount/count;
  // Compare frequencies on the same denominator: every model run, including
  // refunds. Quoted implied probability applies only among resolved wagers.
  const requiredWinRate=price.implied*(1-pushRate);
  return {status:'ready',line:posted,winCount,pushCount,lossCount,count,winRate,pushRate,lossRate,
   resolvedWinRate:winCount+lossCount?winCount/(winCount+lossCount):null,
   requiredWinRate,modelDifference:winRate-requiredWinRate,
   decimal:price.decimal,american:price.american,implied:price.implied,
   play:false,verifiedValue:false};
 }
 return {parseLine,evaluate};
});
