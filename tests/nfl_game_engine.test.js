const test=require('node:test');
const assert=require('node:assert/strict');
const engine=require('../nfl_game_engine.js');
const stats=Array.from({length:5},()=>({passAttempts:30,targets:6,receptions:4,recYards:48,rushAttempts:10,rushYards:44}));
function player(team,opp,pos,name,id){
 return {team,opp,pos,player:name,player_id:id,seasonGameStats:stats,playerAppearancesVerified:true,qbRole:pos==='QB'?'EXPECTED_STARTER':undefined};
}
test('simulation preserves market identifiers containing pipe characters',()=>{
 const records=[
  player('AAA','BBB','QB','A QB','AAA|QB'),player('AAA','BBB','WR','A WR','AAA|WR'),
  player('AAA','BBB','RB','A RB','AAA|RB'),player('AAA','BBB','TE','A TE','AAA|TE'),
  player('BBB','AAA','QB','B QB','BBB|QB'),player('BBB','AAA','WR','B WR','BBB|WR'),
  player('BBB','AAA','RB','B RB','BBB|RB'),player('BBB','AAA','TE','B TE','BBB|TE')
 ];
 const out=engine.simulate(records,1000,1234);
 assert.equal(out.status,'RESEARCH_ONLY_UNCALIBRATED');
 assert.ok(out.markets.length>0);
 assert.ok(out.markets.some(m=>m.id==='AAA|WR'&&m.market==='receptions'&&m.line===4));
 assert.ok(out.markets.some(m=>m.id==='BBB|QB'&&m.market==='passYards'));
 assert.ok(out.markets.every(m=>m.id.includes('|')&&m.scenarioRate>=0&&m.scenarioRate<=1));
});
