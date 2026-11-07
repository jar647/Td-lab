#!/usr/bin/env node
/* Grade frozen NFL player-market forecasts against settled results.
   Usage: node scripts/grade_nfl_simulator.js path/to/settled-predictions.json
   Input is an array of records accepted by NFLBacktest.evaluate().
   Does not invent missing snapshots or use future game data. */
'use strict';
const fs=require('node:fs');
const {evaluate}=require('../nfl_backtest.js');
function main(args){
 if(args.length!==1)throw Error('Usage: node scripts/grade_nfl_simulator.js <settled-predictions.json>');
 const rows=JSON.parse(fs.readFileSync(args[0],'utf8'));
 const result=evaluate(rows);
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
if(require.main===module){try{main(process.argv.slice(2))}catch(e){process.stderr.write('Backtest rejected: '+e.message+'\n');process.exitCode=1}}
module.exports={main};
