#!/usr/bin/env node
'use strict';
// Prospective UNDER study. Frozen *research*, never user-facing betting picks.
// Run with --dry-run for diagnostics without touching the git working tree.
const fs=require('node:fs'),path=require('node:path');
const engine=require('../nba_game_first');
const shadow=require('../nba_under_shadow');
const root=path.join(__dirname,'..'),location=path.join(root,'data','recommendations','nba_under_shadow.json');
const load=name=>JSON.parse(fs.readFileSync(path.join(root,'data',name+'.json'),'utf8'));
const now=Date.now(),day=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
const valid=(v,h)=>Number.isFinite(Date.parse(v?.generated_at))&&Date.parse(v.generated_at)<=now+300000&&now-Date.parse(v.generated_at)<=h*3600000;
let old=null;try{old=JSON.parse(fs.readFileSync(location,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
const feed=load('nba_games'),injuries=load('nba_injuries'),rosters=load('nba_rosters'),context=load('nba_game_context');
const analyses=[],report=[];
if(valid(feed,12)&&valid(rosters,72)&&valid(injuries,12)&&injuries.status==='ok'){
 const games=feed.games.filter(g=>g.status==='STATUS_SCHEDULED'&&Date.parse(g.date)>now&&day(g.date)===day(now));
 for(const g of games){
  const near=Date.parse(g.date)-now<=90*60000;
  if(near&&!valid(injuries,.25)){report.push({gameId:g.id,reason:'Availability snapshot older than 15 minutes'});continue}
  const analysis=engine.analyze(g,feed,injuries,rosters,context,now,{count:1000});
  if(analysis.reason){report.push({gameId:g.id,reason:analysis.reason});continue}
  analyses.push({analysis,rosters});
  report.push({gameId:g.id,shadowEligible:shadow.evaluate(analysis,rosters,now).length});
 }
}else report.push({reason:'Required snapshots stale or invalid; no new pregame shadow captures',sourceTimes:{games:feed.generated_at,rosters:rosters.generated_at,injuries:injuries.generated_at}});
const ledger=shadow.update(old,analyses,feed,now),newPicks=ledger.picks.length-(old?.picks?.length||0);
console.log('NBA UNDER SHADOW:',JSON.stringify({dateEastern:day(now),newPicks,totalFrozen:ledger.picks.length,graded:ledger.summary.graded,pending:ledger.summary.pending,sourceTimes:{games:feed.generated_at,rosters:rosters.generated_at,injuries:injuries.generated_at},gameResults:report,probabilitiesCalibrated:false,betReady:false}));
if(!process.argv.includes('--dry-run')&&JSON.stringify(old)!==JSON.stringify(ledger)){
 fs.mkdirSync(path.dirname(location),{recursive:true});
 fs.writeFileSync(location,JSON.stringify(ledger,null,2)+'\n');
}
