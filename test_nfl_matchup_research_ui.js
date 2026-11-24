/* Visible NFL research uses evidence, never book prices or invented confidence. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ui=require('./nfl_matchup_research_ui'),engine=require('./game_odds_engine');
const rate={available:true,offense_epa:.12,opponent_allowed_epa:.16,league_epa:.05,
 offense_relative_to_league:.07,opponent_allowance_relative_to_league:.11,
 matchup_epa_estimate:.23,matchup_relative_to_league:.18,signal:'FAVORABLE',
 offense_games:8,opponent_games:8,offense_plays:160,opponent_plays:170,
 confidence:{level:'SUPPORTED',basis:'Eight earlier games in each sample.'}};
const rating={offense_points:1.25,defense_allowed_points:-.75,net_strength_points:2,
 offense_rank:1,defense_rank:1,net_rank:1,current_season_games:8,ranked_teams:2};
const card={version:'nfl-matchup-research-v1',status:'RESEARCH_ONLY',season:2026,through_week:7,score_adjustments_applied:false,
 strength:{available:true,league_points:22,home_advantage_points:1.5,training_games:280,teams:{A:rating,B:{...rating,offense_rank:2,defense_rank:2,net_rank:2}}},
 opportunities:[{team:'A',opponent:'B',pass:rate,rush:{available:false,reason:'Insufficient rushing games.',confidence:{level:'INSUFFICIENT',basis:'Sparse history.'}}},
  {team:'B',opponent:'A',pass:{...rate,signal:'ADVERSE',matchup_relative_to_league:-.08},rush:{...rate,confidence:{level:'LIMITED',basis:'Limited rushing sample.'}}}],
 limits:['Rates describe recorded games; forecast calibration is unproven.']};
const model={sport:'NFL',home:'B',away:'A',matchupResearch:card};
const before=JSON.stringify(model),html=ui.render(model);
assert.match(html,/Opponent-adjusted team strength/);assert.match(html,/Offense \+1\.25 points · rank 1\/2/);
assert.match(html,/Defense allowed -0\.75 points/);assert.match(html,/Net team strength \+2\.00/);
assert.match(html,/Favorable historical signal/);assert.match(html,/opponent allows 0\.160/);
assert.match(html,/Combined signal \+0\.180 EPA\/play versus league/);assert.match(html,/Sample support: <strong>supported/);
assert.match(html,/Insufficient rushing games/);assert.match(html,/amount of evidence|Sample support describes/);
assert.match(html,/not a win probability/);assert.match(html,/do not change forecast scores or simulated percentages/);
assert.doesNotMatch(html,/\d(?:\.\d+)?%|guaranteed|BET NOW|estimated EV/);
assert.equal(JSON.stringify(model),before);
assert.equal(ui.render({...model,homeML:-1000,awayML:950,total:48.5}),html,'Sportsbook edits cannot alter research evidence');
assert.equal(ui.render({...model,sport:'NBA'}),'','NFL research must not appear for NBA');
for(const invalid of [null,{...card,status:'LIVE_BET'},{...card,score_adjustments_applied:true},{...card,season:NaN},{...card,opportunities:null}]){
 const result=ui.render({...model,matchupResearch:invalid});assert.match(result,/Current research is unavailable/);assert.doesNotMatch(result,/Favorable historical signal|rank 1\/2/);
}
for(const bad of [{...rate,offense_epa:NaN},{...rate,opponent_allowed_epa:null},{...rate,offense_games:2},
 {...rate,opponent_plays:-1},{...rate,confidence:{level:'99% certain'}},{...rate,signal:'<img src=x>'}]){
 const result=ui.render({...model,matchupResearch:{...card,opportunities:[{team:'A',opponent:'B',pass:bad,rush:null}]}});
 assert.doesNotMatch(result,/Favorable historical signal|<img/);assert.match(result,/unavailable/);
}
const ambiguous=ui.render({...model,matchupResearch:{...card,opportunities:[card.opportunities[0],card.opportunities[0]]}});
assert.match(ambiguous,/unambiguous pass\/rush comparison is unavailable/);assert.doesNotMatch(ambiguous,/Favorable historical signal/);
const hostile='<img src=x onerror=alert(1)>',escaped=ui.render({sport:'NFL',home:'B',away:hostile,matchupResearch:{...card,
 strength:{...card.strength,teams:{[hostile]:rating,B:rating}},opportunities:[{team:hostile,opponent:'B',pass:{...rate,confidence:{level:'SUPPORTED',basis:hostile}}}],limits:[hostile]}});
assert(!escaped.includes('<img'));assert(escaped.includes('&lt;img'));
const browser={};vm.createContext(browser);vm.runInContext(fs.readFileSync('nfl_matchup_research_ui.js','utf8'),browser);
assert.equal(browser.PropShopNFLMatchupResearchUI.render(model),html,'Browser and CommonJS renderers must agree');

const page=fs.readFileSync('game-odds.html','utf8');
const controller=[...page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).find(Boolean);
const elements=new Map();
const el=id=>{if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',textContent:'',hidden:false,disabled:false,
 classList:{toggle(){}},addEventListener(){},scrollIntoView(){}});return elements.get(id)};
const feed={season:2026,week:8,generated_at:new Date().toISOString(),games:[{game_id:'2026_08_A_B',home:'B',away:'A',gameday:'2099-11-01',kickoff_at:'2099-11-01T18:00:00Z',
 projected_home_points:24,projected_away_points:22,model_inputs:{home:{games:8},away:{games:8},matchup_research:card,
 research_context:{teams:{A:{usage:{quarterback:{player_id:'old-qb',name:'Other high usage QB',position:'QB'},
 quarterback_basis:{player_id:'chosen-qb',player:'Selected QB',source:'SOURCED_DEPTH_CHART',assumption:'Depth-chart first unit; game-day starting status is not confirmed.'}}}}}}}]};
const history={records:Array.from({length:70},(_,i)=>({season:2025,week:1+i%17,projected_home:22,projected_away:20,actual_home:21+i%7,actual_away:19+i%5}))};
const lineupHistory={model_version:'opponent-score-ridge-v1',records:history.records.map((r,i)=>({...r,game_id:'earlier-'+i,candidate_home:22,candidate_away:20}))};
const sandbox={document:{getElementById:el},location:{search:'?sport=NFL'},URLSearchParams,Intl,Date,setTimeout,console,
 CookGameOdds:engine,PropShopNFLMatchupResearchUI:ui,localStorage:{getItem(){return null},setItem(){}},
 fetch:async url=>({ok:true,json:async()=>String(url).includes('game_picks_backtest')?history:String(url).includes('game_picks.json')?feed:String(url).includes('nfl_score_model_audit')?lineupHistory:{games:[]}})};
vm.createContext(sandbox);vm.runInContext(controller,sandbox,{timeout:5000});
(async()=>{
 await new Promise(resolve=>setTimeout(resolve,60));el('game').value='2026_08_A_B';el('game').onchange();
 assert.match(el('trustPreview').innerHTML,/Historical team scoring only/,'Automatic analysis must disclose missing source inputs without a model dropdown');
 assert.match(el('trustPreview').innerHTML,/Opponent-adjusted team strength/,'Research remains visible before a supported lineup scenario is available');
 assert.equal(el('homeML').value,'');assert.equal(el('awayML').value,'');
 feed.games[0].model_inputs.lineup_scenario={available:true,version:'nfl-qb-lineup-scenario-v2',base_version:'opponent-score-ridge-v1',generated_at:new Date().toISOString(),
  home:24,away:22,through_week:7,before_absence_adjustment:{home:24,away:22},reason:'Sourced starting assumptions, game-day status unconfirmed.',
  quarterbacks:{A:{player_id:'chosen-qb',player:'Selected QB',effect_available:true,source:'SOURCED_DEPTH_CHART',assumption:'Depth-chart first unit; game-day starting status is not confirmed.'},
   B:{player_id:'b-qb',player:'B QB',effect_available:true,source:'ASSUMED_LAST_OBSERVED_QB',assumption:'Unconfirmed last-observed quarterback.'}},
  injuries:{A:{coverage:'SHARED_CURRENT_GAME_REPORTS',reports:[
   {player:'Current receiver <check>',position:'WR',designation:'QUESTIONABLE',source_updated_at:'2026-10-29T12:00:00Z',source:'https://source.example/injury'},
   {player:'Doubtful tackle',position:'OT',designation:'DOUBTFUL',source_updated_at:'2026-10-29T13:00:00Z',source:'javascript:alert(1)'},
   {player:'Retained receiver',position:'WR',designation:'OUT',cached:true}],
   units:[{side:'offense',status:'NO_SUPPORTED_SHIFT',players:[],applied:false,reason:'No injury point adjustment guessed.'}]}},limits:['Injury status requires confirmation.']};
 el('run').onclick();for(let i=0;i<40&&el('results').hidden;i++)await new Promise(resolve=>setTimeout(resolve,30));
 const output=el('results').innerHTML;assert.equal(el('results').hidden,false);assert.match(output,/Opponent-adjusted team strength/);
 assert.match(output,/Selected QB/);assert.match(output,/Sourced depth-chart first unit/);assert.match(output,/starting status is not confirmed/);
 assert.doesNotMatch(output,/Other high usage QB/,'A different quarterback’s usage must not be attributed to the selected starter');
 assert.match(output,/Selected-QB usage is unavailable/);assert.match(output,/The signals do not change forecast scores or simulated percentages/);
 assert.doesNotMatch(output,/EPA\/success matchup and home\/road scoring splits shift the score mean/);
 const preview=el('trustPreview').innerHTML;
 assert.match(preview,/Supported QB\/lineup scenario; full passing\/rushing matchup inputs unavailable/,'Valid QB inputs must be applied automatically when full EPA inputs are unsupported');
 assert.match(preview,/<details><summary>Current injury reports · 3<\/summary>/,'Current reports stay in a compact dropdown before a run');
 assert.match(preview,/Current receiver &lt;check&gt;/);assert.match(preview,/QUESTIONABLE · uncertain availability; not assumed OUT/);
 assert.match(preview,/DOUBTFUL · uncertain availability; not assumed OUT/);assert.match(preview,/source report date 2026-10-29T12:00:00Z/);
 assert.match(preview,/href="https:\/\/source\.example\/injury"/);assert.doesNotMatch(preview,/href="javascript:/);
 assert.match(preview,/retained OUT report; latest source confirmation unavailable/);assert.match(preview,/No injury point shift applied/);
 assert.match(preview,/do not create an OUT assumption or an automatic injury point shift/);
 console.log('NFL research UI: evidence, source coverage, missing data, odds independence, pre-run injuries and selected-QB attribution PASS');
})().catch(error=>{console.error(error);process.exitCode=1});
