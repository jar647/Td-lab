'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'nba.html'),'utf8');
const script=source.match(/<script>([\s\S]*?)<\/script>/)[1];
const clock=Date.parse('2026-11-18T17:00:00Z'),stamp=new Date(clock).toISOString();
class TestDate extends Date{constructor(...args){super(...(args.length?args:[clock]))}static now(){return clock}}
const elements=new Map();
function element(id){
 if(!elements.has(id))elements.set(id,{id,value:'',disabled:false,open:false,_html:'',_text:'',
  get innerHTML(){return this._html},set innerHTML(value){this._html=String(value);this._text=''},
  get textContent(){return this._text},set textContent(value){this._text=String(value);this._html=''},
  append(child){elements.set(child.id,child);this.innerHTML+=child.innerHTML},
  scrollIntoView(){this.scrolled=true},querySelector(){return null},querySelectorAll(){return []}});
 return elements.get(id);
}
const saved=[],context={document:{getElementById:element,createElement:()=>element('created-'+elements.size)},
 fetch:async()=>({ok:false}),console,Date:TestDate,setTimeout,clearTimeout,Math,Number,String,Object,Array,Set,Map,JSON,Promise,Intl,
 CookItUpQuickSlip:{add:pick=>saved.push(pick)}};
vm.createContext(context);vm.runInContext(script,context);
const evaluate=code=>vm.runInContext(code,context),plain=value=>JSON.parse(JSON.stringify(value));
const fixture=(id,date)=>({id,home:'Home',away:'Away',date,status:'STATUS_SCHEDULED'});
const early=fixture('early','2026-11-18T23:00:00Z'),late=fixture('late','2026-11-19T02:00:00Z');
const old={key:'late|player|rebounds',game:late,gameId:'late',playerId:'player',name:'Player',team:'Home',opponent:'Away',market:'rebounds',side:'over',score:90,line:9.5,probability:.91,matchupBoost:.1,matchupGames:10,reason:'OLD evidence'};

(async()=>{
 // Let unrelated startup requests settle before injecting the current board.
 await new Promise(resolve=>setImmediate(resolve));
 context.old=old;context.early=early;context.late=late;
 context.payload={feed:{generated_at:stamp,games:[late,early]},rosters:{generated_at:stamp,teams:{Home:['player']}},injuries:{generated_at:stamp,status:'ok',injuries:[]},context:null};
 evaluate('games=[late,early];historicalGames=payload.feed.games;generatedAt=payload.feed.generated_at;rosterData=payload.rosters;injuryData=payload.injuries;nbaGameContext=null;');

 // A prior qualifying board cannot survive a failed current source check.
 let analyzed=0;
 context.CookNBAMatchups={position:require('./nba_matchup_discovery').position,analyze:()=>{analyzed++;return {ready:true,candidates:[{...old,researchScore:90}],weaknesses:[],topThree:[]}}};
 evaluate('nbaSelectionController={refreshInputs:async()=>({ready:false,reason:"Required injury refresh failed"})}');
 element('slate-results').innerHTML='<article>OLD 90/100 candidate</article>';
 await evaluate('scanNBAMatchups()');
 assert.equal(analyzed,0,'A failed refresh must stop before reading previously qualifying globals');
 assert.match(element('slate-results').textContent,/PASS.*Required injury refresh failed/);
 assert.equal(element('slate-results').innerHTML,'','The stale card is removed when the scan fails closed');
 assert.equal(element('scan-slate').disabled,false);

 // Source revisions during the yielded scan invalidate the in-flight board.
 evaluate('nbaSelectionController={refreshInputs:async()=>({ready:true})}');
 context.setTimeout=callback=>{evaluate('injuryData={...injuryData,generated_at:"2026-11-18T17:00:01Z"}');return setTimeout(callback,0)};
 await evaluate('scanNBAMatchups()');context.setTimeout=setTimeout;
 assert.equal(analyzed,0,'Changed availability must prevent the old analysis from being published');
 assert.match(element('slate-results').textContent,/PASS.*availability changed during analysis/);

 // Refreshing fixtures preserves identity even when the option index changes.
 context.payload={...context.payload,feed:{generated_at:stamp,games:[late,
  fixture('tomorrow','2026-11-19T05:00:00Z'),early,
  fixture('previousETday','2026-11-18T04:59:00Z'),fixture('lateETtoday','2026-11-19T04:59:00Z'),
  fixture('invalid','invalid-date')]}};
 element('games').value='0';
 evaluate('nbaMatchupCache.set("old",{});nbaGameFirstCache.set("old",{});updateNBASelectionInputs(payload)');
 assert.deepEqual(plain(evaluate('games.map(g=>g.id)')),['early','late','lateETtoday']);
 assert.equal(element('games').value,'1','The selected late game retains its identity after chronological sorting');
 assert.equal(evaluate('games[Number($("games").value)].id'),'late');
 assert.equal(evaluate('nbaMatchupCache.size+nbaGameFirstCache.size'),0);
 assert.match(element('status').textContent,/3 games today \(Eastern Time\)/);
 element('games').value='';evaluate('updateNBASelectionInputs(payload)');assert.equal(element('games').value,'','An unselected board does not silently choose a matchup');

 // Quick Slip must save the newly verified exact line and outcome frequency.
 const refreshed={...old,line:11.5,probability:.72,reason:'FRESH source evidence',matchupBoost:.08};
 context.refreshed=refreshed;let buildOptions;
 context.CookNBAGameFirst={analyze:()=>({rows:[refreshed]}),build:(rows,options)=>{assert.equal(rows[0],refreshed);buildOptions=options;return {picks:[context.refreshed]}}};
 evaluate('nbaGameFirstResult={picks:[old]};nbaGameFirstLines={};nbaGameFirstExcluded=["threes"];nbaGameFirstMax=2;nbaGameFirstCache.clear();nbaGameFirstPick(old.key)');
 assert.equal(saved.length,1);assert.equal(saved[0].line,11.5);assert.equal(saved[0].scenarioRate,.72);
 assert.match(saved[0].notes,/^FRESH source evidence/);assert(!saved[0].notes.includes('OLD'));
 assert.equal(saved[0].recommendation,'Over 11.5 Rebounds');assert.equal(buildOptions.maxLegs,2);
 assert.deepEqual(plain(buildOptions.excludedMarkets),['threes']);
 context.refreshed={...refreshed,score:84};evaluate('nbaGameFirstPick(old.key)');assert.equal(saved.length,1,'A newly disqualified player cannot enter Quick Slip');

 // Raw per-game descriptive totals must not inherit normalized-rate percentages.
 const weakness={team:'Away',attacking:'Home',position:'SG',market:'rebounds',side:'over',allowed:6,leagueAverage:7.5,games:10,excess:.066,
  scheduleAdjustedAllowed:6.5,scheduleAdjustedLeagueAverage:5.9,shrinkage:10/18};
 context.CookNBAMatchups.analyze=()=>({ready:true,candidates:[],weaknesses:[weakness],topThree:[],reason:'PASS',method:'Supported samples'});
 evaluate('nbaMatchupCache.clear();renderNBAMatchups(late)');
 const research=element('nba-matchup-discovery').innerHTML;
 assert.match(research,/6\.0 allowed\/game vs 7\.5 league average \(10 games\)/);
 assert.match(research,/Opponent-adjusted allowance 6\.5 vs 5\.9 league reference per 100 possessions and 48 positional minutes/);
 assert(!research.includes('+7%'),'The +6.6% normalized difference must not be presented as the raw 6 versus 7.5 comparison');
 assert.match(research,/56% sample weight/);

 // The quick entry opens the existing builder directly beside Best Props.
 evaluate('nbaParlayController={};openNBAParlay()');assert.equal(element('nba-parlay-details').open,true);assert.equal(element('nba-parlay-details').scrolled,true);
 const main=source.slice(0,source.indexOf('<script'));
 const best=main.indexOf('id="nba-slate"'),button=main.indexOf('id="open-nba-parlay"'),builder=main.indexOf('id="nba-parlay"'),basket=main.indexOf('id="nba-first-basket-slate"');
 assert(best>=0&&best<button&&button<builder&&builder<basket,'The quick parlay button and builder belong directly after Best Props');
 assert.match(main,/<button[^>]*id="open-nba-parlay"[^>]*onclick="openNBAParlay\(\)"[^>]*aria-controls="nba-parlay-details"/);
 const scripts=[...source.matchAll(/<script src="\.\/([^"?]+)(?:\?[^\"]*)?"/g)].map(match=>match[1]);
 const before=(a,b)=>assert(scripts.includes(a)&&scripts.includes(b)&&scripts.indexOf(a)<scripts.indexOf(b),a+' must load before '+b);
 before('nba_prop_evidence.js','nba_matchup_discovery.js');before('nba_prop_lines.js','nba_matchup_discovery.js');
 before('nba_matchup_discovery.js','nba_game_first.js');before('nba_prop_lines.js','nba_game_first.js');
 before('nba_parlay.js','nba_parlay_ui.js');before('nba_game_first.js','nba_selection_ui.js');

 // Initial network requests may finish after a newer user-triggered refresh.
 // Late responses must not restore a cleared injury designation or old slate.
 const delayed=new Map(),core=['nba_game_context','nba_rosters','nba_injuries','nba_games'];
 context.fetch=url=>core.some(name=>url==='./data/'+name+'.json')?new Promise(resolve=>delayed.set(url,resolve)):Promise.resolve({ok:false});
 element('games').value='';element('show').click=()=>{};
 const initialLoad=evaluate('init()');assert.equal(delayed.size,4);
 context.raceFresh={feed:{generated_at:stamp,games:[late]},rosters:{generated_at:stamp,teams:{Home:['player']},revision:'current'},injuries:{generated_at:stamp,status:'ok',injuries:[{player_id:'player',status:'OUT'}]},context:{generated_at:stamp,revision:'current'}};
 evaluate('updateNBASelectionInputs(raceFresh)');
 const olderStamp='2026-11-18T16:00:00Z',older={nba_game_context:{generated_at:olderStamp,revision:'old'},nba_rosters:{generated_at:olderStamp,teams:{Home:['old-player']},revision:'old'},nba_injuries:{generated_at:olderStamp,status:'ok',injuries:[]},nba_games:{generated_at:olderStamp,games:[fixture('old-slate','2026-11-18T22:00:00Z')]}};
 for(const name of core)delayed.get('./data/'+name+'.json')({ok:true,json:async()=>older[name]});
 await initialLoad;await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(plain(evaluate('({games:generatedAt,rosters:rosterData.generated_at,injuries:injuryData.generated_at,context:nbaGameContext.generated_at})')),{games:stamp,rosters:stamp,injuries:stamp,context:stamp},'Late init responses must not replace newer scan source timestamps');
 assert.equal(evaluate('injuryData.injuries[0]?.status'),'OUT','A newer verified OUT designation survives a late older initial report');
 assert.deepEqual(plain(evaluate('games.map(g=>g.id)')),['late'],'A late older game feed cannot restore a previous slate');
 console.log('NBA selection page: monotonic startup sources, failed-refresh and in-flight-source holds, fresh Quick Slip evidence, Eastern identity preservation, honest rate units and quick builder wiring PASS');
})().catch(error=>{console.error(error);process.exitCode=1});
