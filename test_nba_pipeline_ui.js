const assert=require('node:assert/strict');
const ui=require('./nba_pipeline_ui.js');
const now=Date.parse('2026-11-01T12:00:00Z');
const a={game_id:'g',game:'A @ B',model:'v2',generated_at:new Date(now).toISOString(),tipoff:new Date(now+3600000).toISOString(),status:'RESEARCH LEAN',reasons:[],blockers:[],projections:[],rotation:[],starters:{},top_players:[],best_single:null,simulation_runs:10000,limits:'uncalibrated',sgp:{bookmaker:'hardrockbet',observed_at:new Date(now).toISOString(),decimal_odds:5,joint_probability:.25,estimated_ev:.25,legs:[{player_id:'p',player:'<script>bad</script>',observed_at:new Date(now).toISOString(),side:'over',line:10,market:'points',minutes:30,projection:15,sample:8}]}};
const ratings=[{playerId:'p',market:'points',eligible:true,researchScore:85}];
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
// Every recommendation surface uses the same current positional rating.
a.blockers=[];a.sgp=null;a.research_ticket=null;
a.best_single={player_id:'p',player:'Sentinel',side:'over',market:'points',observed_at:new Date(now).toISOString()};a.top_players=[a.best_single];
for(const score of [75,84.99,100.01,Infinity,NaN,null,'85'])assert(!ui.render(a,null,now,[{...ratings[0],researchScore:score}]).includes('Sentinel'));
assert(!ui.render(a,null,now).includes('Sentinel'));
for(const score of [85,100])assert(ui.render(a,null,now,[{...ratings[0],researchScore:score}]).includes(score+'/100'));
assert(ui.render(a,null,now).includes('PASS · No supported OVER matchup rated 85+/100'));
for(const patch of [{side:'under'},{market:'threes'}]){const b={...a,best_single:{...a.best_single,...patch},top_players:[{...a.best_single,...patch}]};assert(!ui.render(b,null,now,ratings).includes('Sentinel'))}
assert(!ui.render({...a,blockers:['availability']},null,now,ratings).includes('Sentinel'));
const underRecord={...a,best_single:{...a.best_single,side:'under'},top_players:[{...a.best_single,side:'under'}]};
for(const score of [75,84.99,100.01,Infinity,NaN,null,'85'])assert(!ui.render(underRecord,null,now,[{...ratings[0],side:'under',researchScore:score}]).includes('Sentinel'));
for(const score of [85,100])assert(!ui.render(underRecord,null,now,[{...ratings[0],side:'under',researchScore:score}]).includes('Sentinel'));
assert(!ui.render(underRecord,null,now,[{...ratings[0],side:'over',researchScore:99}]).includes('Sentinel'));
// Quoted and unpriced tickets share the same matchup-only gate for both sides.
for(const side of ['over']){
 const pick={...a.best_single,side,researchScore:100,probability:.99};
 const row={...ratings[0],side};
 const quoted={...a,best_single:null,top_players:[],sgp:{bookmaker:'hardrockbet',observed_at:new Date(now).toISOString(),legs:[pick]}};
 const unpriced={...quoted,sgp:null,research_ticket:{legs:[pick],joint_probability:.2,fair_decimal:5,minimum_decimal_for_5pct_ev:5.25}};
 for(const score of [84.99,100.01,Infinity,NaN]){
  const rows=[{...row,researchScore:score}];
  assert(!ui.render(quoted,null,now,rows).includes('SGP research lean'));
  assert(!ui.render(unpriced,null,now,rows).includes('Unpriced SGP research target'));
 }
 assert(!ui.render(quoted,null,now).includes('SGP research lean'));
 assert(!ui.render(unpriced,null,now).includes('Unpriced SGP research target'));
 assert(ui.render(quoted,null,now,[row]).includes('SGP research lean'));
 assert(ui.render(unpriced,null,now,[row]).includes('Unpriced SGP research target'));
 const threesRecord={...a,best_single:{...pick,market:'threes'},top_players:[{...pick,market:'threes'}]};
 assert(ui.render(threesRecord,null,now,[{...row,market:'threes',researchScore:85}]).includes('Sentinel'));
 assert(!ui.render(threesRecord,null,now,[{...row,market:'threes',researchScore:84.99}]).includes('Sentinel'));
 const combined={...quoted,sgp:{...quoted.sgp,legs:[{...pick,market:'pra'}]}};
 const combinedRows=['points','rebounds','assists'].map(market=>({...row,market}));
 assert(ui.render(combined,null,now,combinedRows).includes('SGP research lean'));
 assert(!ui.render(combined,null,now,combinedRows.map(r=>r.market==='assists'?{...r,researchScore:84.99}:r)).includes('SGP research lean'));
 assert(!ui.render(combined,null,now,combinedRows.map(r=>r.market==='assists'?{...r,researchScore:101}:r)).includes('SGP research lean'));
}
const projectionRecord={...a,best_single:null,top_players:[],rotation:[{player_id:'archive',player:'Projection Sentinel',minutes:30,status:'available'}],projections:[{player_id:'archive',market:'points',projection:22.5}]};
html=ui.render(projectionRecord,{model:'v2',graded_games:1,graded_projections:10,mae:2},now,[]);
assert(html.includes('PASS · No supported OVER matchup rated 85+/100'));
assert(html.includes('Projection Sentinel')&&html.includes('22.5'));
assert(html.includes('Frozen model grading'));
console.log('Published NBA model UI: PASS');

for(const ticket of ['sgp','research_ticket']){
 const under={...a.best_single,side:'under'},bad={...a,best_single:under,top_players:[under],sgp:null,research_ticket:null};bad[ticket]={bookmaker:'hardrockbet',observed_at:new Date(now).toISOString(),legs:[under],joint_probability:.2,fair_decimal:5,minimum_decimal_for_5pct_ev:5.25};
 const html=ui.render(bad,null,now,[{...ratings[0],side:'under',researchScore:100}]);assert(!html.includes('Sentinel'));assert(!html.includes('SGP research lean'));assert(!html.includes('Unpriced SGP research target'));
}
