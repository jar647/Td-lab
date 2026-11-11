'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {KEY,grade}=require('../nba_simulator_ui.js');
const tip='2026-11-11T00:00:00Z';
function storage(lock){
 const map=new Map([[KEY,JSON.stringify([lock])]]);
 return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};
}
function lock(){return {gameId:'123',home:'Home',away:'Away',tipoff:tip,lockedAt:'2026-11-10T23:00:00Z',projection:{home:105,away:100,homeWin:.6,margin:{p10:-20,p90:20},total:{p10:180,p90:240}},prices:[],market:{}};}
function final(date=tip,home='Home',away='Away'){
 return {id:123,status:'STATUS_FINAL',date,home,away,players:[
 ...Array.from({length:5},()=>({team:home,stats:{PTS:22}})),
 ...Array.from({length:5},()=>({team:away,stats:{PTS:20}}))]};
}
test('grades matching final with original tipoff and teams',()=>{
 const s=storage(lock());
 assert.equal(grade({games:[final()],generated_at:'2026-11-11T04:00:00Z'},s,Date.parse('2026-11-11T05:00:00Z')).graded,1);
});
test('rejects reused ID, changed tipoff and changed teams',()=>{
 for(const g of [final('2026-11-12T00:00:00Z'),final(tip,'Other','Away'),final(tip,'Home','Other'),{...final(),date:null}]){
  const s=storage(lock());g.date=g.date||null;
  assert.equal(grade({games:[g],generated_at:'2026-11-12T04:00:00Z'},s,Date.parse('2026-11-12T05:00:00Z')).graded,0);
  assert.equal(JSON.parse(s.getItem(KEY))[0].grade,undefined);
 }
});
