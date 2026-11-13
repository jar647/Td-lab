/* Run: node test_nfl_sgp_ui.js. Exercise the main SGP renderer and copy action. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const section=(from,to)=>html.slice(html.indexOf(from),html.indexOf(to,html.indexOf(from)));
const controller=section('function renderGameSGP(){','\nfunction openSearchedPlayer(');
const research=section('function propResearch(','\nfunction suggestAltLine(');
const pregame=section('function nflPregameReason(','\nfunction nflBoardRows(');
class Element{
 constructor(tag){this.tagName=tag;this.children=[];this.style={};this.listeners={};this._text='';this._value='';this.disabled=false;}
 appendChild(child){this.children.push(child);if(this.tagName==='select'&&(child.selected||this.children.length===1))this._value=child.value;return child;}
 append(...items){items.forEach(x=>this.appendChild(x));}
 replaceChildren(...items){this.children=[];this._text='';this.append(...items);}
 set textContent(value){this._text=String(value);this.children=[];}
 get textContent(){return this._text+this.children.map(x=>x.textContent).join('');}
 set value(value){this._value=String(value);}
 get value(){return this._value;}
 get options(){return this.children;}
 get selectedIndex(){return this.options.findIndex(x=>x.value===this.value);}
 setAttribute(name,value){this[name]=value;}
 addEventListener(name,handler){(this.listeners[name]||=[]).push(handler);}
 async emit(name){for(const handler of this.listeners[name]||[])await handler();}
 select(){}
}
const walk=(root,predicate)=>[...(predicate(root)?[root]:[]),...root.children.flatMap(x=>walk(x,predicate))];
function player(id,team='A',pos='RB',extra={}){
 return {player:id,player_id:id,team,opp:team==='A'?'B':'A',pos,market:'ATD',availability:'ROSTER_ACTIVE',games:5,
  playerAppearancesVerified:true,playerRushYards:140,defRushYardsAllowed:168,playerCarries:20,recent3Carries:20,
  playerRecYards:140,defRecYardsAllowed:168,playerReceptions:12,defReceptionsAllowed:14.4,playerTargets:14,recent3Targets:14,
  defRushAttemptsAllowed:24,defTargetsAllowed:15,
  last5GameStats:Array.from({length:5},()=>({rushYards:140,recYards:140,receptions:12})),...extra};
}
function mount(records,manualInactives=[],games=[{home:'A',away:'B',kickoff_at:new Date(Date.now()+3600000).toISOString()}]){
 const panel=new Element('section'),filter=new Element('select');
 filter.appendChild(Object.assign(new Element('option'),{value:'A|B',textContent:'A at B'}));
 const state={copied:'',picks:[]};
 const context={PropVaultGoal1:require('./nfl_goal1.js'),autoRecords:records,manualInactives,activeFeedWeek:'week-8',propVaultGameFeed:{games},propVaultMarketLines:{},
  gameKey:r=>[r.team,r.opp].sort().join('|'),
  document:{getElementById:id=>id==='sgpPanel'?panel:id==='gameFilter'?filter:walk(panel,e=>e.id===id)[0],
   createElement:tag=>new Element(tag),createTextNode:text=>Object.assign(new Element('#text'),{textContent:text})},
  navigator:{clipboard:{async writeText(text){state.copied=text;}}},
  CookItUpQuickSlip:{createButton(pick){state.picks.push(pick);return new Element('button');}}};
 vm.createContext(context);
 const inactive=section('function normPlayer(','\n// Use the most games recorded');
 const backup=section('function inactiveOrBackup(','\nfunction availableTeamGames(');
 vm.runInContext(research+pregame+inactive+backup+controller+';renderGameSGP()',context);
 const card=panel.children.find(x=>x.tagName==='section');
 const count=walk(card,x=>x.id==='autoSgpLegCount')[0];
 const list=card.children.find(x=>x.tagName==='ol');
 const notice=card.children.find((x,i)=>i>card.children.indexOf(list)&&x.tagName==='p');
 const copy=card.children.find(x=>x.tagName==='button');
 return {context,panel,count,list,notice,copy,state,async choose(n){state.picks=[];count.value=n;await count.emit('change');}};
}
(async()=>{
 // Three strong markets per early player used to exhaust the 22-market prefix
 // before later eligible players were considered for larger tickets.
 const records=Array.from({length:8},(_,i)=>player('strong'+i,i%2?'B':'A'));
 records.push(...Array.from({length:4},(_,i)=>player('later'+i,i%2?'B':'A','WR',{
  defRecYardsAllowed:140,defReceptionsAllowed:12
 })));
 // Duplicate feed rows/markets, another matchup, unavailable players, backups
 // and insufficient verified logs must never be used to fill the extra legs.
 records.push({...records[0]},player('other-game','C'),player('out','A','RB',{availability:'OUT'}),
  player('backup','A','QB',{qbRole:'BACKUP'}),player('unverified','A','RB',{playerAppearancesVerified:false}),
  player('short-sample','A','RB',{last5GameStats:[{rushYards:140,recYards:140,receptions:12}]}),
  player('manual-out'),player('two-games','A','RB',{games:2}),player('unsupported','A','RB',{
   last5GameStats:Array.from({length:5},()=>({rushYards:0,recYards:0,receptions:0}))
  }));
 const view=mount(records,[{player:'manual-out',team:'A',week:'week-8'}]);
 assert.equal(view.count.value,'5','retain the existing five-leg default');
 assert.deepEqual(view.count.options.map(x=>Number(x.value)),[2,3,4,5,6,7,8,9,10]);
 for(const requested of [6,8,10]){
  await view.choose(requested);
  assert.equal(view.list.children.length,requested,'render the requested supported leg count');
  const picks=view.state.picks;
  assert.equal(picks.length,requested,'all rendered legs are usable Quick Slip picks');
  assert.equal(new Set(picks.map(x=>x.player)).size,requested,'no player is duplicated across main-ticket markets');
  assert(picks.every(x=>x.game==='A|B'&&['A','B'].includes(x.team)),'same-game picks only');
  assert(picks.every(x=>x.researchScore>=60&&x.researchScore<=100),'every rendered player leg meets the /100 minimum');
  assert(picks.every(x=>/^(strong|later)/.test(x.player)),'all availability and evidence filters stay active');
  assert.match(view.notice.textContent,new RegExp('Showing '+requested+' screened candidates'));
  assert.match(view.notice.textContent,new RegExp(requested+' legs compound failure risk'));
  await view.copy.emit('click');
  assert.match(view.state.copied,new RegExp(requested+'-LEG AUTO SGP'));
  assert.equal(view.state.copied.split('\\n').length,requested+1,'copy includes every generated leg');
 }
 assert(view.state.picks.some(x=>x.player.startsWith('later')),'consider supported players beyond the former 22-market shortlist');
 const sparse=mount(records.slice(0,3));
 await sparse.choose(10);
 assert.equal(sparse.list.children.length,3);
 assert.match(sparse.notice.textContent,/Only 3 of 10 legs passed the filters; no filler added/);
 await sparse.copy.emit('click');
 assert.match(sparse.state.copied,/3-LEG AUTO SGP/,'copy reports actual count when the requested size cannot be filled');
 const weak=player('low','A','RB',{playerRushYards:48,playerCarries:5,recent3Carries:5,defRushAttemptsAllowed:10,playerRecYards:30,playerReceptions:2,playerTargets:3,recent3Targets:3,defTargetsAllowed:9});
 assert.equal(require('./nfl_goal1.js').matchupScore(weak,'RUSH'),59);
 const lowScore=mount([weak]);
 await lowScore.choose(10);assert.equal(lowScore.list.children.length,0,'raw research quality cannot bypass matchup score');
 const empty=mount([]);await empty.choose(10);
 assert.equal(empty.list.children.length,0);
 assert.equal(empty.copy.disabled,true);
 assert.match(empty.notice.textContent,/Only 0 of 10/);
 for(const games of [[],[{home:'A',away:'B',kickoff_at:new Date(Date.now()-1000).toISOString()}]]){
  const unavailable=mount(records,[],games);await unavailable.choose(10);
  assert.equal(unavailable.list.children.length,0,'past or unverified fixtures cannot create new player SGP legs');
  assert.equal(unavailable.state.picks.length,0);
 }
 console.log('NFL main SGP UI: 2–10 choices, generated/copy counts, evidence filters, duplicate/game exclusions and shortfall passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
