/* CLI entry point for shared browser/Node reliability evaluation. */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {evaluate}=require('../betting_readiness.js');
const base=path.resolve(__dirname,'..','data');
const read=name=>{try{return JSON.parse(fs.readFileSync(path.join(base,name),'utf8'))}catch(_){return null}};
const result=evaluate({
 nbaReport:read('nba_simulator_report.json'),
 nbaAccuracy:read('nba_prospective_accuracy.json'),
 nbaMarket:read('nba_market_status.json'),
 nflAudit:read('game_picks_simulator_audit.json'),
 nflSummary:read('nfl_score_model_summary.json'),
 nflMarket:read('game_picks_market_comparison.json')
});
console.log(JSON.stringify(result,null,2));
if(process.argv.includes('--assert-no-false-ready')&&result.betReady!==false)process.exitCode=1;
