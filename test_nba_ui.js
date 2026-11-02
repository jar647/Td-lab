// Contract smoke tests for the NBA lineup and projection page.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('nba.html','utf8');
const CookItUpPricing=require('./market_odds.js');
const CookNBAFirstBasket=require('./nba_first_basket.js');
const CookItUpProbability=require('./player_probability.js');
const match=html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(match,'NBA app script must exist');
new vm.Script(match[1],{filename:'nba.html'});
for(const id of ['games','show','status','output','audit','learning','projections'])
 assert.ok(html.includes('id="'+id+'"'),'Missing control '+id);
for(const removed of ['injurycheck','bookline','buildsgp','sgp'])
 assert.ok(!html.includes('id="'+removed+'"'),'Obsolete SGP control '+removed);
assert.ok(match[1].includes("fetch('./data/nba_injuries.json'"),'Injury feed missing');
assert.ok(match[1].includes("fetch('./data/nba_games.json'"),'Game feed missing');
assert.ok(match[1].includes("fetch('./data/nba_daily_learning.json'"),'Daily model evaluation missing');
assert.ok(match[1].includes('projected five'),'Starting lineup rendering missing');
assert.ok(match[1].includes('function injuryFor(p)'),'Injury helper required by projection rendering');
assert.ok(match[1].includes('Player recommendations · matchup opportunities'),'Top props rendering missing');
const elements=new Map();
function element(id){if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',onclick:null});return elements.get(id)}
const sandbox={document:{getElementById:element},fetch:async()=>({ok:false}),console,Date,Math,Number,String,Object,Array,Set,Map,JSON,Promise,Intl,CookNBAFirstBasket,CookItUpPricing,CookItUpProbability,CookItUpQuickSlip:{button:()=>'<button class="quick-slip-add">Add to Quick Slip</button>'}};
vm.createContext(sandbox);vm.runInContext(match[1],sandbox,{timeout:2000});
assert.equal(typeof element('show').onclick,'function','Analyze must be wired');
assert.ok(match[1].includes('formatToParts'),'Eastern day comparison must use stable date parts');
assert.ok(match[1].includes('No player projections available because there are no NBA games today.'),'Empty day must be explained');
assert.ok(match[1].includes('if(!g)'),'Invalid selection must be handled');
assert.ok(match[1].includes('retrospective?'),'Retrospective warning must survive rendering');
console.log('NBA lineup/projections UI smoke test: PASS');


// Integration smoke test against the published game-feed file, not just script syntax.
(async()=>{
 const data=JSON.parse(fs.readFileSync('data/nba_games.json','utf8'));
 // Older checked-in feeds predate the season_type field; the integration fixture is constrained to the 2026 regular-season window.
 for(const g of data.games){if(g.status==='STATUS_FINAL')g.season_type=new Date(g.date)>=new Date('2026-10-21T00:00:00Z')?2:1;}
 const easternDay=x=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(x)).map(v=>[v.type,v.value]));return p.year+'-'+p.month+'-'+p.day};
 // The test must not depend on a specific game's being UPCOMING forever.
 // Select a completed game with at least two usable earlier regular-season
 // box scores per team, and place the UI clock before its tipoff.
 const prior=(g,t)=>data.games.filter(h=>h.status==='STATUS_FINAL'&&h.season_type===2&&
  Date.parse(h.date)<Date.parse(g.date)&&[h.home,h.away].includes(t)&&
  h.players.filter(p=>p.team===t&&!p.didNotPlay&&p.stats?.PTS).length>=5).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
 const game=[...data.games].reverse().find(g=>g.status==='STATUS_FINAL'&&g.season_type===2&&
  prior(g,g.home).length>=2&&prior(g,g.away).length>=2);
 assert.ok(game,'Integration test needs a recent completed regular-season game with prior box scores');
 const dom=new Map();
 const el=id=>{if(!dom.has(id))dom.set(id,{value:'',textContent:'',innerHTML:'',onclick:null,append(child){this.innerHTML+=child.innerHTML},click(){this.onclick?.()}});return dom.get(id)};
 const fixtureTime=Date.parse(game.date)-4*3600000;
 assert.equal(easternDay(fixtureTime),easternDay(game.date),'Fixture test clock must remain on the same Eastern day');
 const FixedDate=class extends Date{constructor(...args){super(...(args.length?args:[fixtureTime]))}static now(){return fixtureTime}};
 const context={document:{getElementById:el,createElement:()=>({className:'',id:'',innerHTML:'',append(){el('output').innerHTML+=this.innerHTML}})},fetch:async url=>({ok:true,json:async()=>url.includes('nba_games')?data:url.includes('nba_injuries')?{generated_at:new Date().toISOString(),injuries:[]}:{snapshots:[]}}),console,Date:FixedDate,Math,Number,String,Object,Array,Set,Map,JSON,Promise,Intl,CookNBAFirstBasket,CookItUpPricing,CookItUpProbability,CookItUpQuickSlip:{button:()=>'<button class="quick-slip-add">Add to Quick Slip</button>'}};
 vm.createContext(context);vm.runInContext(match[1],context,{timeout:2000});
 await new Promise(resolve=>setTimeout(resolve,50));
 assert.ok(el('games').innerHTML.includes(game.home),'Today-game selector must contain real matchup: '+el('status').textContent);
 // Simulate the real game selection using the same Eastern calendar-day matching as the app.
 const day=easternDay;
 const today=data.games.filter(g=>g.date&&day(g.date)===day(new Date(fixtureTime))).sort((a,b)=>new Date(a.date)-new Date(b.date));
 const idx=today.findIndex(g=>g.home===game.home&&g.away===game.away);
 assert.ok(idx>=0,'Integration matchup must be today');
 el('games').value=String(idx);el('show').click();
 const html=el('output').innerHTML+el('projections').innerHTML;
 assert.ok(html.includes('projected five'),'Selected game must render lineups');
 assert.ok(html.includes('First basket scorer'),'Selected game must render first basket research');
 assert.ok(html.includes('NBA Game Simulator'),'Selected NBA game must render simulator');
 assert.ok(html.includes('PTS <strong>')&&html.includes('REB <strong>')&&html.includes('AST <strong>')&&html.includes('3PM <strong>'),'Selected game must render all projected stat labels');
 assert.ok(html.includes('Player recommendations · matchup opportunities'),'Selected game must render prop section');
 assert.ok(html.includes('Vegas Line')&&html.includes('Over odds')&&html.includes('Under odds'),'NBA player prop cards must include a two-sided quote entry');
 assert.ok(/PTS <strong>\d/.test(html),'Selected game must render numeric player projections; selected '+el('games').value+'; preview '+html.slice(0,700));
 // Reproduce a two-game sample with verified old box scores; this will not
 // start failing simply because Portland–Lakers finished yesterday.
 const minimal=[...new Map([...prior(game,game.away).slice(0,2),
   ...prior(game,game.home).slice(0,2)].map(g=>[g.id,g])).values()];
 assert(minimal.length>=2);
 vm.runInContext('historicalGames='+JSON.stringify(minimal),context);
 vm.runInContext("generatedAt='"+new Date(fixtureTime-60000).toISOString()+"'",context);
 const limitedGame={...game,status:'STATUS_SCHEDULED'};
 el('output').innerHTML='';
 vm.runInContext('renderGameSimulator('+JSON.stringify(limitedGame)+')',context,{timeout:2000});
 assert.ok(el('output').innerHTML.includes('Simulation Controls'),
  'Two observed games per team must show simulator controls: '+el('output').innerHTML.slice(0,850));
 assert.ok(el('output').innerHTML.includes(game.away+' sample 2 games'),
  'Two-game sample size must remain explicit in the simulator');
 for(const id of ['sim-count','sim-spread','sim-total','sim-home-ml','sim-away-ml','sim-home-spread-odds','sim-away-spread-odds','sim-over-odds','sim-under-odds'])el(id).value=id==='sim-count'?'1000':id==='sim-spread'?'-3.5':id==='sim-total'?'220.5':id==='sim-home-ml'?'-150':id==='sim-away-ml'?'130':'-110';
 vm.runInContext('simulatorStats.injuryFresh=true;simulatorStats.injuries=[];runNBASimulation()',context,{timeout:2000});
 assert.ok(el('sim-results').innerHTML.includes('No qualified model lean'),'Two-game samples must not produce a model lean');
 assert.ok(el('sim-results').innerHTML.includes('HOLD · limited game sample'),'Two-game samples must remain blocked from edge signals');
 console.log('NBA real-feed selection and numeric projection integration test: PASS');
})().catch(e=>{console.error(e);process.exitCode=1});


// Early-season evidence must use the current team's completed regular-season
// slate. Keep the player-appearance minimum strict once the team has >=8 games.
{
 const tip=Date.UTC(2026,10,2,20),g={id:'sample-gate',home:'Gate Home',away:'Gate Away',status:'STATUS_SCHEDULED',date:new Date(tip).toISOString()};
 const p={id:'gate-player',name:'Gate Player',team:'Gate Home',rows:Array.from({length:6},(_,i)=>({points:10+i,minutes:30})),defenseDelta:0,paceDelta:0,opportunityFactor:1};
 const finals=Array.from({length:8},(_,i)=>({id:'prior-'+i,status:'STATUS_FINAL',season_type:2,date:new Date(tip-(i+1)*86400000).toISOString(),home:'Gate Home',away:'Opponent'}));
 let observed;
 sandbox.CookItUpProbability={...CookItUpProbability,review:args=>{observed=args;return CookItUpProbability.review(args)}};
 function bind(history){
  vm.runInContext('historicalGames='+JSON.stringify(history)+';nbaPriceUI('+JSON.stringify(g)+','+JSON.stringify(p)+',"points",12.5)',sandbox);
 }
 // None of these may inflate the six genuine, earlier team games.
 bind([...finals.slice(0,6),finals[0],{...finals[6],id:'pre',season_type:1},{...finals[7],id:'future',date:new Date(tip+1).toISOString()},{...finals[7],id:'old',date:'2025-11-01T20:00:00Z'}]);
 assert.equal(observed.availableGames,6,'NBA card must forward six available team games');
 assert.equal(CookItUpProbability.review(observed).requiredSample,6);
 bind(finals);
 assert.equal(observed.availableGames,8);
 assert.equal(CookItUpProbability.review(observed).requiredSample,8,'Six player appearances in eight team games must remain limited');
 console.log('NBA early-season sample gate binding: PASS');
}

// A bettor should see the decision without reading the technical calculation.
{
 const quote=CookItUpProbability.review({history:[4,4,5,2,7,3],market:'assists',projection:4.1,line:3.5,overOdds:-160,underOdds:125,availableGames:6,context:{seasonUsage:30,recentUsage:31,opponentRatio:1.001,injuryStatus:'NOT LISTED'}});
 const render=(result,line=3.5)=>vm.runInContext('nbaVerdictHTML('+JSON.stringify(result)+',4.1,'+JSON.stringify(line)+')',sandbox);
 const pass=render({...quote,decision:'PASS',status:'PASS · NO ROBUST VALUE SIGNAL'});
 const visible=pass.split('<details')[0];
 assert(visible.includes('PASS · SKIP THIS PROP'));
 assert(visible.includes('Projection')&&visible.includes('Your line')&&visible.includes('+0.6'));
 assert(!visible.includes('hypothetical ROI')&&!visible.includes('No-vig')&&!visible.includes('UNCALIBRATED model'));
 assert(pass.includes('<summary>Why?</summary>'),'Full evidence must remain available on demand');
 assert(!pass.includes('<details open'),'Technical detail must start collapsed');
 const lean=render({...quote,decision:'LEAN',candidate:'UNDER',status:'LEAN UNDER · UNCALIBRATED'});
 assert(lean.includes('LEAN UNDER 3.5 · +125'));
 assert(lean.includes('Research lean; not a verified betting edge'));
 assert(render(quote,null).includes('ENTER A LINE'));
 const escaped=render({...quote,decision:'PASS',status:'PASS',reason:'<img src=x onerror=bad()>'});
 assert(!escaped.includes('<img src=x'));
 console.log('NBA concise verdict and optional calculation details: PASS');
}

// Final two-sided price decisions, not the old matchup score, control the ranks.
{
 const row=(key,playerId,decision,candidate,ev,quality=0,quote={line:5.5,over:-110,under:-110})=>({key,playerId,quality,quote,result:{decision,candidate,expectedValue:ev,estimatedEdge:ev/2}});
 const rows=[row('over','one','LEAN','OVER',.10),row('under','two','LEAN','UNDER',.30),row('pass','three','PASS',null,99,999),row('waiting','four','PASS',null,99,998,{}) ,row('second-market','two','LEAN','OVER',.20),row('third','five','LEAN','OVER',.08)];
 const groups=JSON.parse(vm.runInContext('JSON.stringify(nbaPropGroups('+JSON.stringify(rows)+'))',sandbox));
 assert.deepEqual(groups.recommended.map(r=>r.key),['under','over','third']);
 assert.deepEqual(groups.other.map(r=>r.key),['second-market']);
 assert.deepEqual(groups.passed.map(r=>r.key),['pass']);
 assert.deepEqual(groups.awaiting.map(r=>r.key),['waiting']);
 assert.equal(new Set(groups.recommended.map(r=>r.playerId)).size,3);
 const changed=rows.map(r=>r.key==='under'?{...r,result:{decision:'PASS',candidate:null}}:r);
 const after=JSON.parse(vm.runInContext('JSON.stringify(nbaPropGroups('+JSON.stringify(changed)+'))',sandbox));
 assert(!after.recommended.some(r=>r.key==='under'));assert(after.passed.some(r=>r.key==='under'));
 console.log('NBA Over/Under ranking, PASS removal and awaiting-odds buckets: PASS');
}

// Current single-book prices can discover an Under. Manual edits win; a changed
// line cannot reuse the old price, and stale imported prices cannot stay active.
{
 const now=new Date().toISOString(),old=new Date(Date.now()-2*3600000).toISOString(),key='auto-game|auto-player|points';
 const data={generated_at:now,status:'ok',markets:[
  {game_id:'auto-game',player_id:'auto-player',market:'points',side:'under',line:5.5,american_odds:-110,bookmaker:'hardrockbet',observed_at:now},
  {game_id:'auto-game',player_id:'auto-player',market:'points',side:'over',line:5.5,american_odds:100,bookmaker:'hardrockbet',observed_at:now},
  {game_id:'other-game',player_id:'auto-player',market:'points',side:'under',line:99.5,american_odds:900,bookmaker:'hardrockbet',observed_at:now}
 ]};
 vm.runInContext('nbaQuoteContexts['+JSON.stringify(key)+']={history:[1,1,2,1,2,1],market:"points",availableGames:6,eligible:true,modelContext:{seasonAverage:1.33,recentAverage:1.4,seasonUsage:30,recentUsage:30,opponentRatio:1,injuryStatus:"NOT LISTED"}};nbaMarketData='+JSON.stringify(data)+';chooseNBAAutoQuote({id:"auto-game"},{id:"auto-player"},"points",1.3,'+JSON.stringify(key)+')',sandbox);
 assert.equal(vm.runInContext('nbaPriceReview('+JSON.stringify(key)+',1.3).candidate',sandbox),'UNDER');
 assert.equal(vm.runInContext('nbaQuoteFor('+JSON.stringify(key)+').line',sandbox),5.5);
 vm.runInContext('setNBAQuote('+JSON.stringify(key)+',"over","-120",1.3);nbaPlayerQuotes['+JSON.stringify(key)+']._autoAt='+JSON.stringify(old),sandbox);
 assert.equal(vm.runInContext('nbaQuoteFor('+JSON.stringify(key)+').under',sandbox),undefined);
 assert.equal(vm.runInContext('nbaQuoteFor('+JSON.stringify(key)+').over',sandbox),'-120');
 vm.runInContext('setNBAQuote('+JSON.stringify(key)+',"line","7.5",1.3)',sandbox);
 assert.equal(vm.runInContext('nbaQuoteFor('+JSON.stringify(key)+').over',sandbox),undefined);
 assert.equal(vm.runInContext('nbaQuoteFor('+JSON.stringify(key)+').under',sandbox),undefined);
 const stale={...data,markets:data.markets.map(q=>({...q,observed_at:old}))};
 vm.runInContext('delete nbaPlayerQuotes['+JSON.stringify(key)+'];nbaMarketData='+JSON.stringify(stale)+';chooseNBAAutoQuote({id:"auto-game"},{id:"auto-player"},"points",1.3,'+JSON.stringify(key)+')',sandbox);
 assert.equal(vm.runInContext('nbaQuoteFor('+JSON.stringify(key)+').line',sandbox),undefined);
 console.log('NBA fresh same-game odds, Under discovery and manual override: PASS');
}

// A qualified Under must be saved as Under rather than the organizer's default Over.
{
 let pick;sandbox.CookItUpQuickSlip={button:value=>{pick=value;return '<button>Add to Quick Slip</button>'}};
 const g={id:'slip-under',status:'STATUS_SCHEDULED',date:new Date(Date.now()+3600000).toISOString(),home:'Home',away:'Away'};
 const p={id:'slip-player',name:'Slip Player',team:'Home',rows:Array.from({length:10},(_,i)=>({points:1+i%2,minutes:30})),defenseDelta:0,paceDelta:0,opportunityFactor:1};
 vm.runInContext('injuryData='+JSON.stringify({generated_at:new Date().toISOString(),injuries:[]})+';nbaPlayerQuotes["slip-under|slip-player|points"]={line:5.5,over:100,under:-110};nbaPriceUI('+JSON.stringify(g)+','+JSON.stringify(p)+',"points",1.5)',sandbox);
 assert.equal(pick.side,'under');assert.equal(pick.recommendation,'Under 5.5 Points');assert.equal(pick.recommendationLine,null);
 console.log('NBA Under direction preserved in Quick Slip payload: PASS');
}

// Slate ranking uses the existing verdict, across games and in both directions.
const slateNow=Date.now();
sandbox.slateFixture=Array.from({length:9},(_,i)=>({key:'slate-'+i,playerId:'p'+i,name:'Player '+i,market:'points',quality:30,game:{id:i<2?'same':String(i),status:'STATUS_SCHEDULED',date:new Date(slateNow+3600000).toISOString()},quote:{line:20.5,over:-110,under:-110},result:{decision:'LEAN',candidate:i%2?'OVER':'UNDER',expectedValue:1-i*.05,estimatedEdge:.1}}));
const slate=vm.runInContext('nbaSlateSelection(slateFixture)',sandbox);
assert.equal(slate.picks.length,5);
assert.equal(new Set(slate.picks.map(r=>r.game.id)).size,5);
assert.equal(slate.picks[0].result.candidate,'UNDER');
sandbox.slateFixture[0].result.decision='PASS';
sandbox.slateFixture[2].game.date=new Date(slateNow-1000).toISOString();
sandbox.slateFixture[3].market='threes';
sandbox.slateFixture[4].quote={};sandbox.slateFixture[4].target={side:'OVER',line:19.5,distance:.05};
const filtered=vm.runInContext('nbaSlateSelection(slateFixture)',sandbox);
for(const i of [0,2,3,4])assert.ok(!filtered.picks.some(r=>r.key==='slate-'+i));
assert.ok(filtered.research.some(r=>r.key==='slate-4'));
assert.ok(match[1].includes('if(options.collectOnly)return nbaRankedRows()'));
assert.ok(match[1].includes('nbaRecommendationRows=savedRows;currentProjections=savedProjections'));
console.log('NBA slate max-five, game diversity, both sides and eligibility: PASS');

// Shopping targets must clear the exact final verdict with hypothetical odds.
vm.runInContext('nbaQuoteContexts["target"]={history:[18,19,20,20,21,22,20,19,20,21],market:"points",availableGames:10,eligible:true,modelContext:{seasonAverage:20,recentAverage:20,seasonUsage:30,recentUsage:30,opponentRatio:1,injuryStatus:"NOT LISTED"}}',sandbox);
const target=vm.runInContext('nbaResearchTarget({key:"target",forecast:20})',sandbox);
assert.ok(target);assert.ok(['OVER','UNDER'].includes(target.side));
assert.equal(vm.runInContext('nbaPriceReview("target",20,'+JSON.stringify({line:target.line,[target.side.toLowerCase()]:-110})+').candidate',sandbox),target.side);
sandbox.testTarget=target;
const price=vm.runInContext('nbaTargetPrice({key:"target",forecast:20},testTarget)',sandbox);
assert.ok(price>=-200&&price<=-110);
assert.equal(vm.runInContext('nbaPriceReview("target",20,'+JSON.stringify({line:target.line,[target.side.toLowerCase()]:price})+').candidate',sandbox),target.side);
vm.runInContext('nbaQuoteContexts.target.eligible=false',sandbox);
assert.equal(vm.runInContext('nbaResearchTarget({key:"target",forecast:20})',sandbox),null);
console.log('NBA target lines match final price gates and exclude ineligible players: PASS');

// Scores exist only after qualification, reward better prices and retain gates.
sandbox.ratingContext={history:[18,19,20,20,21,22,20,19,20,21],modelContext:{seasonUsage:30,recentUsage:30}};
sandbox.ratingResult={decision:'LEAN',candidate:'UNDER',sample:10,underSide:{edge:.10,ev:.12,conservative:.58,implied:.52}};
const score=vm.runInContext('nbaPropRating(ratingResult,ratingContext)',sandbox);
assert.ok(score.score>=0&&score.score<=100);
assert.equal(score.score,score.factors.reduce((sum,x)=>sum+x.points,0));
const better=vm.runInContext('nbaPropRating({...ratingResult,underSide:{edge:.15,ev:.22,conservative:.58,implied:.47}},ratingContext)',sandbox);
assert.ok(better.score>score.score,'Better price increases score at unchanged forecast');
assert.equal(vm.runInContext('nbaPropRating({...ratingResult,decision:"PASS"},ratingContext)',sandbox),null);
assert.equal(vm.runInContext('nbaPropRating({...ratingResult,candidate:null},ratingContext)',sandbox),null);
assert.ok(vm.runInContext('nbaPropRating({...ratingResult,sample:20},ratingContext).score',sandbox)>score.score);
assert.ok(vm.runInContext('nbaPropRating(ratingResult,{...ratingContext,modelContext:{seasonUsage:30,recentUsage:15}}).score',sandbox)<score.score);
assert.equal(vm.runInContext('nbaRatingHTML({decision:"PASS"})',sandbox),'');
assert.ok(vm.runInContext('nbaRatingHTML({rating:nbaPropRating(ratingResult,ratingContext)})',sandbox).includes('not win probability'));
console.log('NBA qualified-only score, price sensitivity, sample and role stability: PASS');
