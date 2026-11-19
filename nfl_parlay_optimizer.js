/* Offered-line research search on the existing NFL engine's aligned outcomes. */
(function(root,factory){const common=typeof module==='object'&&module.exports;
 const api=factory(common?require('./nfl_parlay'):root.PropShopNFLParlay,common?require('./nfl_book_review'):root.PropShopNFLBookReview,common?require('./market_odds'):root.CookItUpPricing,common?require('./nfl_goal1'):root.PropVaultGoal1);
 if(common)module.exports=api;root.PropShopNFLParlayOptimizer=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(parlay,book,pricing,goal){
 'use strict';
 const finite=x=>typeof x==='number'&&Number.isFinite(x),clamp=x=>Math.max(0,Math.min(1,x)),mean=a=>a.reduce((s,x)=>s+x,0)/Math.max(1,a.length);
 const game=c=>String(c.fixture?.game_id??c.fixture?.id??''),player=c=>String(c.p?.player_id??'');
 const pass=new Set(['passYards','recYards','receptions']);
 const limits=['Simulation frequencies are uncalibrated. Historical workload consistency is not confirmation of game-day usage.','Same-game legs use aligned outcomes. Distinct games are combined under an explicit independence assumption.','A bounded search compares supported exact lines; it does not establish the globally optimal ticket or a betting edge.','Individual leg odds are not multiplied. The actual combined book price must be entered after selection.'];
 function empty(reason,count=0){return {available:false,status:'PASS',legs:[],requested:count,shortfall:count,reason,jointFrequency:null,groups:[],limits:[...limits],calibrated:false,play:false};}
 function prepare(candidates,offers,simulations,now){
  if(!Array.isArray(candidates)||!Array.isArray(offers)||offers.length>120||typeof simulations?.get!=='function'||!finite(now))return [];
  const byKey=new Map(),ambiguous=new Set(),badGames=new Set(),fixtures=new Map(),physical=new Map(),fixtureKey=c=>JSON.stringify([game(c),c.fixture?.home,c.fixture?.away,c.fixture?.kickoff_at]);
  for(const c of candidates){if(!c?.key)continue;const g=game(c),f=fixtureKey(c),p=JSON.stringify([c.fixture?.home,c.fixture?.away,Date.parse(c.fixture?.kickoff_at)]);
   if(fixtures.has(g)&&fixtures.get(g)!==f)badGames.add(g);else fixtures.set(g,f);
   if(physical.has(p)&&physical.get(p)!==g){badGames.add(g);badGames.add(physical.get(p))}else physical.set(p,g);
   if(byKey.has(c.key)&&JSON.stringify([player(c),g,c.market,c.researchScore,f])!==JSON.stringify([player(byKey.get(c.key)),game(byKey.get(c.key)),byKey.get(c.key).market,byKey.get(c.key).researchScore,fixtureKey(byKey.get(c.key))]))ambiguous.add(c.key);else byKey.set(c.key,c)}
  const out=[],seen=new Set();
  for(const offer of offers){
   const c=byKey.get(offer?.candidateKey),line=book.parseLine(offer?.line),price=pricing.quote(offer?.odds);
   if(!c||ambiguous.has(c.key)||badGames.has(game(c))||!parlay.eligible(c,now)||line===null||line<goal.MIN_ALT[c.market]-.5||!price)continue;
   const sim=simulations.get(game(c)),rows=sim?.playerOutcomes;
   if(!sim?.outcomeSetId||!Number.isSafeInteger(sim.count)||sim.count<1000||sim.count>100000||!Array.isArray(rows))continue;
   const matching=rows.filter(r=>r.id===player(c)&&r.market===c.market),row=matching[0];
   if(matching.length!==1||row.outcomeSetId!==sim.outcomeSetId||!Array.isArray(row.values)||row.values.length!==sim.count)continue;
   let valid=true;for(const value of row.values)if(!Number.isSafeInteger(value)||value<0){valid=false;break}if(!valid)continue;
   const identity=JSON.stringify([c.key,line]);if(seen.has(identity))continue;seen.add(identity);
   const win=new Uint8Array(sim.count),nonLoss=new Uint8Array(sim.count);let wins=0,pushes=0;
   for(let i=0;i<sim.count;i++){win[i]=Number(row.values[i]>line);nonLoss[i]=Number(row.values[i]>=line);wins+=win[i];pushes+=Number(row.values[i]===line)}
   const rate=wins/sim.count;
   // Avoid constructing a ticket around an unsupported long shot or a token
   // threshold. Exact harder lines remain available in the ordinary reviewer.
   if(rate<.5||rate>.97)continue;
   const volume=c.market==='passYards'?'passAttempts':c.market==='rushYards'?'rushAttempts':'targets';
   const history=(c.p.last5GameStats||[]).map(r=>r?.[volume]).filter(finite),avg=mean(history),spread=avg>0?Math.sqrt(mean(history.map(v=>(v-avg)**2)))/avg:1;
   const stability=(1-clamp(spread))*.75+clamp(history.length/5)*.25;
   out.push({c,offer,line,price,win,nonLoss,rate,pushes,game:game(c),player:player(c),batch:sim.outcomeSetId,count:sim.count,stability,
    fixtureKey:fixtureKey(c),volume,workload:avg,historyGames:history.length,quality:(c.researchScore-60)/40,balance:1-clamp(Math.abs(rate-.75)/.25),identity});
  }
  return out;
 }
 function metrics(legs){
  const groups=new Map();for(const leg of legs){if(!groups.has(leg.game))groups.set(leg.game,[]);groups.get(leg.game).push(leg)}
  const result=[],correlations=[];
  for(const [id,rows]of groups){const first=rows[0];if(rows.some(r=>r.count!==first.count||r.batch!==first.batch||r.fixtureKey!==first.fixtureKey))return null;
   let wins=0,nonLoss=0;for(let i=0;i<first.count;i++){let w=true,n=true;for(const row of rows){w=w&&!!row.win[i];n=n&&!!row.nonLoss[i]}wins+=Number(w);nonLoss+=Number(n)}
   for(let a=0;a<rows.length;a++)for(let b=a+1;b<rows.length;b++){
    const x=rows[a],y=rows[b];let both=0;for(let i=0;i<first.count;i++)both+=Number(x.win[i]&&y.win[i]);
    const joint=both/first.count,independent=x.rate*y.rate,den=Math.sqrt(x.rate*(1-x.rate)*y.rate*(1-y.rate));
    correlations.push({a:x.offer.id,b:y.offer.id,gameId:id,jointFrequency:joint,ratio:independent?joint/independent:null,coefficient:den?(joint-independent)/den:null});
   }
   result.push({gameId:id,outcomeSetId:first.batch,parlay:{count:first.count,legs:rows.length,allWinCount:wins,nonLossCount:nonLoss,pushOnlyCount:nonLoss-wins,lossCount:first.count-nonLoss,allWinRate:wins/first.count,nonLossRate:nonLoss/first.count,pushOnlyRate:(nonLoss-wins)/first.count,lossRate:1-nonLoss/first.count}});
  }
  const combined=parlay.combine(result);if(legs.length>1&&combined.status!=='ready')return null;
  return {groups:result,correlations,jointFrequency:result.reduce((n,g)=>n*g.parlay.allWinRate,1),independentGames:result.length>1};
 }
 function utility(legs,m){
  if(!m||m.jointFrequency<=0||m.correlations.some(r=>r.ratio!==null&&r.ratio<.8))return null;
  let penalty=0;
  for(let a=0;a<legs.length;a++)for(let b=a+1;b<legs.length;b++)if(legs[a].game===legs[b].game&&legs[a].c.p.team===legs[b].c.p.team&&pass.has(legs[a].c.market)&&pass.has(legs[b].c.market))penalty+=.025;
  penalty+=m.correlations.filter(r=>r.coefficient>.65).length*.04;
  return .35*mean(legs.map(r=>r.balance))+.25*mean(legs.map(r=>r.quality))+.25*mean(legs.map(r=>r.stability))+.15*clamp(m.jointFrequency/Math.pow(.75,legs.length))-penalty;
 }
 function optimize(candidates,offers,simulations,{count=3,mode='across',gameId,now=Date.now()}={}){
  if(!Number.isInteger(count)||count<2||count>10||!['same','across'].includes(mode)||mode==='same'&&!gameId)return empty('Choose two to ten legs and a supported ticket type.',count);
  const pool=prepare(candidates,offers,simulations,now).filter(r=>mode!=='same'||r.game===String(gameId));
  const intrinsic=r=>.35*r.balance+.25*r.quality+.25*r.stability+.15*r.rate;
  pool.sort((a,b)=>intrinsic(b)-intrinsic(a)||a.identity.localeCompare(b.identity));
  if(pool.length<count)return empty('Not enough distinct offered lines meet current score, history and simulation requirements. No filler legs were added.',count);
  let beam=[{legs:[],last:-1,key:'',score:0}],best=null;
  for(let depth=1;depth<=count;depth++){
   const next=[];
   for(const prior of beam)for(let index=prior.last+1;index<pool.length;index++){
    const r=pool[index];if(prior.legs.some(p=>p.player===r.player||mode==='across'&&p.game===r.game))continue;
    const legs=[...prior.legs,r],m=metrics(legs),score=utility(legs,m);if(score===null)continue;
    next.push({legs,last:index,m,score,key:legs.map(r=>r.identity).sort().join('|')});
   }
   next.sort((a,b)=>b.score-a.score||a.key.localeCompare(b.key));beam=next.slice(0,48);if(!beam.length)return empty('Available book lines cannot form a complete supported ticket with distinct players and compatible shared outcomes.',count);best=beam[0];
  }
  return {available:true,status:'READY',requested:count,shortfall:0,objective:best.score,groups:best.m.groups,correlations:best.m.correlations,jointFrequency:best.m.jointFrequency,independentGames:best.m.independentGames,
   legs:best.legs.map(r=>({...r.c,offerId:r.offer.id,bookLine:r.line,bookOdds:r.price.american,offered:true,scenarioRate:r.rate,pushRate:r.pushes/r.count,
    selectionReason:r.c.researchScore+'/100 matchup; '+(100*r.rate).toFixed(1)+'% simulated at the exact book OVER '+r.line+'. Recent workload '+r.workload.toFixed(1)+' '+({passAttempts:'pass attempts',rushAttempts:'carries',targets:'targets'}[r.volume])+'/game across '+r.historyGames+' recorded appearances. '+(best.m.independentGames?'Adds a distinct game.':'Counted jointly with this game’s other legs; targets and carries compete.')})),
   reason:'Compared offered alternatives using matchup quality, observed workload consistency, line difficulty and shared game outcomes.',limits:[...limits],calibrated:false,play:false};
 }
 return {optimize};
});
