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
