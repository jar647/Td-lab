const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const script=path.join(__dirname,'../scripts/grade_nfl_simulator.js');
const sample={gameId:'g1',playerId:'WR|A',market:'receptions',line:4,probability:.75,actual:5,predictionFrozenAt:'2026-10-01T12:00:00Z',kickoffAt:'2026-10-01T17:00:00Z',resultRecordedAt:'2026-10-02T12:00:00Z'};
test('CLI grades valid frozen pregame prediction records',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nfl-grade-'));
 try{const file=path.join(dir,'records.json');fs.writeFileSync(file,JSON.stringify([sample]));
 const run=spawnSync(process.execPath,[script,file],{encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);
 const out=JSON.parse(run.stdout);assert.equal(out.overall.count,1);assert.equal(out.overall.brierScore,.0625);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('CLI refuses predictions frozen after kickoff',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nfl-grade-'));
 try{const file=path.join(dir,'records.json');fs.writeFileSync(file,JSON.stringify([{...sample,predictionFrozenAt:sample.kickoffAt}]));
 const run=spawnSync(process.execPath,[script,file],{encoding:'utf8'});
 assert.notEqual(run.status,0);assert.match(run.stderr,/before kickoff/);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
