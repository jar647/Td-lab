/* NFL research drafts and simulation-group comparison. No invented book price,
   independent player-leg multiplication, calibrated edge or betting approval. */
(function(root,factory){
 const common=typeof module==='object'&&module.exports;
 const api=factory(common?require('./nfl_goal1.js'):root.PropVaultGoal1,common?require('./market_odds.js'):root.CookItUpPricing,common?require('./nfl_top_plays.js'):root.PropShopNFLTopPlays,common?require('./nfl_player_board.js'):root.PropShopNFLBoard);
 if(common)module.exports=api;
 root.PropShopNFLParlay=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(goal,pricing,top,board){
 'use strict';
 const markets=new Set(['passYards','rushYards','recYards','receptions']);
 const positions={passYards:['QB'],rushYards:['QB','RB','WR'],recYards:['RB','WR','TE'],receptions:['RB','WR','TE']};
 const finite=value=>typeof value==='number'&&Number.isFinite(value);
 const id=value=>typeof value==='string'&&value.trim()?value.trim():Number.isSafeInteger(value)&&value>=0?String(value):null;
 const fixtureId=fixture=>id(fixture?.game_id??fixture?.id);
 const time=value=>typeof value==='string'&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)?Date.parse(value):NaN;
 function eligible(candidate,now){
  const c=candidate,p=c?.p,g=c?.fixture,market=c?.market;
  if(!p||!g||!markets.has(market)||c.side!=='at_least'||!id(p.player_id)||p.playerAppearancesVerified!==true||
   !finite(c.researchScore)||c.researchScore<60||c.researchScore>100||!finite(c.score)||
   !finite(c.line)||c.line<(goal?.MIN_ALT?.[market]??Infinity)||!finite(c.scenarioRate)||c.scenarioRate<0||c.scenarioRate>1||
   !positions[market].includes(p.pos)||String(p.availability).toUpperCase()!=='ROSTER_ACTIVE'||String(p.qbRole).toUpperCase()==='BACKUP')return false;
  const injury=[p.injuryReportStatus,p.injuryPracticeStatus].map(s=>String(s||'').toUpperCase()).join(' ');
  if(/(?:^|[^A-Z])(?:OUT|DOUBTFUL|QUESTIONABLE|Q|IR|PUP|INACTIVE|SUSPENDED|DNP)(?:$|[^A-Z])|INJURED_RESERVE|DID[\s_]+NOT[\s_]+PARTICIPATE/.test(injury))return false;
  if(p.pos==='QB'&&String(p.depthChart?.unit).toLowerCase()==='reserve')return false;
  if(!finite(p.last5GamesPlayed)||p.last5GamesPlayed<3)return false;
  const history=Array.isArray(p.last5GameStats)&&p.last5GameStats.length?p.last5GameStats:p.seasonGameStats;
  if(!Array.isArray(history)||history.filter(row=>row&&row.didNotPlay!==true&&row.played!==false&&finite(row[market])&&row[market]>=0).length<3)return false;
  const kickoff=time(g.kickoff_at);
  return !!fixtureId(g)&&typeof g.home==='string'&&!!g.home.trim()&&typeof g.away==='string'&&!!g.away.trim()&&g.home!==g.away&&
   ((p.team===g.home&&p.opp===g.away)||(p.team===g.away&&p.opp===g.home))&&Number.isFinite(kickoff)&&kickoff>now&&kickoff-now<=7*86400000;
 }
 function generate(candidates,{count=3,mode='across',gameId,now=Date.now()}={}){
  const requested=Number.isInteger(count)&&count>=2&&count<=4?count:0;
  const empty=reason=>({legs:[],requested,shortfall:requested,reason});
  if(!requested)return empty('Choose 2 to 4 legs.');
  if(mode!=='across'&&mode!=='same')return empty('Choose across games or one specified game.');
  if(!finite(now)||!Array.isArray(candidates))return empty('Current supported NFL candidates are unavailable.');
  const selectedGame=id(gameId);if(mode==='same'&&!selectedGame)return empty('Choose a verified game for a same-game draft.');
  const signatures=new Map(),ambiguous=new Set();
  for(const c of candidates){const key=fixtureId(c?.fixture);if(!key)continue;const signature=JSON.stringify([c.fixture.home,c.fixture.away,c.fixture.kickoff_at]);if(signatures.has(key)&&signatures.get(key)!==signature)ambiguous.add(key);else signatures.set(key,signature)}
  const tie=c=>String(c.key||[fixtureId(c.fixture),id(c.p.player_id),c.market].join('|'));
  const pool=candidates.filter(c=>eligible(c,now)&&!ambiguous.has(fixtureId(c.fixture))&&(mode!=='same'||fixtureId(c.fixture)===selectedGame))
   .sort((a,b)=>b.researchScore-a.researchScore||b.score-a.score||(tie(a)<tie(b)?-1:tie(a)>tie(b)?1:0));
  const players=new Set(),games=new Set(),legs=[];
  for(const c of pool){
   const player=id(c.p.player_id),game=fixtureId(c.fixture);
   if(players.has(player)||mode==='across'&&games.has(game))continue;
   players.add(player);games.add(game);legs.push(c);if(legs.length===requested)break;
  }
  const shortfall=requested-legs.length;
  return {legs,requested,shortfall,reason:shortfall?'Only '+legs.length+' supported distinct '+(mode==='across'?'players from different games':'players in this game')+' available; no filler legs added.':'Research draft generated.'};
 }
 function generateAnytime(candidates,{now=Date.now()}={}){
  const empty=reason=>({legs:[],requested:5,shortfall:5,reason});
  if(!finite(now)||!Array.isArray(candidates)||typeof top?.select!=='function'||typeof board?.isReserveQuarterback!=='function')return empty('Current anytime-TD research rankings are unavailable. Scores are not touchdown probabilities.');
  const signatures=new Map(),ambiguous=new Set(),blocked=/^(OUT|INACTIVE|SUSPENDED|IR|PUP|RES|DEV|CUT|RET|EXE|TRD|TRT|DOUBTFUL)$/;
  for(const c of candidates){const key=fixtureId(c?.fixture);if(!key)continue;const signature=JSON.stringify([c.fixture.home,c.fixture.away,c.fixture.kickoff_at]);if(signatures.has(key)&&signatures.get(key)!==signature)ambiguous.add(key);else signatures.set(key,signature)}
  const pool=candidates.filter(c=>{
   const p=c?.p,g=c?.fixture;
   if(!p||!g||c.market!=='anytime_td'||c.category!=='TD'||c.side!=='winner'||!id(p.player_id)||
    !finite(c.researchScore)||c.researchScore<60||c.researchScore>100||!finite(c.score)||p.playerAppearancesVerified!==true||
    !['QB','RB','WR','TE'].includes(p.pos)||p.qbRole==='BACKUP'||board.isReserveQuarterback(p)||!['ROSTER_ACTIVE','QUESTIONABLE'].includes(String(p.availability).toUpperCase())||
    blocked.test(String(p.availability).toUpperCase())||blocked.test(String(p.injuryReportStatus||'').toUpperCase()))return false;
   const sample=p.seasonGamesPlayed??p.games;
   if(!['number','string'].includes(typeof sample)||typeof sample==='string'&&!sample.trim()||!Number.isFinite(Number(sample))||Number(sample)<2)return false;
   const kickoff=time(g.kickoff_at),key=fixtureId(g);
   return !!key&&!ambiguous.has(key)&&typeof g.home==='string'&&!!g.home.trim()&&typeof g.away==='string'&&!!g.away.trim()&&g.home!==g.away&&
    ((p.team===g.home&&p.opp===g.away)||(p.team===g.away&&p.opp===g.home))&&Number.isFinite(kickoff)&&kickoff>now&&kickoff-now<=7*86400000;
  });
  // Reuse the board's ordering and player deduplication. Its QUESTIONABLE and
  // practice flags stay visible; TD research does not require yardage history.
  const legs=top.select({candidates:pool},'TD',5),shortfall=5-legs.length;
  return {legs,requested:5,shortfall,reason:(shortfall?'Only '+legs.length+' qualifying anytime-TD plays; no filler legs added. ':'')+'Scores are research rankings, not touchdown probabilities.'};
 }
 function validGroup(group){
  const p=group?.parlay;if(!id(group?.gameId)||!p||!Number.isSafeInteger(p.count)||p.count<1000||!Number.isInteger(p.legs)||p.legs<1||p.legs>4)return false;
  const fields=['allWin','nonLoss','pushOnly','loss'];
  if(fields.some(name=>!Number.isSafeInteger(p[name+'Count'])||p[name+'Count']<0||p[name+'Count']>p.count||
   !finite(p[name+'Rate'])||p[name+'Rate']<0||p[name+'Rate']>1||Math.abs(p[name+'Rate']-p[name+'Count']/p.count)>1e-10))return false;
  return p.allWinCount<=p.nonLossCount&&p.allWinRate<=p.nonLossRate&&p.pushOnlyCount===p.nonLossCount-p.allWinCount&&p.lossCount===p.count-p.nonLossCount;
 }
 function combine(groups,{combinedOdds}={}){
  const empty=status=>({status,allWinRate:null,pushOnlyRate:null,lossRate:null,groups:[],independentGames:false,price:null,modelDifference:null,play:false,verifiedValue:false});
  if(!Array.isArray(groups)||!groups.length||groups.length>4||groups.some(group=>!validGroup(group))||new Set(groups.map(group=>id(group.gameId))).size!==groups.length)return empty('unavailable');
  const legs=groups.reduce((total,group)=>total+group.parlay.legs,0);if(legs<2||legs>4)return empty('unavailable');
  const entered=combinedOdds!==null&&combinedOdds!==undefined&&(typeof combinedOdds!=='string'||!!combinedOdds.trim());
  const price=entered&&(typeof combinedOdds==='number'||typeof combinedOdds==='string')?pricing?.quote(combinedOdds):null;
  if(entered&&!price)return empty('invalid-odds');
  // Dependence within each game comes from its actual joint simulation. Only
  // distinct game groups are multiplied, under an explicit independence assumption.
  const allWinRate=groups.reduce((rate,group)=>rate*group.parlay.allWinCount/group.parlay.count,1);
  const nonLossRate=groups.reduce((rate,group)=>rate*group.parlay.nonLossCount/group.parlay.count,1);
  const pushOnlyRate=nonLossRate-allWinRate,lossRate=1-nonLossRate;
  const hasPushPath=pushOnlyRate>0;
  return {status:'ready',allWinRate,pushOnlyRate,lossRate,groups:[...groups],independentGames:groups.length>1,price,
   modelDifference:price&&!hasPushPath?allWinRate-price.implied:null,play:false,verifiedValue:false};
 }
 return {generate,generateAnytime,combine,eligible};
});
