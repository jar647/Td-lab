const test=require('node:test');const assert=require('node:assert/strict');
const {describe}=require('../ufc_matchup_research.js');
const stats={slpm:4,sapm:3,strAcc:50,strDef:55,tdAvg:2,tdAcc:40,tdDef:65,subAvg:1};
const fight=(id,opponent,winner,method,round)=>({bout_id:id+'-'+round,fighter_a:id,fighter_b:opponent,winner,method_display:method,event_date:'2026-10-01'});
test('recent finish evidence only uses verified participant IDs',()=>{
 const result=describe(stats,stats,{names:['A','B'],profiles:[
 {id:'a',recent_fights:[fight('a','b','a','KO/TKO',1),fight('a','c','c','Submission',2),fight('x','y','x','KO/TKO',3)]},
 {id:'b',recent_fights:[fight('b','c','c','KO/TKO',1),fight('b','d','b','Decision',2)]}
 ]});
 assert.equal(result.recentEvidence[0].sample,2);
 assert.equal(result.recentEvidence[0].koWins,1);
 assert.equal(result.recentEvidence[1].koLosses,1);
 assert.ok(result.finishRoutes.some(x=>x.includes('Potential striking finish route')));
});
test('missing history does not invent finish tendencies',()=>{
 const result=describe(stats,stats,{names:['A','B']});
 assert.equal(result.recentEvidence[0].sample,0);
 assert.deepEqual(result.finishRoutes,[]);
});
