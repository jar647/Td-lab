const test=require('node:test');const assert=require('node:assert/strict');const {describe}=require('../ufc_matchup_research.js');
const stats={slpm:4,sapm:3,strAcc:50,strDef:60,tdAvg:2,tdAcc:40,tdDef:60,subAvg:1};
test('only sourced opponent records contribute to quality',()=>{
 const p={id:'a',recent_fights:[
 {bout_id:'old',event_date:'2025-01-01',fighter_a:'a',fighter_b:'x',opponent_record:{wins:9,losses:1},opponent_record_source:'verified'},
 {bout_id:'new',event_date:'2026-01-01',fighter_a:'a',fighter_b:'y',opponent_record:{wins:1,losses:9}},
 {bout_id:'newer',event_date:'2026-02-01',fighter_a:'a',fighter_b:'z',opponent_record:{wins:3,losses:2},opponent_record_source:'verified'}
 ]};
 const q=describe(stats,stats,{profiles:[p,{}]}).opponentQuality[0];
 assert.equal(q.verified,2);assert.equal(q.averageWinRate,0.75);
});
test('no record source means no opponent-quality inference',()=>{
 const q=describe(stats,stats,{profiles:[{id:'a',recent_fights:[{fighter_a:'a',fighter_b:'b',opponent_record:{wins:10,losses:0}}]},{}]}).opponentQuality[0];
 assert.equal(q.verified,0);assert.equal(q.averageWinRate,null);
});