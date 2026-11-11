'use strict';const assert=require('node:assert/strict'),engine=require('../nba_matchup_discovery'),p=require('../nba_possession_engine');
const now=Date.parse('2026-11-04T18:00Z'),positions=['PG','SG','SF','PF','C'],teams=['A','B','C','D','E','F'],rosters={generated_at:new Date(now).toISOString(),teams:{},players:{}},injuries={generated_at:new Date(now).toISOString(),status:'ok',injuries:[]};
for(const t of teams){rosters.teams[t]=positions.map(pos=>t+pos);for(const pos of positions)rosters.players[t+pos]={team:t,name:t+' '+pos,position:pos};}
const player=(t,pos,i)=>({id:t+pos,name:t+' '+pos,team:t,position:pos,starter:true,stats:{MIN:'48',PTS:'20',FG:'10-20','3PT':'0-0',FT:'0-0',OREB:'2',DREB:String((t==='A'&&pos==='C'?18+i%3:8)-2),REB:String(t==='A'&&pos==='C'?18+i%3:8),AST:String(t==='A'&&pos==='PG'?9:3),TO:'2'}});
const games=[];for(let i=0;i<10;i++)for(let j=0;j<3;j++)games.push({id:'h'+i+'-'+j,date:new Date(now-(11-i)*86400000).toISOString(),status:'STATUS_FINAL',season_type:2,home:teams[j*2],away:teams[j*2+1],players:[...positions.map(pos=>player(teams[j*2],pos,i)),...positions.map(pos=>player(teams[j*2+1],pos,i))]});
const feed={generated_at:new Date(now).toISOString(),games},game={id:'next',home:'A',away:'B',date:new Date(now+6*3600000).toISOString(),status:'STATUS_SCHEDULED'};
const original=p.draws;p.draws=()=>{throw Error('No simulation may run in matchup discovery')};const r=engine.analyze(game,feed,rosters,injuries,now);p.draws=original;
const center=r.weaknesses.find(x=>x.attacking==='A'&&x.position==='C'&&x.market==='rebounds');assert(center);assert(center.allowed>center.leagueAverage);assert(engine.rate([4,5,6,7,8],5,5).games===5);assert(engine.thresholds([4,5,6,7,8],'rebounds').includes(5));assert(r.topThree.every(x=>engine.markets.includes(x.market)));
assert.equal(engine.minimumScore('over'),80);assert.equal(engine.minimumScore('under'),80);
assert.equal(engine.qualifies({side:'over',researchScore:79}),false);assert.equal(engine.qualifies({side:'under',researchScore:79}),false);
assert.equal(engine.qualifies({side:'over',researchScore:80}),true);assert.equal(engine.qualifies({side:'under',researchScore:80}),true);
assert.deepEqual(engine.markets,['points','rebounds','assists','pr','pa','ra','pra']);
assert.equal(engine.recorded(player('A','C',0)).points,20);
assert.equal(engine.baseline([30,30,30,30,30,30,30,30,30,30],'pr'),30);
assert(engine.thresholds([30,31,32],'pra').includes(30.5)===false);
assert(r.weaknesses.some(x=>x.market==='pr')&&r.weaknesses.some(x=>x.market==='pra'),'combo opponent allowances must be computed');
assert(r.candidates.every(x=>x.researchScore>=80));assert.equal(engine.rate([4,5,5,6,7],5,5).hits,4,'5+ means at least five');assert.equal(engine.rate([4,5,5],5,10).games,3,'Never invent ten observations');
assert.equal(engine.position('F'),null);assert.equal(engine.position('Power Forward'),'PF');assert.equal(engine.position('C-F'),null);
const unknown=structuredClone(rosters),unknownFeed=structuredClone(feed);delete unknown.players.AC;for(const h of unknownFeed.games)for(const x of h.players)if(x.id==='AC')x.position='F';assert(!engine.analyze(game,unknownFeed,unknown,injuries,now).candidates.some(x=>x.playerId==='AC'),'Do not invent a center assignment for broad forward data');
const out={...injuries,injuries:[{player_id:'AC',player:'A C',status:'OUT'}]};assert(!engine.analyze(game,feed,rosters,out,now).candidates.some(x=>x.playerId==='AC'));
assert.equal(engine.analyze(game,feed,rosters,{...injuries,generated_at:'2000-01-01'},now).candidates.length,0);assert.equal(engine.analyze({...game,date:new Date(now-1).toISOString()},feed,rosters,injuries,now).candidates.length,0);
const future=structuredClone(games[0]);future.id='future';future.date=new Date(now+86400000).toISOString();future.players[4].stats.REB='999';assert.deepEqual(engine.analyze(game,{...feed,games:[...games,future]},rosters,injuries,now),r,'Later games cannot change current matchup research');
console.log('NBA position matchups: sourced positions, opponent/peer comparisons, baselines, exact hit rates, no simulation, injuries and cutoff PASS');
// Low-production players facing strong position defenses have separate UNDER evidence.
const suppressed=structuredClone(feed);for(const g of suppressed.games)for(const x of g.players)if(x.id==='AC'){x.stats.REB='3';x.stats.DREB='1'}
const underAnalysis=engine.analyze(game,suppressed,rosters,injuries,now),under=underAnalysis.candidates.find(x=>x.playerId==='AC'&&x.market==='rebounds'&&x.side==='under');
assert(underAnalysis.weaknesses.some(x=>x.attacking==='A'&&x.position==='C'&&x.market==='rebounds'&&x.side==='under'));if(under){assert(under.researchScore>=80);assert(under.weakness.allowed<under.weakness.leagueAverage);assert(under.baseline>3);}
assert.equal(engine.rate([4,5,6],5,3,'under').hits,1,'Under excludes an integer push');
assert(underAnalysis.candidates.every(engine.qualifies));
assert(!engine.qualifies({side:'under',researchScore:79}));assert(engine.qualifies({side:'under',researchScore:80}));assert(!engine.qualifies({side:'over',researchScore:79}));
assert.deepEqual(engine.analyze(game,{...suppressed,odds:999,impliedProbability:.01},rosters,injuries,now).candidates,underAnalysis.candidates);
assert.equal(engine.analyze(game,suppressed,rosters,{...injuries,generated_at:'2000-01-01'},now).candidates.length,0);
