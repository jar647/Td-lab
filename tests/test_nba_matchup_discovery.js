'use strict';const assert=require('node:assert/strict'),engine=require('../nba_matchup_discovery'),p=require('../nba_possession_engine');
const now=Date.parse('2026-11-04T18:00Z'),positions=['PG','SG','SF','PF','C'],teams=['A','B','C','D','E','F'],rosters={generated_at:new Date(now).toISOString(),teams:{},players:{}},injuries={generated_at:new Date(now).toISOString(),status:'ok',injuries:[]};
for(const t of teams){rosters.teams[t]=positions.map(pos=>t+pos);for(const pos of positions)rosters.players[t+pos]={team:t,name:t+' '+pos,position:pos};}
const player=(t,pos,i)=>({id:t+pos,name:t+' '+pos,team:t,position:pos,starter:true,stats:{MIN:'48',PTS:'20',FG:'10-20','3PT':'0-0',FT:'0-0',OREB:'2',DREB:String((t==='A'&&pos==='C'?18+i%3:8)-2),REB:String(t==='A'&&pos==='C'?18+i%3:8),AST:String(t==='A'&&pos==='PG'?9:3),TO:'2'}});
const games=[];for(let i=0;i<10;i++)for(let j=0;j<3;j++)games.push({id:'h'+i+'-'+j,date:new Date(now-(11-i)*86400000).toISOString(),status:'STATUS_FINAL',season_type:2,home:teams[j*2],away:teams[j*2+1],players:[...positions.map(pos=>player(teams[j*2],pos,i)),...positions.map(pos=>player(teams[j*2+1],pos,i))]});
const feed={generated_at:new Date(now).toISOString(),games},game={id:'next',home:'A',away:'B',date:new Date(now+6*3600000).toISOString(),status:'STATUS_SCHEDULED'};
const original=p.draws;p.draws=()=>{throw Error('No simulation may run in matchup discovery')};const r=engine.analyze(game,feed,rosters,injuries,now);p.draws=original;
const center=r.weaknesses.find(x=>x.attacking==='A'&&x.position==='C'&&x.market==='rebounds');assert(center);assert(center.allowed>center.leagueAverage);assert(engine.rate([4,5,6,7,8],5,5).games===5);assert(engine.thresholds([4,5,6,7,8],'rebounds').includes(5));assert(r.topThree.every(x=>engine.markets.includes(x.market)));
for(const side of ['over','under']){
 assert.equal(engine.minimumScore(side),85);
 for(const researchScore of [75,80,84,84.99,100.01,Infinity,NaN,undefined,null,'85'])assert.equal(engine.qualifies({side,researchScore}),false,side+' score '+researchScore+' must fail closed');
 for(const researchScore of [85,85.01,99,100])assert.equal(engine.qualifies({side,researchScore}),side==='over',side+' score '+researchScore+' must qualify');
}
assert.deepEqual(engine.markets,['points','rebounds','assists','threes','pr','pa','ra','pra']);
assert.equal(engine.recorded(player('A','C',0)).points,20);
assert.equal(engine.baseline([30,30,30,30,30,30,30,30,30,30],'pr'),30);
assert(engine.thresholds([30,31,32],'pra').includes(30.5)===false);
assert(r.weaknesses.some(x=>x.market==='pr')&&r.weaknesses.some(x=>x.market==='pra'),'combo opponent allowances must be computed');
assert(r.candidates.length>0,'The fixture must retain supported 85+ OVER recommendations');assert(r.candidates.every(x=>x.researchScore>=85));assert.equal(engine.rate([4,5,5,6,7],5,5).hits,4,'5+ means at least five');assert.equal(engine.rate([4,5,5],5,10).games,3,'Never invent ten observations');
assert.equal(engine.position('F'),null);assert.equal(engine.position('Power Forward'),'PF');assert.equal(engine.position('C-F'),null);
const unknown=structuredClone(rosters),unknownFeed=structuredClone(feed);delete unknown.players.AC;for(const h of unknownFeed.games)for(const x of h.players)if(x.id==='AC')x.position='F';assert(!engine.analyze(game,unknownFeed,unknown,injuries,now).candidates.some(x=>x.playerId==='AC'),'Do not invent a center assignment for broad forward data');
const out={...injuries,injuries:[{player_id:'AC',player:'A C',status:'OUT'}]};assert(!engine.analyze(game,feed,rosters,out,now).candidates.some(x=>x.playerId==='AC'));
assert.equal(engine.analyze(game,feed,rosters,{...injuries,generated_at:'2000-01-01'},now).candidates.length,0);assert.equal(engine.analyze({...game,date:new Date(now-1).toISOString()},feed,rosters,injuries,now).candidates.length,0);
const future=structuredClone(games[0]);future.id='future';future.date=new Date(now+86400000).toISOString();future.players[4].stats.REB='999';assert.deepEqual(engine.analyze(game,{...feed,games:[...games,future]},rosters,injuries,now),r,'Later games cannot change current matchup research');
console.log('NBA position matchups: sourced positions, opponent/peer comparisons, baselines, exact hit rates, no simulation, injuries and cutoff PASS');
// Low-production players facing strong position defenses have separate UNDER evidence.
const suppressed=structuredClone(feed);for(const g of suppressed.games)for(const x of g.players)if(x.id==='AC'){x.stats.REB='3';x.stats.DREB='1'}
const underAnalysis=engine.analyze(game,suppressed,rosters,injuries,now),under=underAnalysis.candidates.find(x=>x.playerId==='AC'&&x.market==='rebounds'&&x.side==='under');
assert(underAnalysis.weaknesses.some(x=>x.attacking==='A'&&x.position==='C'&&x.market==='rebounds'&&x.side==='under'));assert.equal(under,undefined,'Defensive suppression stays descriptive and cannot create a new UNDER recommendation');
assert.equal(engine.rate([4,5,6],5,3,'under').hits,1,'Under excludes an integer push');
assert(underAnalysis.candidates.every(engine.qualifies));
assert(!engine.qualifies({side:'under',researchScore:84.99}));assert(!engine.qualifies({side:'under',researchScore:85}));assert(!engine.qualifies({side:'over',researchScore:84.99}));
assert.deepEqual(engine.analyze(game,{...suppressed,odds:999,impliedProbability:.01},rosters,injuries,now).candidates,underAnalysis.candidates);
assert.equal(engine.analyze(game,suppressed,rosters,{...injuries,generated_at:'2000-01-01'},now).candidates.length,0);

// 3PM comes from observed makes, never an absent field or the attempt count.
for(const [stats,value] of [[{'3PT':'0-4'},0],[{'3PT':'5-8'},5],[{'3PM':'3'},3],[{'3PTM':2},2],[{},null],[{'3PT':''},null],[{'3PT':'6-5'},null],[{'3PT':'2-5','3PM':3},null],[{'3PM':null},null]])assert.equal(engine.madeThrees(stats),value);
const withoutThree=player('A','C',0);delete withoutThree.stats['3PT'];assert.equal(engine.recorded(withoutThree).threes,null);assert.equal(engine.recorded(withoutThree).points,20);
const shooting=structuredClone(feed);for(const g of shooting.games)for(const x of g.players){const made=x.id==='ASG'?5:1;x.stats['3PT']=made+'-8';x.stats.PTS=String(20+made)}
const shootingAnalysis=engine.analyze(game,shooting,rosters,injuries,now),shooter=shootingAnalysis.candidates.find(x=>x.playerId==='ASG'&&x.market==='threes');
assert(shooter,'Observed shooting role and opponent position weakness should support a qualifying three-point OVER');assert(shooter.researchScore>=85);assert.equal(shooter.history.length,10);assert(shooter.history.every(x=>x===5));assert.equal(shooter.weakness.games,10);assert.equal(shooter.baseline,5);
const sourceRecords=p.records;p.records=(f,cutoff)=>sourceRecords(f,cutoff).map(g=>({...g,players:g.players.map(x=>{const stats={...x.stats};delete stats['3PT'];return {...x,stats}})}));
try{const missing=engine.analyze(game,shooting,rosters,injuries,now);assert(!missing.candidates.some(x=>x.market==='threes'));assert(missing.candidates.some(x=>x.market==='rebounds'),'Missing 3PM must not erase other observed markets');assert(!missing.weaknesses.some(x=>x.market==='threes'));}finally{p.records=sourceRecords}
console.log('NBA OVER-only and 85+ three-point boundary / known versus missing 3PM samples PASS');
