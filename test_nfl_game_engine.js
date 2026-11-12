/* Run: node test_nfl_game_engine.js */
'use strict';
const assert=require('node:assert/strict');
const engine=require('./nfl_game_engine.js');
function player(team,id,pos,stats,extra={}){
 const history=Array.from({length:8},(_,i)=>({
  week:i+1,passAttempts:stats.p??0,rushAttempts:stats.r??0,
  targets:stats.t??0,receptions:stats.c??0,recYards:stats.y??0,
  rushYards:stats.ry??0,passYards:stats.py??0
 }));
 return {player_id:id,player:id,team,opp:team==='A'?'B':'A',pos,
  playerAppearancesVerified:true,seasonGameStats:history,
  last5GameStats:history.slice(-5),availability:'ROSTER_ACTIVE',
  injuryReportStatus:'NOT_REPORTED',defenseOpponentRatio:{PASS:1,REC:1,RUSH:1},
  ...extra};
}
const lineup=[
 player('A','a-qb','QB',{p:35,r:4,ry:17,py:251}),
 player('A','a-rb','RB',{r:15,ry:66,t:4,c:3,y:19}),
 player('A','a-wr','WR',{t:10,c:7,y:91}),
 player('A','a-te','TE',{t:6,c:4,y:44}),
 player('B','b-qb','QB',{p:32,r:3,ry:12,py:229}),
 player('B','b-rb','RB',{r:18,ry:77,t:3,c:2,y:14}),
 player('B','b-wr','WR',{t:10,c:6,y:80}),
 player('B','b-te','TE',{t:6,c:4,y:48}),
 player('A','a-out','WR',{t:12,c:10,y:140},{injuryReportStatus:'OUT'})
];
function run(){
 const legs=[{id:'a-wr',market:'receptions',line:3},{id:'a-qb',market:'passYards',line:200}];
 const result=engine.simulate(lineup,1500,12,legs);
 assert.equal(result.status,'RESEARCH_ONLY_UNCALIBRATED');
 assert.equal(result.modelVersion,'game-first-volume-v4-depth-chart-qb');
 assert.equal(result.teams.length,2);
 assert.equal(result.joint.legs,2);
 assert(!result.markets.some(m=>m.id==='a-out'),'OUT player must be excluded');
 const rec=result.markets.find(m=>m.id==='a-wr'&&m.market==='receptions'&&m.line===3);
 const qb=result.markets.find(m=>m.id==='a-qb'&&m.market==='passYards'&&m.line===200);
 assert(rec&&qb);
 assert(result.joint.scenarioRate<=rec.scenarioRate+0.0001);
 assert(result.joint.scenarioRate<=qb.scenarioRate+0.0001);
 assert(result.markets.every(m=>m.scenarioRate>=0&&m.scenarioRate<=1));
 assert(result.teams.every(t=>t.scenarioAvgPasses+t.scenarioAvgRushes>=35));
 assert.deepEqual(result,engine.simulate(lineup,1500,12,legs),'seeded runs must be reproducible');
 assert.notDeepEqual(result,engine.simulate(lineup,1500,13,legs),'different seeds must vary');
 assert.throws(()=>engine.simulate(lineup,100,1),/Simulation count/);
 assert.throws(()=>engine.simulate(lineup.filter(x=>x.team==='A'),1500,1),/two teams/);

 const anonymous=lineup.filter(p=>p.player_id!=='b-qb');
 // Never invent a quarterback or allow a guessed QB passing-yards prop.
 const unverified=anonymous.map(p=>({...p,teamPassAttemptsPerGame:33}));
 const recovered=engine.simulate(unverified,1500,12,[{id:'b-wr',market:'recYards',line:40}]);
 const b=recovered.teams.find(t=>t.team==='B');
 assert.equal(b.passVolumeSource,'VERIFIED_TEAM_PBP_NO_QB_PROPS');
 assert.equal(b.quarterbackPlayerPropsAvailable,false);
 assert(recovered.markets.some(m=>m.id==='b-wr'&&m.market==='recYards'),
   'Receiver forecast must still be available without verified QB');
 assert(!recovered.markets.some(m=>m.team==='B'&&m.market==='passYards'),
   'No named passing-yard prop without a verified QB');
 assert.throws(()=>engine.simulate(anonymous,1500,12),
   /no verified quarterback or historical team passing volume/);

 // Current sourced first-unit depth evidence outranks earlier QB volume.
 // It is a starting assumption, not official game-day active confirmation.
 const chart={order:1,unit:'first',position:'QB',sourceStatus:'ok',season:2026,
  observedAt:new Date(Date.now()-3600000).toISOString(),source:'https://www.espn.com/nfl/team/depth/_/name/nyg'};
 const higherHistory=player('A','a-higher-history-qb','QB',{p:45,r:10,ry:45,py:310},
  {season:2026,depthChart:{...chart,order:2,unit:'reserve'}});
 const currentQB=player('A','a-qb','QB',{p:20,r:4,ry:17,py:160},{season:2026,depthChart:{...chart}});
 const depthLineup=[...lineup.map(p=>p.player_id==='a-qb'?currentQB:p),higherHistory];
 const depthBefore=JSON.stringify(depthLineup),depthModel=engine.build(depthLineup);
 const depthTeam=depthModel.teams.find(t=>t.team==='A');
 assert.equal(depthTeam.qb.id,'a-qb','first-unit lower-volume QB must beat the higher-volume reserve');
 assert.equal(depthTeam.outlook.quarterbackSelection,'SOURCED_DEPTH_CHART');
 assert.match(depthTeam.outlook.warning,/assumes a-qb starts/);
 assert.match(depthTeam.outlook.warning,/Game-day starting status is not confirmed/);
 assert.equal(depthTeam.outlook.estimatedPassAttempts,20,'selected source QB uses his own passing workload');
 assert.equal(depthTeam.qb.qbRole,undefined,'depth evidence cannot manufacture a QB-role flag');
 assert.equal(depthTeam.qb.season,2026);
 assert.notStrictEqual(depthTeam.qb.depthChart,currentQB.depthChart,'parameters clone sourced depth metadata');
 assert.notStrictEqual(depthTeam.outlook.depthChart,depthTeam.qb.depthChart,'published source metadata is also copied');
 depthTeam.qb.depthChart.source='https://changed.example/depth';
 assert.equal(currentQB.depthChart.source,chart.source,'mutating model metadata cannot mutate sourced records');
 assert.equal(depthTeam.outlook.depthChart.source,chart.source);
 const depthResult=engine.simulate(depthLineup,1000,42);
 assert(depthResult.markets.some(m=>m.id==='a-qb'&&m.market==='passYards'&&m.line===175&&m.hits>0));
 assert(!depthResult.markets.some(m=>m.id==='a-higher-history-qb'));
 assert.equal(depthResult.inputAudit.find(p=>p.id==='a-qb').historicalPassAttempts,20);
 assert.equal(depthResult.teams.find(t=>t.team==='B').quarterbackId,'b-qb','other team selection remains unchanged');
 assert.equal(JSON.stringify(depthLineup),depthBefore);
 const announcement=depthLineup.map(p=>p.player_id==='a-higher-history-qb'?{...p,qbRole:'EXPECTED_STARTER',
  starterContext:{source:'https://team.example/announcement',note:'Cited current-game starter'}}:p);
 assert.equal(engine.build(announcement).teams.find(t=>t.team==='A').qb.id,'a-higher-history-qb','cited starter announcement outranks the depth chart');
 const uncited=announcement.map(p=>p.player_id==='a-higher-history-qb'?{...p,starterContext:{source:'#',note:'Unverified claim'}}:p);
 assert.equal(engine.build(uncited).teams.find(t=>t.team==='A').qb.id,'a-qb','an uncited flag cannot override sourced depth evidence');
 const depthOverride=engine.build(depthLineup,{quarterbacks:{A:'a-higher-history-qb'}}).teams.find(t=>t.team==='A');
 assert.equal(depthOverride.qb.id,'a-higher-history-qb');
 assert.equal(depthOverride.outlook.quarterbackSelection,'CONDITIONAL_PLAYER_SCENARIO','explicit conditional choices have highest priority');

 const invalidDepths=[{...chart,order:2},{...chart,order:'1'},{...chart,unit:'reserve'},{...chart,position:'WR'},
  {...chart,sourceStatus:'error'},{...chart,source:'http://team.example/depth'},{...chart,source:'#'},
  {...chart,source:{}},{...chart,source:'https://bad host/depth'},{...chart,observedAt:'not-a-date'},
  {...chart,observedAt:''},{...chart,observedAt:new Date(Date.now()-73*3600000).toISOString()},
  {...chart,observedAt:new Date(Date.now()+6*60000).toISOString()},
  {...chart,season:2025},{...chart,season:2026.5},{...chart,season:null},{...chart,season:[2026]}];
 for(const invalid of invalidDepths){
  const roster=depthLineup.map(p=>p.player_id==='a-qb'?{...p,depthChart:invalid}:p);
  const team=engine.build(roster).teams.find(t=>t.team==='A');
  assert.equal(team.qb.id,'a-higher-history-qb','invalid or stale depth evidence must not force QB selection');
  assert.equal(team.outlook.quarterbackSelection,'MODEL_INPUT_SELECTION');
 }
 for(const season of [2025,2026.5,[2026],{},true]){
  const roster=depthLineup.map(p=>p.player_id==='a-qb'?{...p,season}:p);
  assert.equal(engine.build(roster).teams.find(t=>t.team==='A').qb.id,'a-higher-history-qb','record season must match the chart season when present');
 }
 for(const observedAt of [new Date(Date.now()-71*3600000).toISOString(),new Date(Date.now()+4*60000).toISOString()]){
  const roster=depthLineup.map(p=>p.player_id==='a-qb'?{...p,depthChart:{...chart,observedAt}}:p);
  assert.equal(engine.build(roster).teams.find(t=>t.team==='A').outlook.quarterbackSelection,'SOURCED_DEPTH_CHART');
 }
 // A current source naming an unavailable or unsupported QB cannot silently
 // switch the offense to another named passer with more recorded volume.
 for(const change of [{seasonGameStats:currentQB.seasonGameStats.slice(0,2)},
  {playerAppearancesVerified:false},{injuryReportStatus:'OUT'},{qbRole:'BACKUP'},
  {seasonGameStats:currentQB.seasonGameStats.map(g=>({...g,passAttempts:4}))}]){
  const roster=depthLineup.map(p=>({...p,teamPassAttemptsPerGame:33,...(p.player_id==='a-qb'?change:{})}));
  const outcome=engine.simulate(roster,1000,42),team=outcome.teams.find(t=>t.team==='A');
  assert.equal(team.quarterback,null);assert.equal(team.quarterbackSelection,'TEAM_VOLUME_FALLBACK');
  assert(!outcome.markets.some(m=>m.team==='A'&&m.market==='passYards'),'unsupported first-unit input cannot create reserve QB markets');
  assert.match(team.warning,/source-named quarterback a-qb/,'missing source coverage identifies the QB instead of quietly modeling a reserve');
  assert.match(team.warning,/No QB props/);
  const conditional=engine.build(roster,{quarterbacks:{A:'a-higher-history-qb'}}).teams.find(t=>t.team==='A');
  assert.equal(conditional.qb.id,'a-higher-history-qb','an explicit eligible conditional scenario remains available');
  assert.equal(conditional.outlook.quarterbackSelection,'CONDITIONAL_PLAYER_SCENARIO');
 }
 const insufficient=depthLineup.map(p=>p.player_id==='a-qb'?{...p,seasonGameStats:currentQB.seasonGameStats.slice(0,2)}:p);
 assert.throws(()=>engine.build(insufficient),/no verified quarterback or historical team passing volume/);
 const metadataOnly=lineup.map(p=>p.player_id==='a-qb'?{...p,season:2026,depthChart:{...chart,observedAt:'invalid'}}:p);
 assert.deepEqual(engine.simulate(metadataOnly,1500,12,legs).markets,result.markets,
  'ignored source metadata must not alter established default seeded player outcomes');

 // A returning starter must beat a backup with more recent passing volume.
 const returned=lineup.map(p=>p.player_id==='a-qb'?{...p,qbRole:'EXPECTED_STARTER',starterContext:{source:'https://team.example/starter-announcement',note:'Team-announced starter'}}:p);
 returned.push(player('A','a-backup','QB',{p:45,r:7,ry:30,py:300},{qbRole:'BACKUP'}));
 const returnResult=engine.simulate(returned,1500,12);
 assert.equal(returnResult.teams.find(t=>t.team==='A').quarterback,'a-qb');
 assert(!returnResult.markets.some(m=>m.id==='a-backup'),'backup cannot consume QB or rushing opportunities');
 assert(returnResult.markets.some(m=>m.id==='a-qb'&&m.market==='passYards'));
 const returnOut=returned.map(p=>p.player_id==='a-qb'?{...p,injuryReportStatus:'OUT'}:p).map(p=>({...p,teamPassAttemptsPerGame:33}));
 const outResult=engine.simulate(returnOut,1500,12);
 assert.equal(outResult.teams.find(t=>t.team==='A').quarterback,null);
 assert(!outResult.markets.some(m=>m.id==='a-qb'||m.id==='a-backup'));

 // Missing depth-chart roles must not turn every roster QB into a starter.
 // Even with more historical passing/rushing volume, an unselected QB has
 // no simulated workload and must not receive misleading zero-hit markets.
 const secondQuarterback=player('A','a-unselected','QB',{p:45,r:12,ry:60,py:310});
 const twoQuarterbacks=[...returned,secondQuarterback];
 const twoModel=engine.build(twoQuarterbacks),baseModel=engine.build(returned);
 const teamA=twoModel.teams.find(t=>t.team==='A');
 assert.equal(teamA.qb.id,'a-qb','announced starter wins over higher-volume unlabeled quarterback');
 assert(!teamA.carryPool.items.some(x=>x.p?.id==='a-unselected'),
  'unselected quarterback cannot steal carries from the modeled offense');
 assert.equal(teamA.outlook.estimatedRushAttempts,baseModel.teams.find(t=>t.team==='A').outlook.estimatedRushAttempts,
  'unselected QB carries must not inflate team volume or pace');
 const twoResult=engine.simulate(twoQuarterbacks,1500,12);
 assert(!twoResult.markets.some(m=>m.id==='a-unselected'),
  'unselected quarterback receives no passing or rushing market rows');
 for(const market of ['passYards','rushYards']){
  const unavailable=twoResult.unavailableMarkets.find(m=>m.id==='a-unselected'&&m.market===market);
  assert(unavailable&&/not the modeled quarterback/.test(unavailable.reason));
  assert.throws(()=>engine.simulate(twoQuarterbacks,1500,12,[{id:'a-unselected',market,line:175}]),
   /not the modeled quarterback/,'unsupported QB legs must fail before simulations, not return a joint zero');
 }
 const selectedStarter=twoResult.markets.find(m=>m.id==='a-qb'&&m.market==='passYards'&&m.line===175);
 assert(selectedStarter&&selectedStarter.hits>0&&selectedStarter.modeledMean>0);
 assert.deepEqual(twoResult.markets,returnResult.markets,
  'adding an unselected QB cannot change supported seeded player outcomes');
 const excludedAudit=twoResult.inputAudit.find(p=>p.id==='a-unselected');
 assert.equal(excludedAudit.modeledPassAttempts,null);
 assert.match(excludedAudit.participationAssumption,/Not selected/);

 // An explicit player scenario can model a different eligible QB without
 // changing depth-chart data or claiming that the player is confirmed to start.
 const sourceBefore=JSON.stringify(twoQuarterbacks);
 const conditionalOptions={quarterbacks:{A:'a-unselected'}};
 const conditionalBefore=JSON.stringify(conditionalOptions);
 const conditionalModel=engine.build(twoQuarterbacks,conditionalOptions);
 const conditionalTeam=conditionalModel.teams.find(t=>t.team==='A');
 assert.equal(conditionalTeam.qb.id,'a-unselected');
 assert.equal(conditionalTeam.qb.qbRole,undefined,'a conditional choice must not manufacture an expected-starter role');
 assert(conditionalTeam.carryPool.items.some(x=>x.p?.id==='a-unselected'));
 assert(!conditionalTeam.carryPool.items.some(x=>x.p?.id==='a-qb'));
 const conditionalLegs=[{id:'a-unselected',market:'passYards',line:175},{id:'a-unselected',market:'rushYards',line:25}];
 const conditionalResult=engine.simulate(twoQuarterbacks,1000,42,conditionalLegs,conditionalOptions);
 const conditionalOutlook=conditionalResult.teams.find(t=>t.team==='A');
 assert.equal(conditionalOutlook.quarterbackId,'a-unselected');
 assert.equal(conditionalOutlook.quarterbackSelection,'CONDITIONAL_PLAYER_SCENARIO');
 assert.match(conditionalOutlook.warning,/assumes a-unselected starts/);
 assert.match(conditionalOutlook.warning,/Game-day starting status is not confirmed/);
 assert.equal(conditionalResult.teams.find(t=>t.team==='B').quarterbackSelection,'MODEL_INPUT_SELECTION');
 assert.equal(conditionalResult.teams.find(t=>t.team==='B').quarterbackId,'b-qb');
 for(const market of ['passYards','rushYards']){
  assert(conditionalResult.markets.some(m=>m.id==='a-unselected'&&m.market===market&&m.hits>0&&m.modeledMean>0));
  assert(!conditionalResult.markets.some(m=>m.id==='a-qb'&&m.market===market));
  assert(conditionalResult.unavailableMarkets.some(m=>m.id==='a-qb'&&m.market===market));
 }
 const conditionalAudit=conditionalResult.inputAudit.find(p=>p.id==='a-unselected');
 assert.equal(conditionalAudit.history[0].passAttempts,45,'conditional scenario uses the selected QB history');
 assert.equal(conditionalAudit.modeledPassAttempts,45);
 assert(conditionalResult.joint.hits>0,'supported conditional QB legs must be jointly simulated');
 assert.equal(conditionalResult.audit.passingReceivingConservation,true);
 assert.equal(JSON.stringify(twoQuarterbacks),sourceBefore,'conditional modeling must not mutate roster records');
 assert.equal(JSON.stringify(conditionalOptions),conditionalBefore);
 assert.deepEqual(engine.simulate(twoQuarterbacks,1500,12),twoResult,'a conditional run cannot change later default seeded outcomes');
 assert.equal(twoResult.teams.find(t=>t.team==='A').quarterbackSelection,'VERIFIED_EXPECTED_STARTER');
 assert.equal(engine.build(twoQuarterbacks,{quarterbacks:{A:'a-qb'}}).teams.find(t=>t.team==='A').outlook.quarterbackSelection,
  'CONDITIONAL_PLAYER_SCENARIO','an explicit choice remains conditional even when it matches the default QB');
 const invalidConditional=(records,team,id,reason)=>assert.throws(()=>engine.build(records,{quarterbacks:{[team]:id}}),reason);
 invalidConditional(twoQuarterbacks,'A','b-qb',/belongs to another team/);
 invalidConditional(twoQuarterbacks,'A','missing-qb',/not in the matchup inputs/);
 invalidConditional(twoQuarterbacks,'C','a-qb',/not in this matchup/);
 invalidConditional(twoQuarterbacks,'A','a-rb',/not a quarterback/);
 invalidConditional(twoQuarterbacks,'A','a-backup',/blocked by roster, injury or backup status/);
 invalidConditional([...twoQuarterbacks,player('A','a-injured-qb','QB',{p:30},{injuryReportStatus:'OUT'})],
  'A','a-injured-qb',/blocked by roster, injury or backup status/);
 const shortQB=player('A','a-short-qb','QB',{p:30});shortQB.seasonGameStats=shortQB.seasonGameStats.slice(0,2);
 invalidConditional([...twoQuarterbacks,shortQB],'A','a-short-qb',/three complete verified/);
 invalidConditional([...twoQuarterbacks,player('A','a-unverified-qb','QB',{p:30},{playerAppearancesVerified:false})],
  'A','a-unverified-qb',/three complete verified/);
 invalidConditional([...twoQuarterbacks,player('A','a-low-pass-qb','QB',{p:4})],
  'A','a-low-pass-qb',/insufficient verified passing workload/);
 for(const id of [null,undefined,'',{}])invalidConditional(twoQuarterbacks,'A',id,/requires a player ID/);
 assert.throws(()=>engine.build(twoQuarterbacks,{quarterbacks:[]}),/mapping teams to player IDs/);

 // Anonymous team-passing fallback must not create props for a low-volume
 // named QB merely because that player's history passes the sample checks.
 const lowPassFallback=[...unverified,player('B','b-low-pass','QB',{p:4,r:3,ry:10,py:20},{teamPassAttemptsPerGame:33})];
 const fallbackResult=engine.simulate(lowPassFallback,1000,42);
 assert.equal(fallbackResult.teams.find(t=>t.team==='B').quarterbackPlayerPropsAvailable,false);
 assert(!fallbackResult.markets.some(m=>m.id==='b-low-pass'));
 assert.deepEqual(fallbackResult.unavailableMarkets.filter(m=>m.id==='b-low-pass').map(m=>m.market).sort(),
  ['passYards','rushYards']);
 assert(fallbackResult.markets.some(m=>m.id==='b-wr'&&m.market==='recYards'&&m.hits>0));
 assert.throws(()=>engine.simulate(lowPassFallback,1000,42,[{id:'b-low-pass',market:'rushYards',line:10}]),
  /not the modeled quarterback/);

 // A market with no allocated opportunity is unavailable, while a supported
 // market remains valid when its difficult threshold has no simulated hits.
 const opportunityLineup=[...lineup,
  player('A','a-no-targets','WR',{}),
  player('B','b-no-carries','RB',{t:2,c:1,y:8}),
  player('B','b-rare-target','WR',{t:.25,c:.125,y:1.5})];
 const opportunityResult=engine.simulate(opportunityLineup,1000,42);
 for(const [id,market] of [['a-no-targets','recYards'],['a-no-targets','receptions'],['b-no-carries','rushYards']]){
  assert(!opportunityResult.markets.some(m=>m.id===id&&m.market===market));
  assert(opportunityResult.unavailableMarkets.some(m=>m.id===id&&m.market===market&&/No supported/.test(m.reason)));
  assert.throws(()=>engine.simulate(opportunityLineup,1000,42,[{id,market,line:20}]),/No supported/);
 }
 assert(opportunityResult.markets.some(m=>m.id==='b-rare-target'&&m.market==='recYards'&&m.hits===0&&m.modeledMean>0),
  'genuine zero-hit tail thresholds stay visible for a supported receiving market');
 const highThreshold=engine.simulate(lineup,1000,42,[{id:'a-qb',market:'passYards',line:100000}]);
 assert.equal(highThreshold.joint.hits,0,'a valid extreme threshold may have zero hits');
 assert.equal(highThreshold.joint.scenarioRate,0);
 const customThreshold=engine.simulate(lineup,1000,42,[{id:'a-rb',market:'rushYards',line:49.5}]);
 assert(customThreshold.joint.hits>0,'supported custom thresholds need not be on the display ladder');
 assert.throws(()=>engine.simulate(lineup,1000,42,[{id:'missing',market:'passYards',line:175}]),/no eligible verified history/);
 assert.throws(()=>engine.simulate(lineup,1000,42,[{id:'a-qb',market:'recYards',line:20}]),/not supported/);
 for(const line of [null,undefined,NaN,Infinity,0,-1,true,[175],''])
  assert.throws(()=>engine.simulate(lineup,1000,42,[{id:'a-qb',market:'passYards',line}]),/positive finite number/);

 // A QB matchup factor can affect untracked receiver assumptions, but must
 // never rescale yards already credited to named receivers a second time.
 const neutral=engine.simulate(lineup,1000,77),boosted=engine.simulate(lineup.map(p=>p.player_id==='a-qb'?{...p,defenseOpponentRatio:{...p.defenseOpponentRatio,PASS:1.12}}:p),1000,77);
 const na=neutral.teams.find(t=>t.team==='A'),ba=boosted.teams.find(t=>t.team==='A');
 assert.ok(Math.abs((ba.scenarioAvgPassYards-na.scenarioAvgPassYards)-(ba.scenarioAvgUntrackedReceivingYards-na.scenarioAvgUntrackedReceivingYards))<1e-7);
 assert.equal(neutral.audit.passingReceivingConservation,true);
 assert.deepEqual(neutral.markets.filter(p=>p.team==='A'&&p.market==='recYards'),boosted.markets.filter(p=>p.team==='A'&&p.market==='recYards'));
 assert.throws(()=>engine.build([...lineup,lineup[0]]),/Duplicate player identity/);
 const audit=neutral.inputAudit.find(p=>p.id==='a-qb');assert.equal(audit.games,8);assert.equal(audit.history[0].passAttempts,35);assert.equal(audit.sourceAvailability.gameDay,'UNVERIFIED');
 console.log('NFL game-first simulator tests passed');
}
run();

