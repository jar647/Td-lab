/* Shared NFL game-first player research. Matchup scores never use prices. */
(function(root,factory){
 const node=typeof module==='object'&&module.exports;
 const api=factory(node?require('./nfl_goal1.js'):root.PropVaultGoal1,node?require('./nfl_player_board.js'):root.PropShopNFLBoard,node?require('./nfl_td_matchup.js'):root.PropShopNFLTD);
 if(node)module.exports=api;root.PropShopNFLTopPlays=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(goal,board,td){
'use strict';
const categories=['ALL','PASS','RUSH','REC','CATCH','TD'];
const defs=[
 {key:'rushYards',season:'playerRushYards',recent:'recent3RushYards',volume:'playerCarries',volumeLabel:'carries/game',def:'defRushYardsAllowed',ratio:'RUSH',label:'rushing yards',positions:['RB','QB'],steps:[25,40,50,60,70,80,100]},
 {key:'recYards',season:'playerRecYards',recent:'recent3RecYards',volume:'playerTargets',volumeLabel:'targets/game',def:'defRecYardsAllowed',ratio:'REC',label:'receiving yards',positions:['WR','TE','RB'],steps:[20,25,30,40,50,60,70,80,100]},
 {key:'receptions',season:'playerReceptions',recent:'recent3Receptions',volume:'playerTargets',volumeLabel:'targets/game',def:'defReceptionsAllowed',ratio:'CATCH',label:'receptions',positions:['WR','TE','RB'],steps:[2,3,4,5,6,7,8]},
 {key:'passYards',season:'playerPassYards',recent:'recent3PassYards',volume:'playerPassAttempts',volumeLabel:'attempts/game',def:'defPassYardsAllowed',ratio:'PASS',label:'passing yards',positions:['QB'],steps:[150,175,200,225,250,275,300]}
];
const byMarket=Object.fromEntries(defs.map(d=>[d.key,d]));
const n=v=>!['number','string'].includes(typeof v)||typeof v==='string'&&!v.trim()?null:Number.isFinite(Number(v))?Number(v):null;
const identity=p=>String(p.player_id||p.team+'|'+p.player);
const gameKey=g=>[String(g.home||''),String(g.away||'')].sort().join('|');
const fixtureId=g=>{const id=g&&(g.game_id??g.id);return typeof id==='string'&&id.trim()?id.trim():typeof id==='number'&&Number.isFinite(id)?String(id):'';};
const stamp=v=>typeof v==='string'&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)?Date.parse(v):NaN;
const fresh=(value,now)=>{const time=stamp(value);return Number.isFinite(time)&&time<=now+300000&&now-time<=48*3600000;};
function mergeRecords(feed,rosterPlayers){
 const record=r=>r&&typeof r==='object'&&!Array.isArray(r);
 const result=(Array.isArray(feed)?feed:[]).filter(record);
 const key=r=>board.gameKey(r)+'|'+String(r.player_id||r.player);
 const seen=new Set(result.map(key));
 for(const row of Array.isArray(rosterPlayers)?rosterPlayers:[]){
  if(!record(row))continue;
  const identity=key(row);if(seen.has(identity))continue;
  seen.add(identity);result.push(row);
 }
 return result;
}
function choose(p,d,scenarioLookup){
 if(!p||!d||!byMarket[d.key]||!scenarioLookup||typeof scenarioLookup.get!=='function')return null;
 d=byMarket[d.key];
 if(p.qbRole==='BACKUP'||board.isReserveQuarterback(p)||!d.positions.includes(p.pos)||p.playerAppearancesVerified===false)return null;
 const sample=n(p.last5GamesPlayed)||0;if(sample<3)return null;
 const rating=goal.matchupRating(p,d.ratio),researchScore=rating?.score;
 const cfg=goal.SPECS[d.ratio];
 if(!goal.qualifies(researchScore)||[cfg.def,cfg.volume,cfg.player,cfg.usage].some(k=>n(p[k])===null||n(p[k])<0))return null;
 const season=n(p[d.season]),recent=n(p[d.recent]),volume=n(p[d.volume]);
 if(season===null||season<=0||recent===null||volume===null)return null;
 if(d.key==='rushYards'&&volume<5||d.key==='passYards'&&volume<20||['recYards','receptions'].includes(d.key)&&volume<3)return null;
 const last=(Array.isArray(p.last5GameStats)?p.last5GameStats:[]).map(g=>n(g?.[d.key])).filter(v=>v!==null);
 if(last.length<3)return null;
 const ratio=n(p.defenseOpponentRatio?.[d.ratio]);
 const id=identity(p),floor=goal.MIN_ALT[d.key];
 const viable=d.steps.map(line=>{
  const scenario=scenarioLookup.get(id+'|'+d.key+'|'+line);
  return {line,hits:last.filter(v=>v>=line).length,scenarioRate:n(scenario?.scenarioRate),modeledMean:n(scenario?.modeledMean)};
 }).filter(x=>x.scenarioRate!==null&&x.scenarioRate>=.57&&x.scenarioRate<=1&&x.modeledMean>0&&x.line<=x.modeledMean*1.04);
 if(!viable.length)return null;
 const ranked=viable.map(x=>({...x,utility:x.scenarioRate*65+x.line/Math.max(1,x.modeledMean)*38+(x.line>=floor?9:-24)})).sort((a,b)=>b.utility-a.utility||b.line-a.line);
 const best=ranked[0];if(best.line<floor&&best.utility<38)return null;
 const status=String(p.injuryReportStatus||'NOT_REPORTED').toUpperCase(),availability=String(p.availability||'UNVERIFIED').toUpperCase();
 if(!['ROSTER_ACTIVE','QUESTIONABLE'].includes(availability)||/OUT|IR|PUP|SUSPENDED|INACTIVE|DOUBTFUL/.test(status+' '+availability))return null;
 const practice=String(p.injuryPracticeStatus||'NOT_REPORTED').toUpperCase(),practiceFlag=/DNP_PRACTICE|LIMITED_PRACTICE/.test(practice);
 const injuryFlag=/QUESTIONABLE|DOUBTFUL|LIMITED|UNVERIFIED|NOT_REPORTED/.test(status+' '+availability)||practiceFlag;
 const score=best.utility+best.scenarioRate*20+Math.min(1,sample/5)*8-(injuryFlag?12:0);
 const reasons=[`Game-first scenario frequency: ${(best.scenarioRate*100).toFixed(1)}% at this line (UNCALIBRATED).`,`Recent form: ${recent.toFixed(d.key==='receptions'?1:0)} ${d.label}/game over the latest three recorded games versus ${season.toFixed(d.key==='receptions'?1:0)} season average.`,`Cleared ${best.line}+ in ${best.hits} of the last ${last.length} recorded games.`,`Workload: ${volume.toFixed(1)} ${d.volumeLabel}.`];
 reasons.push(ratio!==null?`Opponent matchup factor: ${ratio.toFixed(2)}× its opponents' baseline in this category (${ratio>1.04?'favorable':ratio<.96?'challenging':'roughly neutral'}).`:'Opponent-adjusted category data unavailable; selection relies on production and workload.');
 const risks=[];
 if(injuryFlag)risks.push(`Game-day status not confirmed (${status}; roster: ${availability}).`);
 if(practiceFlag)risks.push(`Practice report: ${practice.replace('_PRACTICE','')}. This is NOT an official game-day OUT designation.`);
 if(p.pos==='RB'&&Array.isArray(p.possibleReturningTeammates)&&p.possibleReturningTeammates.length)risks.push('Potential returning teammates could alter workload.');
 if(last.length<5)risks.push('Limited recent sample.');
 if(best.line<floor)risks.push('Very conservative alternate line. Book availability and price are unverified; omit it if payout contribution is negligible.');
 return {p,d,line:best.line,score,researchScore,reasons,risks,hits:best.hits,sample,injuryFlag,scenarioRate:best.scenarioRate,modeledMean:best.modeledMean};
}
function order(a,b){return b.researchScore-a.researchScore||b.score-a.score||String(a.key).localeCompare(String(b.key));}
function select(result,category='ALL',limit=3){
 if(!categories.includes(category))return [];
 const count=typeof limit==='number'&&Number.isFinite(limit)?Math.max(0,Math.min(3,Math.trunc(limit))):3;
 if(!count)return [];
 const seen=new Set(),out=[];
 for(const c of (Array.isArray(result?.candidates)?result.candidates:[]).filter(c=>c&&c.p&&Number.isFinite(c.researchScore)&&Number.isFinite(c.score)).sort(order)){
  if(!goal.qualifies(c.researchScore)||!['at_least','winner'].includes(c.side)||category!=='ALL'&&c.category!==category)continue;
  const id=c.p.team+'|'+identity(c.p);if(seen.has(id))continue;seen.add(id);out.push(c);if(out.length===count)break;
 }
 return out;
}
function excluded(options,p,category,key,market){
 const values=options.excluded;if(!values)return false;
 if(typeof values==='function')return !!values(p,category);
 const has=Array.isArray(values)?v=>values.includes(v):v=>values.has(v);
 return [identity(p),p.player,key,p.player+'|'+market,identity(p)+'|'+market,p.player+'|'+category].some(has);
}
function alternatives(candidate,lookup){
 const actual=candidate.p.last5GameStats.map(g=>n(g?.[candidate.d.key])).filter(v=>v!==null);
 const values=[];
 for(const line of candidate.d.steps){
  const row=lookup.get(identity(candidate.p)+'|'+candidate.d.key+'|'+line),rate=n(row?.scenarioRate),mean=n(row?.modeledMean),isDefault=line===candidate.line;
  if(rate===null||rate<0||rate>1||mean===null||mean<=0)continue;
  if(!isDefault&&(line<goal.MIN_ALT[candidate.d.key]||rate<.12||rate>.95))continue;
  values.push({line,hits:actual.filter(v=>v>=line).length,sample:actual.length,scenarioRate:rate,modeledMean:mean,default:isDefault});
 }
 return values.sort((a,b)=>a.line-b.line);
}
function build(records,fixture,simulation,options={}){
 const empty=reason=>({ready:false,status:'pass',reason,candidates:[],topThree:[],bestSingle:null,visible:[],fixture:fixture||null});
 const now=options.now===undefined?Date.now():options.now;
 if(typeof now!=='number'||!Number.isFinite(now)||!Array.isArray(records))return empty('Player feed or current time is unavailable.');
 if(!fresh(options.feedGeneratedAt,now)||!fresh(options.fixturesGeneratedAt,now))return empty('Fresh NFL player and game feeds within 48 hours are required.');
 if(typeof fixture?.home!=='string'||!fixture.home.trim()||typeof fixture?.away!=='string'||!fixture.away.trim()||fixture.home===fixture.away||!fixtureId(fixture))return empty('Choose a verified NFL game.');
 const fixtures=Array.isArray(options.fixtures)?options.fixtures:options.fixtures?.games;
 const matches=Array.isArray(fixtures)?fixtures.filter(g=>g&&gameKey(g)===gameKey(fixture)):[];
 if(matches.length!==1)return empty('Exactly one verified fixture is required for this matchup.');
 const verified=matches[0],kickoff=stamp(verified.kickoff_at);
 if(fixtures.filter(g=>fixtureId(g)===fixtureId(verified)).length!==1)return empty('Exactly one verified fixture identity is required.');
 if(!fixtureId(verified)||fixtureId(verified)!==fixtureId(fixture)||stamp(fixture.kickoff_at)!==kickoff||!Number.isFinite(kickoff))return empty('Verified fixture identity or timezone-aware kickoff is unavailable.');
 if(kickoff<=now)return empty('Game has started or finished; no new player recommendations.');
 if(kickoff-now>7*86400000)return empty('Choose a game within the next seven days.');
 if(options.excluded&&!Array.isArray(options.excluded)&&typeof options.excluded!=='function'&&typeof options.excluded.has!=='function')return empty('Player exclusion context is unavailable.');
 const lookup=new Map(),duplicates=new Set();
 const simulationAvailable=Array.isArray(simulation?.markets);
 for(const row of simulationAvailable?simulation.markets:[]){
  if(!row||!byMarket[row.market]||!['number','string'].includes(typeof row.id)||!String(row.id).trim()||n(row.line)===null||n(row.line)<=0||n(row.scenarioRate)===null||n(row.scenarioRate)<0||n(row.scenarioRate)>1||n(row.modeledMean)===null||n(row.modeledMean)<=0)continue;
  const key=String(row.id)+'|'+row.market+'|'+row.line;
  if(lookup.has(key)||duplicates.has(key)){lookup.delete(key);duplicates.add(key)}else lookup.set(key,row);
 }
 const candidates=[];
 try{
  for(const d of defs){
   const rows=board.rows(records,d.ratio,{game:gameKey(verified),excluded:p=>excluded(options,p,d.ratio,'',d.key)});
   for(const row of rows.filter(r=>r.recommendable)){
    const c=choose(row.record,d,lookup);if(!c)continue;
    const key=[fixtureId(verified),c.p.team,identity(c.p),d.key].join('|');if(excluded(options,c.p,d.ratio,key,d.key))continue;
    candidates.push({...c,key,market:d.key,category:d.ratio,side:'at_least',rating:row.rating,roleLabel:row.roleLabel,opponentContext:row.opponentContext,alternatives:alternatives(c,lookup)});
   }
  }
  for(const row of board.rows(records,'TD',{game:gameKey(verified),excluded:p=>excluded(options,p,'TD','','anytime_td')}).filter(r=>r.recommendable)){
   const p=row.record,key=[fixtureId(verified),p.team,identity(p),'anytime_td'].join('|');if(excluded(options,p,'TD',key,'anytime_td'))continue;
   const observed=(Array.isArray(p.last5GameStats)?p.last5GameStats:[]).filter(g=>g&&n(g.rushTDs)!==null&&n(g.recTDs)!==null&&Number.isInteger(n(g.rushTDs))&&Number.isInteger(n(g.recTDs))&&n(g.rushTDs)>=0&&n(g.recTDs)>=0).map(g=>n(g.rushTDs)+n(g.recTDs));
   const hits=observed.length?observed.filter(v=>v>0).length:null;
   const reasons=[row.rating.coverage,'Player performance / usage '+row.rating.performanceScore+'/100; opponent vs '+p.pos+' '+row.rating.opponentScore+'/100.','Opponent allows '+p.tdallowed+' rushing/receiving TDs and '+p.rzallowed+' red-zone opportunities per game to '+p.pos+'.','Player red-zone opportunities: '+p.playerRz+' per game; team red-zone share '+p.rzshare+'%.'];
   if(observed.length)reasons.push('Scored a rushing/receiving TD in '+hits+' of '+observed.length+' known recent appearances.');
   else reasons.push('Recent rushing/receiving TD outcomes are unavailable; no historical hit rate is inferred.');
   const risks=['Game-day active and starting status remain unconfirmed.'];if(String(p.availability).toUpperCase()==='QUESTIONABLE'||String(p.injuryReportStatus).toUpperCase()==='QUESTIONABLE')risks.push('QUESTIONABLE: verify the official active list.');
   candidates.push({p,d:{key:'anytime_td',label:'anytime rushing/receiving TD',ratio:'TD'},line:null,score:row.score,researchScore:row.score,reasons,risks,hits,sample:observed.length,scenarioRate:null,key,market:'anytime_td',category:'TD',side:'winner',rating:row.rating,roleLabel:row.roleLabel,opponentContext:row.opponentContext,alternatives:[]});
  }
 }catch{return empty('Player eligibility or exclusion evidence is unavailable.');}
 candidates.sort(order);
 const result={ready:true,status:simulationAvailable?'ok':'partial',reason:null,candidates,topThree:[],bestSingle:null,visible:[],fixture:verified};
 result.topThree=select(result);result.bestSingle=result.topThree[0]||null;
 const visible=new Map();for(const category of categories)for(const c of select(result,category))visible.set(c.key,c);result.visible=[...visible.values()].sort(order);
 if(!simulationAvailable)result.reason=candidates.length?'Simulated yardage and reception lines are unavailable; independently supported anytime-TD plays remain.':'Simulations are unavailable and no supported anytime-TD play meets the 60/100 minimum.';
 else if(!candidates.length){result.status='pass';result.reason='No supported OVER or anytime-TD play meets the score, usage and availability requirements.';}
 return result;
}
function slate(records,fixtures,simulations,options={}){
 const empty=reason=>({ready:false,status:'pass',reason,candidates:[],topThree:[],bestSingle:null,visible:[],fixture:null,games:[],perGame:[],coverage:[]});
 const now=options.now===undefined?Date.now():options.now;
 if(typeof now!=='number'||!Number.isFinite(now)||!Array.isArray(records))return empty('Player feed or current time is unavailable.');
 if(!fresh(options.feedGeneratedAt,now)||!fresh(options.fixturesGeneratedAt,now))return empty('Fresh NFL player and game feeds within 48 hours are required.');
 const schedule=Array.isArray(fixtures)?fixtures:Array.isArray(fixtures?.games)?fixtures.games:[];
 const ids=new Map();
 for(const fixture of schedule){const id=fixtureId(fixture);if(id)ids.set(id,(ids.get(id)||0)+1)}
 const result=empty(null);let available=0;
 for(const fixture of schedule){
  const id=fixtureId(fixture);
  const simulation=id&&typeof simulations?.get==='function'?simulations.get(id):null;
  const model=ids.get(id)>1?
   {ready:false,status:'pass',reason:'Duplicate fixture identity; game excluded from the board.',candidates:[],topThree:[],bestSingle:null,visible:[],fixture:fixture||null}:
   build(records,fixture,simulation,{...options,now,fixtures:schedule});
  result.perGame.push(model);
  result.coverage.push({gameId:id||null,ready:model.ready,status:model.status,reason:model.reason});
  if(!model.ready)continue;
  result.games.push(model.fixture);
  if(Array.isArray(simulation?.markets))available++;
  result.candidates.push(...model.candidates.map(candidate=>({...candidate,fixture:model.fixture})));
 }
 if(!result.games.length){result.reason='No verified upcoming NFL games within the next seven days are available.';return result}
 result.ready=true;result.candidates.sort(order);
 result.topThree=select(result);result.bestSingle=result.topThree[0]||null;
 const visible=new Map();for(const category of categories)for(const candidate of select(result,category))visible.set(candidate.key,candidate);
 result.visible=[...visible.values()].sort(order);
 if(available<result.games.length){
  result.status='partial';
  result.reason='Player simulations are pending or unavailable for '+(result.games.length-available)+' of '+result.games.length+' games'+(result.candidates.length?'; showing supported research from available inputs.':'.');
 }else if(result.candidates.length){result.status='ok';result.reason=null}
 else result.reason='No supported OVER or anytime-TD play meets the score, usage and availability requirements.';
 return result;
}
return {defs,choose,build,slate,select,categories,mergeRecords};
});
