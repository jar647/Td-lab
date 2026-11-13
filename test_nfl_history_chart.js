'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8'),a=html.indexOf('function lastFiveChart('),b=html.indexOf('function renderFirstTdProbability()',a),ctx={escapeHTML:v=>String(v)};
vm.createContext(ctx);vm.runInContext(html.slice(a,b),ctx);
for(const missing of [null,undefined,'',' ',false,true,{},[],'unknown',Infinity,NaN]){
 const result=ctx.lastFiveChart({last5GameStats:[{week:1,rushYards:missing}],seasonAverages:{rushYards:null}},'RUSH',null,null);
 assert.match(result,/Chart withheld/,'incomplete history must not become a zero bar');assert.doesNotMatch(result,/Season average: 0/);
}
const row={playerAppearancesVerified:true,seasonGamesPlayed:2,last5GameStats:[{week:1,rushYards:0},{week:2,rushYards:50}],seasonAverages:{rushYards:null}};
const actual=ctx.lastFiveChart(row,'RUSH',25,null);
assert.match(actual,/Season average: N\/A/);assert.match(actual,/Last 2 average: 25.0/);assert.match(actual,/1\/2 hits/);assert.match(actual,/>0<\/b>/,'observed zero remains a real result');
assert.match(ctx.lastFiveChart({...row,seasonAverages:{rushYards:0}},'RUSH',null,0),/Season average: 0.0/);
assert.match(ctx.lastFiveChart({...row,last5GameStats:[{week:1,rushYards:-4}]},'RUSH',null,0),/>-4<\/b>/,'real negative yardage is retained');
console.log('NFL history charts preserve actual zeros and negative stats while withholding missing data');
