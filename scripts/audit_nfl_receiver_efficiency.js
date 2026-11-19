/* Chronological, paired receiver-efficiency comparison. Never uses book prices. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const engine=require('../nfl_game_engine');
const mean=xs=>xs.length?xs.reduce((s,x)=>s+x,0)/xs.length:null;
function intervalByGame(rows,fieldBefore,fieldAfter){
 const groups=new Map();for(const r of rows){if(!groups.has(r.gameId))groups.set(r.gameId,[]);groups.get(r.gameId).push(r[fieldAfter]-r[fieldBefore])}
 if(groups.size<15)return null;
 const values=[...groups.values()].map(xs=>({sum:xs.reduce((s,x)=>s+x,0),n:xs.length})),draws=[];let state=6472026;
 for(let b=0;b<400;b++){let sum=0,n=0;for(let i=0;i<values.length;i++){state=(Math.imul(state,1664525)+1013904223)>>>0;const g=values[state%values.length];sum+=g.sum;n+=g.n}draws.push(sum/n)}
 draws.sort((a,b)=>a-b);return [draws[10],draws[389]];
}
function audit(records,{runs=1000,validationWeek=9}={}){
 const players=records.filter(p=>p.market==='ATD'&&p.playerAppearancesVerified===true&&Array.isArray(p.seasonGameStats));
 const games=new Map(),seen=new Set();
 for(const p of players){const key=p.team+'|'+p.player_id;if(seen.has(key))throw Error('Ambiguous player identity in audit input');seen.add(key);
  for(const row of p.seasonGameStats){const match=/^(\d{4})_(\d{2})_([^_]+)_([^_]+)$/.exec(row.gameId||'');
   if(!match||![match[3],match[4]].includes(p.team)||!Number.isInteger(row.week)||Number(match[2])!==row.week)continue;
   if(!games.has(row.gameId))games.set(row.gameId,{id:row.gameId,season:Number(match[1]),week:row.week,away:match[3],home:match[4],actual:new Map()});
   const g=games.get(row.gameId);if(g.actual.has(String(p.player_id)))throw Error('Duplicate actual player-game');g.actual.set(String(p.player_id),row);
  }
 }
 const observations=[],failures=[];
 for(const g of [...games.values()].sort((a,b)=>a.id.localeCompare(b.id))){
  const rows=players.filter(p=>[g.home,g.away].includes(p.team)).flatMap(p=>{
   const prior=p.seasonGameStats.filter(r=>r.week<g.week&&r.gameId?.startsWith(g.season+'_'));
   if(prior.length<3)return [];
   const latest=players.filter(other=>String(other.player_id)===String(p.player_id)).flatMap(other=>other.seasonGameStats.filter(r=>r.week<g.week&&r.gameId?.startsWith(g.season+'_')).map(r=>({week:r.week,team:other.team}))).sort((a,b)=>b.week-a.week)[0];
   if(latest?.team!==p.team)return [];
   return [{...p,pos:prior.at(-1).position||p.pos,team:p.team,opp:p.team===g.home?g.away:g.home,seasonGameStats:prior,last5GameStats:prior.slice(-5),availability:'ROSTER_ACTIVE',injuryReportStatus:'UNVERIFIED',injuryPracticeStatus:'UNVERIFIED',depthChart:null,qbRole:undefined,starterContext:null,defenseOpponentRatio:{},teamPassAttemptsPerGame:null}];
  });
  let before,after;try{before=engine.simulate(rows,runs,6472026,[],{efficiencyProfile:'legacy'});after=engine.simulate(rows,runs,6472026,[],{efficiencyProfile:'sample_counts'});}catch(error){failures.push({game:g.id,reason:error.message});continue}
  const old=new Map(before.markets.map(m=>[[m.id,m.market,m.line].join('|'),m]));
  for(const m of after.markets){const actual=g.actual.get(m.id),prior=old.get([m.id,m.market,m.line].join('|'));
   if(!actual||!prior||!Number.isFinite(actual[m.market]))continue;
   const y=Number(actual[m.market]>=m.line);
   observations.push({gameId:g.id,week:g.week,playerId:m.id,market:m.market,line:m.line,actual:actual[m.market],beforeProbability:prior.scenarioRate,afterProbability:m.scenarioRate,beforeMean:prior.modeledMean,afterMean:m.modeledMean,brierBefore:(prior.scenarioRate-y)**2,brierAfter:(m.scenarioRate-y)**2});
  }
 }
 const folds={};
 for(const fold of ['development','validation']){
  const sample=observations.filter(r=>fold==='validation'?r.week>=validationWeek:r.week<validationWeek);
  folds[fold]={};for(const market of ['passYards','receptions','recYards','rushYards']){
   const rows=sample.filter(r=>r.market===market),unique=[...new Map(rows.map(r=>[r.gameId+'|'+r.playerId,r])).values()];
   const errors=unique.map(r=>({...r,errorBefore:Math.abs(r.beforeMean-r.actual),errorAfter:Math.abs(r.afterMean-r.actual)}));
   folds[fold][market]={games:new Set(rows.map(r=>r.gameId)).size,playerGames:unique.length,thresholds:rows.length,brierBefore:mean(rows.map(r=>r.brierBefore)),brierAfter:mean(rows.map(r=>r.brierAfter)),maeBefore:mean(errors.map(r=>r.errorBefore)),maeAfter:mean(errors.map(r=>r.errorAfter)),gameClusterBrierDeltaInterval:intervalByGame(rows,'brierBefore','brierAfter'),gameClusterMaeDeltaInterval:intervalByGame(errors,'errorBefore','errorAfter')};
  }
 }
 const v=folds.validation;
 const passed=['passYards','receptions','recYards'].every(k=>v[k].games>=15&&v[k].playerGames>=25&&v[k].brierAfter<=v[k].brierBefore&&v[k].maeAfter<=v[k].maeBefore)&&v.rushYards.brierAfter<=v.rushYards.brierBefore+.002;
 return {status:passed?'PAIRED_DIAGNOSTIC_PASSED_NOT_CALIBRATED':'PROMOTION_WITHHELD',runs,validationWeek,cohort:players.every(p=>p.seasonGameStats.every(r=>r.position))?'dated_weekly_player_statistics':'current_roster_snapshot',folds,observations,failures,
  limits:['Retrospective player-stat cohort; historical injury announcements and confirmed pregame rosters are unavailable. This is a conditional player-stat diagnostic, not historical injury validation or prospective probability calibration.','Only strictly earlier player weeks enter forecasts. Dated position labels are used when supplied. Current depth charts, injury statuses, opponent factors and sportsbook lines are omitted.','Season-to-date player appearance rows supply observed outcomes; missing target-game rows are excluded rather than invented as zero. Current-roster snapshot inputs are a narrower and potentially biased cohort.','Fixed research thresholds are evaluated without sportsbook prices. Whole-game bootstrap intervals describe sampling uncertainty only; source selection and structural model errors limit generalization. Passing the diagnostic does not establish an edge.']};
}
if(require.main===module){const input=process.argv[2]||'data/matchups.json',output=process.argv[3]||'/tmp/nfl-receiver-efficiency-audit.json';const raw=fs.readFileSync(input),result=audit(JSON.parse(raw),{runs:Number(process.env.NFL_AUDIT_RUNS)||1000,validationWeek:Number(process.env.NFL_AUDIT_VALIDATION_WEEK)||11});result.sourceSha256=crypto.createHash('sha256').update(raw).digest('hex');result.engineSha256=crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../nfl_game_engine.js'))).digest('hex');fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,observations:undefined,failures:result.failures.length},null,2));}
module.exports={audit};
