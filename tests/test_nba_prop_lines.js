'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const lines=require('../nba_prop_lines');
const samples=[10,12,15,17,20,22,25,30];
const selected=lines.select({market:'points',samples});
assert.equal(selected.available,true);assert.equal(selected.line,14.5);assert.equal(selected.milestone,15);assert.equal(selected.frequency,.75);assert.equal(selected.offered,false);
assert.equal(selected.policy,'nba-balanced-alt-v1');assert.equal(selected.calibrated,false);
assert.deepEqual(lines.select({market:'points',samples:[...samples],odds:-5000}),selected,'Prices never change selected research lines');
for(const alias of ['pr','Points + Rebounds'])assert.equal(lines.canonical(alias),'pr');
assert.equal(lines.canonical('Points + Assists'),'pa');assert.equal(lines.canonical('Rebounds + Assists'),'ra');assert.equal(lines.canonical('PRA'),'pra');
const tied=lines.select({market:'assists',samples:[2,3,4,5,6,7,8,9]});assert.equal(tied.line,3.5,'Equidistant targets prefer the more meaningful higher threshold');
assert.equal(lines.select({market:'points',samples:[0,1,2,3,4]}).available,false,'Do not suggest a one-point floor to inflate hit frequency');
for(const options of [{market:'unknown',samples},{market:'points',samples:[1,2,3,4]},{market:'points',samples:[...samples,NaN]},
 {market:'points',samples:[...samples,-1]},{market:'points',samples:[...samples,'20']},{market:'points',samples,offeredLines:[14.5,Infinity]},
 {market:'points',samples,offeredLines:[]},{market:'points',samples,offeredLines:'14.5'}])assert.equal(lines.select(options).available,false);
const offered=lines.select({market:'points',samples,offeredLines:[10,16.5,21.5]});assert.equal(offered.offered,true);assert([10,16.5,21.5].includes(offered.line));
assert(!lines.ladder({market:'points',samples,offeredLines:[16.5]}).some(row=>row.line===14.5),'Never manufacture a line while actual book lines are supplied');
const exact=lines.evaluate([9,10,10,11],10);assert.deepEqual([exact.wins,exact.pushes,exact.losses],[1,2,1]);assert.deepEqual([exact.winFrequency,exact.pushFrequency,exact.lossFrequency],[.25,.5,.25]);
assert.equal(lines.evaluate([0,0,0],.5).winFrequency,0,'A real zero is an outcome');assert.equal(lines.evaluate([1,Infinity],.5).available,false);
const sparse=samples.slice();delete sparse[2];assert.equal(lines.evaluate(sparse,14.5).available,false,'Missing slots cannot become synthetic losses');
assert.equal(lines.select({market:'points',samples:sparse}).available,false);
const sparseLines=[14.5,19.5];delete sparseLines[0];assert.deepEqual(lines.ladder({market:'points',samples,offeredLines:sparseLines}),[]);
assert.equal(lines.minimum('rebounds'),4);assert.equal(lines.minimum('assists'),3);assert.equal(lines.minimum('threes'),1);
const input=JSON.stringify({samples,offeredLines:[14.5,19.5]});const options=JSON.parse(input);lines.select({market:'points',...options});assert.equal(JSON.stringify(options),input);
const browser={};vm.createContext(browser);vm.runInContext(fs.readFileSync(require.resolve('../nba_prop_lines'),'utf8'),browser);
assert.deepEqual(JSON.parse(JSON.stringify(browser.CookNBAPropLines.select({market:'points',samples}))),selected);
console.log('NBA alternate-line policy: shared target, strict settlement, floors, actual offered lines, missing evidence and odds independence PASS');
