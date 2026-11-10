const assert=require('node:assert/strict');
const ui=require('./nba_pipeline_ui.js');
const now=Date.parse('2026-11-01T12:00:00Z');
const a={game_id:'g',game:'A @ B',model:'v2',generated_at:new Date(now).toISOString(),tipoff:new Date(now+3600000).toISOString(),status:'RESEARCH LEAN',reasons:[],blockers:[],projections:[],rotation:[],starters:{},top_players:[],best_single:null,simulation_runs:10000,limits:'uncalibrated',sgp:{bookmaker:'hardrockbet',observed_at:new Date(now).toISOString(),decimal_odds:5,joint_probability:.25,estimated_ev:.25,legs:[{player_id:'p',player:'<script>bad</script>',observed_at:new Date(now).toISOString(),side:'over',line:10,market:'points',minutes:30,projection:15,sample:8}]}};
const ratings=[{playerId:'p',market:'points',eligible:true,researchScore:80}];
let html=ui.render(a,{model:'v2',graded_games:1,graded_projections:10,mae:2},now,ratings);
assert(html.includes('SGP research lean'));assert(html.includes('&lt;script&gt;'));assert(!html.includes('<script>bad'));
assert(html.includes('Frozen model grading'));assert(html.includes('Best single'));
assert(ui.render({...a,generated_at:'invalid'},null,now).includes('PASS'));
assert(ui.render({...a,generated_at:new Date(now+1).toISOString()},null,now).includes('PASS'));
assert(ui.render({...a,tipoff:new Date(now-1).toISOString()},null,now).includes('already started'));
a.sgp.observed_at=new Date(now-7200000).toISOString();html=ui.render(a,null,now);assert(html.includes('quote expired'));assert(!html.includes('Actual combined decimal price'));
a.sgp=null;a.research_ticket={legs:[{player_id:"p",side:"over",market:"points"}],joint_probability:.2,fair_decimal:5,minimum_decimal_for_5pct_ev:5.25};html=ui.render(a,null,now,ratings);assert(html.includes('not a bet'));assert(html.includes('5.25'));assert(!html.includes('Actual combined decimal price'));
a.blockers=['injuries'];assert(!ui.render(a,null,now).includes('Unpriced SGP research target'));
const fs=require('node:fs');const source=fs.readFileSync('nba.html','utf8');assert(source.includes('request!==pipelineRequest'),'Stale responses must not overwrite selected matchup');assert(source.indexOf('id="output"')<source.indexOf('id="pipeline"'),'Interactive game tools must remain directly accessible');assert(!source.includes('<details><summary>Legacy explorer'),'Helpful tools must not be hidden in a collapsed legacy section');assert(source.includes('href="#nba-tools"')&&source.includes('href="#nba-analyst"'),'Both analysis sections need direct navigation');
console.log('Published NBA model UI: PASS');
// Every recommendation surface uses the same current positional rating.
a.blockers=[];a.sgp=null;a.research_ticket=null;
a.best_single={player_id:'p',player:'Sentinel',side:'over',market:'points',observed_at:new Date(now).toISOString()};a.top_players=[a.best_single];
for(const score of [74,NaN])assert(!ui.render(a,null,now,[{...ratings[0],researchScore:score}]).includes('Sentinel'));
assert(!ui.render(a,null,now).includes('Sentinel'));
assert(ui.render(a,null,now,[{...ratings[0],researchScore:75}]).includes('75/100'));
for(const patch of [{side:'under'},{market:'threes'}]){const b={...a,best_single:{...a.best_single,...patch},top_players:[{...a.best_single,...patch}]};assert(!ui.render(b,null,now,ratings).includes('Sentinel'))}
assert(!ui.render({...a,blockers:['availability']},null,now,ratings).includes('Sentinel'));
