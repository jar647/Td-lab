const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs');
const engine=require('../nba_game_first');
const row=(id,market='rebounds',boost=.12)=>({key:id+'|'+market,gameId:'same',playerId:id,name:'Player '+id,market,forecast:10,minutes:30,matchupBoost:boost,matchupGames:8,eligible:true,matchupRating:{score:85,factors:[]},samples:[4,8,9,10,11,12,13,14],reason:'Observed opponent weakness'});
test('odds-free OVER recommendations support five legs and distinct players in same game',()=>{const result=engine.build([row('1'),row('1','points'),...['2','3','4','5','6'].map(id=>row(id))]);assert.equal(result.picks.length,5);assert.equal(new Set(result.picks.map(r=>r.playerId)).size,5);assert.equal(result.topThree.length,3);assert(result.picks.every(r=>r.side==='over'));assert.equal(engine.build([row('1')],{maxLegs:2}).picks.length,1)});
test('alternate line recomputes exact strict-over frequency, including integer pushes',()=>{const r=row('1');assert.equal(engine.chance(r,10),4/8);assert(engine.chance(r,7.5)>engine.chance(r,11.5));const built=engine.build([r],{lines:{[r.key]:9.5}});assert.equal(built.picks[0].line,9.5);assert.equal(built.picks[0].probability,5/8);assert.equal(engine.build([r],{lines:{[r.key]:100}}).picks.length,0)});
test('reject NaN, wrong-side evidence, stale eligibility and exclusions',()=>{for(const r of [{...row('1'),side:'under'},row('1','points',-.1),{...row('1'),eligible:false},{...row('1'),matchupGames:NaN},{...row('1'),forecast:NaN}])assert.equal(engine.candidate(r),null);assert.equal(engine.build([row('1')],{excludedMarkets:['rebounds']}).picks.length,0);assert.equal(engine.chance(row('1'),NaN),null)});
test('joint probability comes from aligned outcomes and conflicting pairs are excluded',()=>{const a={...row('a'),samples:[10,10,10,10,10,0,0,0]},b={...row('b'),samples:[0,0,0,10,10,10,10,10]};const r=engine.build([a,b]);assert.equal(r.picks.length,1);const positive=engine.build([a,{...b,samples:a.samples}]);assert.equal(positive.picks.length,2);assert.equal(positive.jointHitRate,5/8);assert.notEqual(positive.jointHitRate,(5/8)**2)});
test('same-game joint outcomes cannot mix different or unverified simulation batches',()=>{
 const a={...row('a'),outcomeSetId:'batch-a'},b={...row('b'),outcomeSetId:'batch-b'};
 assert.equal(engine.build([a,b]).picks.length,1);
 assert.equal(engine.build([a,row('b')]).picks.length,1);
 assert.equal(engine.build([a,{...b,outcomeSetId:'batch-a'}]).picks.length,2);
});
const possessions=require('../nba_possession_engine');
const matchups=require('../nba_matchup_discovery');
test('actual NBA matchup and game-first engines select the same supported role-based alternate lines',()=>{
 const clock=Date.parse('2026-11-04T18:00Z'),stamp=new Date(clock).toISOString(),positions=['PG','SG','SF','PF','C'],teams=['A','B','C','D','E','F'];
 const rosters={generated_at:stamp,teams:{},players:{}},availability={generated_at:stamp,status:'ok',injuries:[]};
 for(const team of teams){
  rosters.teams[team]=[...positions.map(position=>team+position),team+'Cbench'];
  for(const position of positions)rosters.players[team+position]={team,name:team+' '+position,position};
  rosters.players[team+'Cbench']={team,name:team+' C bench',position:'C'};
 }
 const player=(team,position,i)=>{
  const rebounds=team==='A'&&position==='C'?18+i%3:8;
  return {id:team+position,name:team+' '+position,team,position,starter:true,stats:{MIN:'40',PTS:'20',FG:'10-20','3PT':'0-0',FT:'0-0',OREB:'2',DREB:String(rebounds-2),REB:String(rebounds),AST:String(team==='A'&&position==='PG'?9:3),TO:'2'}};
 };
 const rotation=(team,i)=>[...positions.map(position=>player(team,position,i)),{...player(team,'C',i),id:team+'Cbench',name:team+' C bench',starter:false,stats:{...player(team,'C',i).stats,REB:'8',OREB:'2',DREB:'6'}}];
 const games=[];
 for(let i=0;i<10;i++)for(let pair=0;pair<3;pair++)games.push({id:'prior-'+i+'-'+pair,date:new Date(clock-(11-i)*86400000).toISOString(),status:'STATUS_FINAL',season_type:2,home:teams[pair*2],away:teams[pair*2+1],players:[...rotation(teams[pair*2],i),...rotation(teams[pair*2+1],i)]});
 const input={generated_at:stamp,games},next={id:'next',home:'A',away:'B',date:new Date(clock+6*3600000).toISOString(),status:'STATUS_SCHEDULED'};
 const priorDraws=possessions.draws;let draws=0,analysis,research;
 try{
  possessions.draws=(...args)=>{draws++;return priorDraws(...args)};
  analysis=engine.analyze(next,input,availability,rosters,null,clock);
  research=matchups.analyze(next,input,rosters,availability,clock);
 }finally{possessions.draws=priorDraws}
 assert.equal(draws,1,'The actual shared role helper and matchup analyzer must reuse game-first draws');
 assert.equal(analysis.reason,null);assert(research.candidates.length>0);assert(analysis.rows.length>0);
 const aliases={pr:'Points + Rebounds',pa:'Points + Assists',ra:'Rebounds + Assists',pra:'PRA'};
 for(const pick of research.candidates){
  const r=analysis.rows.find(r=>String(r.playerId)===String(pick.playerId)&&r.market===(aliases[pick.market]||pick.market));
  assert(r,'Every shared supported matchup market has a game-first row');assert.equal(r.roleEvidence.roleStatus,'SUPPORTED');
  assert.equal(r.selectedLineEvidence.line,pick.recommendedOverLine);assert.deepEqual(r.selectedLineEvidence,pick.selectedLineEvidence);
  assert.equal(r.selectedLineEvidence.sampleKind,'role_adjusted_history');assert.deepEqual(r.inputTimes,r.roleEvidence.inputTimes);
 }
 const ticket=engine.build(analysis.rows);assert(ticket.bestSingle);assert.equal(ticket.bestSingle.line,17.5);
 assert.equal(ticket.bestSingle.probability,ticket.bestSingle.samples.filter(x=>x>17.5).length/1000);
 assert(analysis.rows.every(r=>r.samples.length===1000&&r.outcomeSetId===analysis.rows[0].outcomeSetId));
});
const read=n=>JSON.parse(fs.readFileSync('data/'+n+'.json'));const feed=read('nba_games'),inj=read('nba_injuries'),roster=read('nba_rosters'),context=read('nba_game_context');const now=Math.max(...[feed,inj,roster].map(d=>Date.parse(d.generated_at)))+1000;
// Published snapshots update independently. Assess the actual timestamps; a
// newer injury report must not make an older game feed appear fresh.
const upcoming=feed.games.filter(g=>g.status==='STATUS_SCHEDULED'&&Date.parse(g.date)>now),checked=[];
const game=upcoming.find(g=>{const analysis=engine.analyze(g,feed,inj,roster,context,now);checked.push({game:g,analysis});return analysis.reason===null&&analysis.rows.length>0});
test('real cache either supports player research or visibly withholds unsupported inputs',t=>{
 if(!game){
  const cases=checked.length?checked:[{game:feed.games.find(g=>Number.isFinite(Date.parse(g.date))),analysis:null}];
  for(const entry of cases){
   const a=entry.analysis||engine.analyze(entry.game,feed,inj,roster,context,now);
   if(a.reason!==null){assert.equal(typeof a.reason,'string');assert(a.reason.length)}
   assert.deepEqual(a.rows,[]);assert.equal(engine.build(a.rows).picks.length,0);
   // A supported base rotation can still fail an uncertain in/out draw.
   // Freshness and cutoff failures must also be enforced before simulation.
   if(/Fresh game, injury and roster|closed after tipoff/.test(a.reason||''))assert.throws(()=>possessions.build(entry.game,feed,inj,roster,now,{context}),error=>error.message===a.reason);
  }
  t.diagnostic('Actual cache withheld: '+(cases[0].analysis?.reason||'No supported pregame player opportunities'));return;
 }
 const a=engine.analyze(game,feed,inj,roster,context,now);assert.equal(a.reason,null);assert(a.rows.length);const ticket=engine.build(a.rows);assert(ticket.picks.every(r=>r.score>=engine.minimumScore(r.market)));assert.equal(ticket.bestSingle===null,ticket.topThree.length===0);assert(a.rows.every(r=>r.samples.length===1000&&r.reason.includes(r.name)&&r.reason.includes('Pace')&&r.minutes>=20));const exclude=ticket.picks[0]?.market||'points';assert(engine.build(a.rows,{excludedMarkets:[exclude]}).picks.every(r=>r.market!==exclude));const copied=JSON.stringify(a.rows);engine.build(a.rows,{lines:{[a.rows[0].key]:1000}});assert.equal(JSON.stringify(a.rows),copied);const outName=(inj.injuries||[]).filter(p=>/OUT|INACTIVE|DOUBTFUL/.test(p.status)).map(p=>p.player);assert(!a.rows.some(r=>outName.includes(r.name)));
});
test('missing, stale and post-tipoff inputs produce visible reasons and no invented picks',()=>{
 const fixture=game||upcoming[0]||{id:'freshness-test',home:'A',away:'B',status:'STATUS_SCHEDULED',date:new Date(now+6*3600000).toISOString()};
 for(const analysis of [engine.analyze(fixture,feed,null,roster,null,now),engine.analyze(fixture,{...feed,generated_at:'2000-01-01'},inj,roster,context,now),engine.analyze(fixture,feed,inj,roster,context,Date.parse(fixture.date)+1)]){assert.equal(typeof analysis.reason,'string');assert(analysis.reason.length);assert.deepEqual(analysis.rows,[]);assert.equal(engine.build(analysis.rows).picks.length,0)}
 assert.equal(engine.build([]).jointHitRate,null);
 // Independent synthetic snapshots isolate the freshness boundary without
 // altering any real cache timestamp or pretending missing history exists.
 const clock=Date.parse('2026-11-01T12:00:00Z'),stamp=new Date(clock).toISOString(),synthetic={id:'freshness-boundary',home:'A',away:'B',status:'STATUS_SCHEDULED',date:new Date(clock+6*3600000).toISOString()},emptyFeed={generated_at:stamp,games:[]},availability={generated_at:stamp,status:'ok',injuries:[]},rosters={generated_at:stamp,teams:{}};
 const check=(f,at=clock,g=synthetic)=>engine.analyze(g,f,availability,rosters,null,at);
 assert.match(check(emptyFeed).reason,/At least eight earlier complete shooting box scores/,'coherent fresh snapshots pass freshness but do not invent historical evidence');
 assert.match(check({...emptyFeed,generated_at:new Date(clock-12*3600000).toISOString()}).reason,/At least eight earlier/,'the exact 12-hour boundary remains allowed');
 const stale={...emptyFeed,generated_at:new Date(clock-12*3600000-1).toISOString()};assert.throws(()=>possessions.build(synthetic,stale,availability,rosters,clock),/Fresh game, injury and roster/);assert.match(check(stale).reason,/Fresh game, injury and roster/);
 const near={...synthetic,date:new Date(clock+3600000).toISOString()};assert.match(check(emptyFeed,clock+15*60000,near).reason,/At least eight earlier/);assert.match(check(emptyFeed,clock+15*60000+1,near).reason,/availability must be refreshed within 15 minutes/);
});
