const test=require('node:test');const assert=require('node:assert/strict');const {describe}=require('../ufc_matchup_research.js');
const stats={slpm:4,sapm:3,strAcc:50,strDef:60,tdAvg:2,tdAcc:40,tdDef:60,subAvg:1};
const bout=(id,date,winner,extra={})=>({bout_id:id,event_date:date,starts_at:date,status:'final',fighter_a:'a',fighter_b:'b',winner,method_display:'Decision',...extra});
test('historical cutoff excludes future bouts from form and opponent quality',()=>{
 const profile={id:'a',recent_fights:[bout('1','2025-01-01','a',{opponent_record:{wins:5,losses:2},opponent_record_source:'provider'}),bout('2','2027-01-01','a',{opponent_record:{wins:10,losses:0},opponent_record_source:'provider'})]};
 const r=describe(stats,stats,{asOf:'2026-01-01',profiles:[profile,{}]});
 assert.equal(r.recentEvidence[0].sample,1);assert.equal(r.opponentQuality[0].verified,1);
});
test('unknown winners, draws and scheduled results are excluded',()=>{
 const p={id:'a',recent_fights:[bout('1','2025-01-01','unknown'),bout('2','2025-02-01','draw'),bout('3','2025-03-01','a',{status:'scheduled'}),bout('4','2025-04-01','a')]};
 assert.equal(describe(stats,stats,{profiles:[p,{}]}).recentEvidence[0].sample,1);
});
