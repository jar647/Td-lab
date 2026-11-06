const fs=require('node:fs');
const path=require('node:path');
const engine=require('../game_odds_engine.js');
const feed=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/nba_games.json'),'utf8'));
const report=engine.backtestNBA(feed,{minHistory:40,maxGames:120,draws:1000});
if(report.games<50){console.error(JSON.stringify({error:'Insufficient evaluated games',games:report.games,skipped:report.skipped}));process.exit(1);}
const out=path.join(__dirname,'../data/nba_simulator_backtest.json');
fs.writeFileSync(out,JSON.stringify({...report,generatedAt:new Date().toISOString()},null,2)+'\n');
console.log(JSON.stringify({games:report.games,brier:report.brier,benchmarkBrier:report.benchmarkBrier,beatsCoinFlip:report.beatsCoinFlip,scoreMAE:report.scoreMAE,skipped:report.skipped,calibration:report.calibration},null,2));
