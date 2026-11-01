'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const engine=require('./game_odds_engine.js');
const html=fs.readFileSync('game-odds.html','utf8');
const controller=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).filter(Boolean)[0];
const elements=new Map();
function el(id){if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',textContent:'',hidden:false,disabled:false,classList:{toggle(){}},addEventListener(){},scrollIntoView(){}});return elements.get(id);}
const history={records:Array.from({length:110},(_,i)=>({season:2025,week:5+i%10,
 baseline_home:22,baseline_away:20,projected_home:25,projected_away:23,actual_home:22+i%5,actual_away:20+i%7}))};
const trust={source_status:'RECONCILED',checked_at:'2026-11-01T12:00:00Z',through_week:7,epa_missing_plays:0,
 projection_basis:'SCORING_BASELINE',calibration_status:'NOT_CALIBRATED',
 validation:{games:460,metrics:{margin:{baseline_mae:10.36,adjusted_mae:10.36,improvement_95pct_week_cluster_interval:[-.2,.2]}}},
 sample:{BAL:{counts:{offense:{plays:426,games:7}}}},definitions:{audit:'Same source, two calculation paths.'},
 qb_context:{BAL:{status:'RETURNING_STARTER_SAMPLE_MISMATCH',player:'Lamar Jackson',recent_games:4,recent_games_other_primary_qb:3,
 starter_led_offense:{games:3,plays:180,epa_per_play:.205,success_rate:.52},
 other_or_mixed_offense:{games:4,epa_per_play:-.08}}}};
const direction={available:true,offense_epa_per_play:.050853,defense_epa_allowed_per_play:.124993,
 offense_success_rate:.449,defense_success_allowed_rate:.475,offense_pass_rate:.53,defense_pass_rate_allowed:.622,
 explosive_rate_offense:.113,explosive_rate_defense_allowed:.107,recent_form_weight:.4,recent_form_games:4,
 pass_epa_matchup_delta:-.053,rush_epa_matchup_delta:-.054,plays_per_game:60.9,turnovers_per_game:.7,
 defensive_sacks_per_game:1.8,score_adjustment:0,experimental_score_adjustment:-.57,adjustment_applied:false};
const feed={season:2026,week:8,generated_at:new Date().toISOString(),games:[{
 game_id:'2026_08_BAL_BUF',home:'BUF',away:'BAL',gameday:'2099-11-01',model_version:'score-baseline-trust-v3',
 projected_home_points:26.3,projected_away_points:23.8,
 model_inputs:{home:{games:6},away:{games:7},trust,
 matchup:{home_offense_vs_away_defense:direction,away_offense_vs_home_defense:direction}}
}]};
const sandbox={document:{getElementById:el},location:{search:'?sport=NFL'},URLSearchParams,Intl,Date,setTimeout,console,
 CookGameOdds:engine,localStorage:{getItem(){return null},setItem(){}},
 fetch:async url=>({ok:true,json:async()=>url.includes('game_picks_backtest')?history:url.includes('game_picks')?feed:{games:[]}})};
vm.createContext(sandbox);vm.runInContext(controller,sandbox,{timeout:5000});
(async()=>{
 await new Promise(r=>setTimeout(r,60));
 el('game').value='2026_08_BAL_BUF';el('game').onchange();
 assert.match(el('trustPreview').innerHTML,/Lamar Jackson return/,'show lineup risk before taking odds or running the model');
 el('homeML').value='+150';el('run').onclick();
 for(let i=0;i<30&&el('results').hidden;i++)await new Promise(r=>setTimeout(r,50));
 const output=el('results').innerHTML;
 assert.match(output,/0\.051/);assert.match(output,/0\.125/,'EPA rounding must preserve the visible difference');
 assert.match(output,/NOT APPLIED/);assert.match(output,/QB-led game split/);
 assert.match(output,/3 of the last 4/);assert.match(output,/season only/);
 assert.match(output,/PASS · QB CHANGE NOT VALIDATED/);
 assert.match(output,/Independent calculation from the same/);
 assert(!output.includes('RESEARCH LEAN · UNVALIDATED'));
 console.log('Trust UI: source checks, precise EPA, starter split and disabled unsupported advice passed');
})().catch(e=>{console.error(e);process.exitCode=1});
