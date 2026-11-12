'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),read=(file,fallback={})=>fs.existsSync(path.join(ROOT,file))?JSON.parse(fs.readFileSync(path.join(ROOT,file),'utf8')):fallback;
const digest=text=>crypto.createHash('sha256').update(text).digest('hex').slice(0,12);
const hash=files=>crypto.createHash('sha256').update(files.map(f=>fs.readFileSync(path.join(ROOT,f),'utf8')).join('\n')).digest('hex').slice(0,12);
const fresh=(stamp,now,h=24)=>Number.isFinite(Date.parse(stamp))&&Date.parse(stamp)<=now+300000&&now-Date.parse(stamp)<=h*3600000;
function captureSources(now=Date.now()){
 const picks=[],coverage=[];const attempt=(sport,run)=>{try{run()}catch(e){coverage.push({sport,status:'error',reason:e.message})}};
 attempt('NBA',()=>{
  const matchups=require('../nba_matchup_discovery'),first=require('../nba_first_basket'),gf=require('../nba_game_first');
  const feed=read('data/nba_games.json'),rosters=read('data/nba_rosters.json'),injuries=read('data/nba_injuries.json'),context=read('data/nba_game_context.json');
  const version='nba-matchup-'+hash(['nba_matchup_discovery.js']),firstVersion='nba-first-basket-'+hash(['nba_first_basket.js']);
  const nowDay=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const games=(feed.games||[]).filter(g=>g.status==='STATUS_SCHEDULED'&&Date.parse(g.date)>now&&new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(g.date))===nowDay);
  for(const g of games){const result=matchups.analyze(g,feed,rosters,injuries,now);
   for(const r of result.candidates)picks.push({sport:'NBA',board:'Best Props',gameId:String(g.id),startsAt:g.date,playerId:r.playerId,player:r.name,team:r.team,opponent:r.opponent,market:r.market,side:r.side==='under'?'under':'at_least',line:r.baseline,score:r.researchScore,scoreKind:'Matchup score /100',modelVersion:version,label:r.name+' '+(r.side==='under'?'UNDER '+r.baseline:r.baseline+'+')+' '+r.market,reason:r.matchupRating.factors.map(f=>f.label+': '+f.points+'/'+f.max).join('; '),inputs:{feed:feed.generated_at,rosters:rosters.generated_at,injuries:injuries.generated_at}});
   if(!result.ready)coverage.push({sport:'NBA',gameId:String(g.id),status:'withheld',reason:result.reason});
   const analysis=gf.analyze(g,feed,injuries,rosters,context,now),ticket=gf.build(analysis.rows);
   const selected=new Map([...ticket.picks,...ticket.topThree,...(ticket.bestSingle?[ticket.bestSingle]:[])].map(p=>[p.key,p]));
   for(const r of selected.values())picks.push({sport:'NBA',board:'Game-first recommendations',gameId:String(g.id),startsAt:g.date,playerId:r.playerId,player:r.name,team:r.team,market:r.market,side:r.side,line:r.line,score:r.score,scoreKind:'Matchup score /100',modelVersion:'nba-game-first-'+hash(['nba_game_first.js','nba_matchup_discovery.js']),label:r.name+' '+r.side.toUpperCase()+' '+r.line+' '+r.market,reason:r.reason,inputs:analysis.inputTimes||{}});
  }
  const board=first.slate(feed,rosters,injuries,now);
  for(const r of board.picks)picks.push({sport:'NBA',board:'Top 5 first basket',gameId:String(r.game.id),startsAt:r.game.date,playerId:r.id,player:r.name,team:r.team,market:'first_basket',side:'winner',line:null,score:null,probability:r.probability,scoreKind:'Experimental frequency (not a score)',modelVersion:firstVersion,label:r.name+' first field goal',reason:r.firstGame+'/'+r.games+' prior game-first baskets; '+r.firstTeam+'/'+r.games+' team-first baskets',houseRule:'Must start; first field goal only; free throws excluded',inputs:{feed:feed.generated_at,rosters:rosters.generated_at,injuries:injuries.generated_at}});
  coverage.push({sport:'NBA',status:!fresh(feed.generated_at,now,12)?'stale':'ok',games:games.length,firstBasketReason:board.reason});
  const odds=read('data/nba_market_odds.json');for(const p of picks.filter(p=>p.sport==='NBA')){const names={'Points + Rebounds':'points_rebounds','Points + Assists':'points_assists','Rebounds + Assists':'rebounds_assists',PRA:'pra'},side=p.side==='at_least'?'over':p.side,quoted=p.side==='at_least'?p.line-.5:p.line;const q=(odds.markets||[]).find(q=>String(q.game_id)===p.gameId&&String(q.player_id)===p.playerId&&q.market===(names[p.market]||p.market)&&q.side===side&&q.line===quoted&&fresh(q.observed_at,now,1));if(q){p.americanOdds=q.american_odds;p.priceObservedAt=q.observed_at;p.bookmaker=q.bookmaker;p.quotedLine=q.line;}}
 });
 attempt('NFL',()=>{
  const feed=read('data/matchups.json',[]),status=read('data/status.json'),games=read('data/game_picks.json');if(!fresh(status.generated_at,now,48)||!fresh(games.generated_at,now,48)){coverage.push({sport:'NFL',status:'stale',reason:'NFL feed older than 48 hours'});return;}
  const html=fs.readFileSync(path.join(ROOT,'analyst.html'),'utf8'),start=html.indexOf('const defs=['),end=html.indexOf('function invokeGameWorker');if(start<0||end<start)throw Error('NFL analyst source contract changed');
  const sandbox={};vm.createContext(sandbox);vm.runInContext("const n=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);"+html.slice(start,end)+';globalThis.definitions=defs;',sandbox);
  const engine=require('../nfl_game_engine'),goal=require('../nfl_goal1');const modelVersion='nfl-analyst-'+digest(html.slice(start,end)+hash(['nfl_goal1.js','nfl_game_engine.js']));
  const index=fs.readFileSync(path.join(ROOT,'index.html'),'utf8'),scoreCode=index.slice(index.indexOf('function score(r)'),index.indexOf('function challengerPreviewScore'));if(!scoreCode)throw Error('NFL TD score source contract changed');vm.runInContext('function num(v){return Number(v)}'+scoreCode,sandbox);
  const due=(games.games||[]).filter(g=>Date.parse(g.kickoff_at)>now&&Date.parse(g.kickoff_at)<now+7*86400000);
  const tdPool=feed.filter(r=>r.availability==='ROSTER_ACTIVE'&&r.playerAppearancesVerified!==false&&r.qbRole!=='BACKUP'&&!/OUT|IR|PUP|SUSPENDED|INACTIVE/.test(String(r.injuryReportStatus||'')));
  const leaders=new Set();for(const pos of ['RB','WR','TE','QB'])for(const r of tdPool.filter(r=>r.pos===pos).sort((a,b)=>sandbox.score(b)-sandbox.score(a)).slice(0,3))leaders.add(String(r.player_id));
  for(const g of due){const pool=feed.filter(p=>[g.home,g.away].includes(p.team)&&[g.home,g.away].includes(p.opp));if(!pool.length)continue;
   const sim=engine.simulate(pool,10000,982451653,[]),lookup=new Map(sim.markets.map(x=>[x.id+'|'+x.market+'|'+x.line,x]));
   const candidates=pool.flatMap(p=>sandbox.definitions.map(d=>sandbox.choose(p,d,lookup)).filter(Boolean)).sort((a,b)=>b.score-a.score);
   const selected=new Map([...goal.rankPlayers(candidates,3),...goal.buildTicket(candidates,4)].map(c=>[goal.marketId(c),c]));
   for(const c of selected.values())picks.push({sport:'NFL',board:'Game analyst (top 3/default ticket)',gameId:g.game_id,startsAt:g.kickoff_at,playerId:String(c.p.player_id),player:c.p.player,team:c.p.team,market:c.d.key,side:'at_least',line:c.line,score:c.score,scoreKind:'NFL analyst raw rank (not /100)',modelVersion,label:c.p.player+' '+c.line+'+ '+c.d.label,reason:c.reasons.join(' '),probability:c.scenarioRate,inputs:{feed:status.generated_at,games:games.generated_at}});
   for(const r of tdPool.filter(r=>leaders.has(String(r.player_id))&&[g.home,g.away].includes(r.team)))picks.push({sport:'NFL',board:'TD position leaders',gameId:g.game_id,startsAt:g.kickoff_at,playerId:String(r.player_id),player:r.player,team:r.team,market:'anytime_td',side:'winner',line:null,score:sandbox.score(r),scoreKind:'TD opportunity /100',modelVersion:'nfl-td-'+digest(scoreCode),label:r.player+' anytime rushing/receiving TD',reason:'Top three '+r.pos+' in the public default TD board; provisional roster availability',inputs:{feed:status.generated_at}});
  }
  const tdPrices=read('data/hardrock_anytime_td.json');
  if(fresh(tdPrices.retrieved_at_utc,now,1)){
   const norm=name=>String(name||'').split(',').reverse().join(' ').toLowerCase().replace(/[^a-z0-9]/g,'');
   for(const p of picks.filter(p=>p.sport==='NFL'&&p.market==='anytime_td')){
    const fixture=due.find(g=>g.game_id===p.gameId);
    const offered=(tdPrices.games||[]).filter(q=>{const m=q.fixture_metadata||{};return Date.parse(m.startTime)===Date.parse(p.startsAt)&&[m.participant1Abbr,m.participant2Abbr].sort().join('|')===[fixture.home,fixture.away].sort().join('|');});
    if(offered.length!==1)continue;
    const candidates=feed.filter(r=>[fixture.home,fixture.away].includes(r.team)&&norm(r.player)===norm(p.player));
    const quotes=(offered[0].selections||[]).filter(q=>norm(q.player_name)===norm(p.player));
    if(candidates.length===1&&quotes.length===1){p.americanOdds=quotes[0].american_odds;p.priceObservedAt=tdPrices.retrieved_at_utc;p.bookmaker=tdPrices.source;p.priceFixture=offered[0].fixture_id;}
   }
  }
  coverage.push({sport:'NFL',status:'ok',games:due.length});
 });
 attempt('UFC',()=>{
  const schedule=read('ufc_schedule.json'),profiles=read('ufc_fighter_data.json'),history=read('ufc_history_data.json');if(!fresh(schedule.generated_at,now,168)){coverage.push({sport:'UFC',status:'stale',reason:'Saved schedule older than the app’s seven-day cache limit'});return;}
  const source=fs.readFileSync(path.join(ROOT,'ufc_app.js'),'utf8'),start=source.indexOf('function profileFor(c)'),end=source.indexOf('function topPick('),roundStart=source.indexOf('function confirmedRounds('),roundEnd=source.indexOf('function propQuoteKey(');if(start<0||end<start||roundStart<0)throw Error('UFC public pick source contract changed');
  const app=require('../ufc_app'),sandbox={root:{UFCMatchupResearch:require('../ufc_matchup_research'),UFCPropResearch:require('../ufc_prop_research'),UFCPickEngine:require('../ufc_pick_engine')},cache:profiles.fighters||{},cacheDate:profiles.generated_at,publicHistory:history.fighters||{},events:schedule.events||[],active:'',...app,fighterName:c=>c?.athlete?.displayName||c?.athlete?.fullName||c?.displayName||'Fighter TBD'};
  vm.createContext(sandbox);vm.runInContext(source.slice(start,end)+source.slice(roundStart,roundEnd),sandbox);
  const version='ufc-picks-'+hash(['ufc_app.js','ufc_pick_engine.js','ufc_matchup_research.js','ufc_prop_research.js']);let count=0;
  for(const event of schedule.events||[])for(const bout of event.competitions||[]){const at=Math.min(Date.parse(bout.date||bout.startDate||event.date),Date.parse(event.date));if(!Number.isFinite(at)||at<=now||at>now+7*86400000||bout.status?.type?.state!=='pre')continue;
   const fighters=[...(bout.competitors||[])].sort((a,b)=>(a.order||0)-(b.order||0));if(fighters.length!==2)continue;sandbox.active=String(event.id);const {pick,decision}=sandbox.fightPick(fighters,bout);count++;
   const common={sport:'UFC',gameId:String(bout.id),startsAt:new Date(at).toISOString(),modelVersion:version,team:null,inputs:{schedule:schedule.generated_at,profiles:profiles.generated_at,history:history.generated_at},score:null,scoreKind:'Evidence category (not /100)',confidence:decision?.confidence||'UNVALIDATED'};
   if(pick?.status==='pick')picks.push({...common,board:'Top fight pick',playerId:pick.side===0||pick.side===1?String(fighters[pick.side].id):null,player:pick.side===0||pick.side===1?sandbox.fighterName(fighters[pick.side]):null,market:pick.market,side:pick.market==='total'?/^Under /i.test(pick.label)?'under':'over':'winner',line:pick.line,method:pick.method,label:pick.label,reason:pick.reason});
   if(decision?.status==='PREDICTED_WINNER'&&(decision.side===0||decision.side===1))picks.push({...common,board:'Predicted winner',playerId:String(fighters[decision.side].id),player:decision.fighter,market:'winner',side:'winner',line:null,label:decision.fighter+' to win',reason:decision.reason});
  }
  coverage.push({sport:'UFC',status:'ok',bouts:count});
 });
 return {picks,coverage};
}
function resultSources(){const nba=read('data/nba_games.json'),nfl=read('data/recommendations/nfl_results.json'),history=read('ufc_history_data.json'),schedule=read('ufc_schedule.json');const bouts=new Map();
 for(const p of Object.values(history.fighters||{}))for(const b of p.recent_fights||[])if(/final|complete|post/i.test(b.status||''))bouts.set(String(b.bout_id),b);
 for(const event of schedule.events||[])for(const b of event.competitions||[]){if(bouts.has(String(b.id)))continue;const winner=(b.competitors||[]).find(c=>c.winner);if(b.status?.type?.completed||/CANCEL|POSTPON/i.test(b.status?.type?.name||''))bouts.set(String(b.id),{bout_id:String(b.id),status:b.status?.type?.completed?'final':b.status?.type?.name,winner:winner?.id||null,method_display:b.details?.text||b.status?.type?.detail||'',end_round:b.status?.period,end_clock:b.status?.displayClock});}
 return {nba,nfl,ufc:{bouts:[...bouts.values()]}};
}
module.exports={captureSources,resultSources,hash};
