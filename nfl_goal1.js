/* THE PROP VAULT: game-first research decision layer.
   NO claimed sportsbook edge or validated probabilities.
   Browser + Node compatible; no external services.
*/
(function(root){
'use strict';
const MIN_ALT={rushYards:40,recYards:30,receptions:3,passYards:200};
const LABEL={rushYards:'rushing yards',recYards:'receiving yards',receptions:'receptions',passYards:'passing yards'};
function finite(value){
 if(value===null||value===undefined||value==='')return null;
 const n=Number(value);return Number.isFinite(n)?n:null;
}
function identity(c){return String(c.p.player_id||c.p.team+'|'+c.p.player)}
function marketId(c){return identity(c)+'|'+c.d.key}
function rankPlayers(candidates,max=3){
 const ordered=[...candidates].sort((a,b)=>b.score-a.score);
 const seen=new Set(),result=[];
 for(const c of ordered){
  const id=identity(c);
  if(!seen.has(id)){seen.add(id);result.push(c);if(result.length===max)break}
 }
 return result;
}
function buildTicket(candidates,count=4){
 const maximum=Math.max(1,Math.min(5,Math.trunc(count)||4));
 const pool=[...candidates].sort((a,b)=>b.score-a.score);
 const chosen=[];
 while(pool.length&&chosen.length<maximum){
  let bestAt=0,bestScore=-Infinity;
  for(let i=0;i<pool.length;i++){
   const c=pool[i];
   const samePlayer=chosen.filter(x=>identity(x)===identity(c)).length;
   const passExposure=chosen.filter(x=>x.p.team===c.p.team&&
    ['passYards','recYards','receptions'].includes(x.d.key)).length;
   const sameMarket=chosen.filter(x=>x.d.key===c.d.key).length;
   // Prefer different players, but keep correlated exposure possible when
   // there aren't enough supported alternatives. No invented filler legs.
   const value=c.score-samePlayer*22-passExposure*3-sameMarket*1.5;
   if(value>bestScore){bestAt=i;bestScore=value}
  }
  chosen.push(pool.splice(bestAt,1)[0]);
 }
 return chosen;
}
function alternatives(c,sim){
 const id=identity(c),kind=c.d.key;
 const floor=MIN_ALT[kind]||0;
 return sim.markets.filter(x=>x.id===id&&x.market===kind&&
   (x.line>=floor||Number(x.line)===Number(c.line))&&x.scenarioRate>=.12&&x.scenarioRate<=.95)
   .sort((a,b)=>a.line-b.line);
}
function script(sim,score){
 if(!sim||!Array.isArray(sim.teams)||sim.teams.length!==2)return {lines:['Game pace unavailable.'],score:null};
 const order=[...sim.teams].sort((a,b)=>a.team.localeCompare(b.team));
 const lines=order.map(t=>{
  const pass=finite(t.estimatedPassAttempts),run=finite(t.estimatedRushAttempts);
  const share=finite(t.passingShare);
  const style=share===null?'unknown pace':share>=58?'pass-leaning':share<=48?'run-leaning':'balanced';
  return t.team+': ~'+t.estimatedPlays+' offensive plays, '+pass+' pass attempts and '+run+
   ' rush attempts ('+style+').';
 });
 const byTeam=Object.fromEntries(order.map(t=>[t.team,t]));
 if(score&&Number.isFinite(Number(score.projected_home_points))&&
    Number.isFinite(Number(score.projected_away_points))){
  const h=Number(score.projected_home_points),a=Number(score.projected_away_points);
  lines.unshift('Unvalidated score baseline: '+score.away+' '+a.toFixed(1)+' at '+score.home+
   ' '+h.toFixed(1)+'. Projected total '+(h+a).toFixed(1)+
   ', margin '+score.home+' '+(h-a>=0?'+':'')+(h-a).toFixed(1)+'.');
 }
 lines.push('Targets and carries compete within each offense; quarterback passing yards follow completed receiver outcomes. These assumptions are not calibrated.');
 return {lines,score:score||null,teams:byTeam};
}
function applyAlternative(c,line,sim){
 const val=finite(line);
 if(val===null)return false;
 const option=alternatives(c,sim).find(x=>x.line===val);
 if(!option)return false;
 c.line=val;c.scenarioRate=option.scenarioRate;
 const games=Array.isArray(c.p.last5GameStats)?c.p.last5GameStats:[];
 const values=games.map(g=>finite(g[c.d.key])).filter(v=>v!==null);
 c.hits=values.filter(v=>v>=val).length;
 if(Array.isArray(c.reasons)){
  c.reasons[0]='Game-first scenario frequency: '+(option.scenarioRate*100).toFixed(1)+
   '% at this selected threshold (UNCALIBRATED).';
  c.reasons[2]='Cleared '+val+'+ in '+c.hits+' of the last '+values.length+' recorded games.';
 }
 return true;
}
function americanDecimal(raw){
 if(raw===null||raw===undefined)return null;
 const value=String(raw).trim();
 if(!/^[+-]?\d+(?:\.\d+)?$/.test(value))return null;
 const num=Number(value);
 if(!Number.isFinite(num)||Math.abs(num)<100)return null;
 return num>0?1+num/100:1+100/Math.abs(num);
}
function singlePrice(raw,scenarioRate){
 const decimal=americanDecimal(raw);
 if(decimal===null)return {valid:false};
 const implied=1/decimal;
 return {valid:true,decimal,implied,scenarioRate:finite(scenarioRate),
  impliedLabel:(100*implied).toFixed(1)+'%',
  note:'Research scenario comparison only. No validated edge or value recommendation.'};
}
function priceReview(fullOdds,reducedOdds,scenarioRate,verified,gameLeg){
 const full=americanDecimal(fullOdds);
 if(full===null)return {ok:false,text:'Enter actual full-ticket American odds (for example +313 or -110).'};
 const r=reducedOdds===null||String(reducedOdds).trim()===''?null:americanDecimal(reducedOdds);
 if(reducedOdds!==null&&String(reducedOdds).trim()!==''&&r===null)
  return {ok:false,text:'The optional reduced-ticket quote is invalid American odds.'};
 if(r!==null&&full<=r)return {ok:false,text:'The full-ticket decimal payout must exceed the reduced-ticket payout.'};
 let output='Full SGP quoted break-even: '+(100/full).toFixed(1)+'%. ';
 if(r!==null)output+='Removing one leg changes the decimal payout by '+((full/r-1)*100).toFixed(1)+
  '%; incremental leg break-even '+(100*r/full).toFixed(1)+'%. ';
 if(gameLeg)output+='Full SGP scenario frequency is unavailable because the game-market leg is not jointly simulated. ';
 else if(finite(scenarioRate)!==null)
  output+='Correlated player-prop scenario frequency: '+(100*scenarioRate).toFixed(1)+'% (UNCALIBRATED). ';
 else output+='Correlated full-ticket scenario frequency unavailable. ';
 const gates=verified?.gates||{};
 const eligible=verified?.bet_recommendations_enabled===true&&
  Object.keys(gates).length>0&&Object.values(gates).every(Boolean);
 if(!eligible){
  const missing=Object.entries(gates).filter(([k,passed])=>!passed).map(([k])=>k.replace(/_/g,' '));
  output+='NO BET: '+(missing.length?missing.join(', ')+' not verified':'model/odds/active-list verification unavailable')+
   '. A numerical scenario edge is not a validated betting edge.';
 }else output+='All configured verification gates report ready. Independently confirm the exact market and offered price.';
 return {ok:true,text:output,implied:1/full,betReady:eligible};
}
function gameMarketDraft(type,side,line,odds,game){
 const kind=String(type||'NONE').toUpperCase(),direction=String(side||'').toUpperCase();
 if(kind==='NONE')return {ok:true,leg:null};
 if(!game||!game.home||!game.away)return {ok:false,error:'A verified game fixture is required.'};
 const sides=(kind==='TOTAL'?['OVER','UNDER']:['HOME','AWAY']);
 if(!['ML','ATS','TOTAL'].includes(kind)||!sides.includes(direction))
  return {ok:false,error:'Choose a supported market and matching side.'};
 const numeric=finite(line);
 if(kind!=='ML'&&(numeric===null||Math.abs(numeric)>120))
  return {ok:false,error:'Spread or total requires an actual numeric sportsbook line.'};
 if(kind==='TOTAL'&&numeric<=0)return {ok:false,error:'Total must be positive.'};
 if(kind==='ML'&&String(line||'').trim()!=='')
  return {ok:false,error:'Moneyline does not require a points line.'};
 const parsedOdds=String(odds||'').trim()===''?null:americanDecimal(odds);
 if(String(odds||'').trim()!==''&&parsedOdds===null)
  return {ok:false,error:'Use valid American odds, or leave the quote blank.'};
 const team=direction==='HOME'?game.home:direction==='AWAY'?game.away:null;
 const name=kind==='TOTAL'?'Total '+(direction==='OVER'?'Over ':'Under ')+numeric:
  kind==='ML'?team+' moneyline':team+' spread '+(numeric>=0?'+':'')+numeric;
 return {ok:true,leg:{type:kind,side:direction,line:kind==='ML'?null:numeric,odds:String(odds||'').trim(),
  name,team,source:'USER_ENTERED_NOT_MODELED'}};
}
const api={MIN_ALT,LABEL,rankPlayers,buildTicket,alternatives,applyAlternative,script,americanDecimal,singlePrice,priceReview,gameMarketDraft,marketId,identity};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.PropVaultGoal1=api;
})(typeof self!=='undefined'?self:typeof globalThis!=='undefined'?globalThis:this);
