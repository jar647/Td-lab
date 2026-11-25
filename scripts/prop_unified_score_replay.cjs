'use strict';
const assert=require('node:assert/strict');
const engine=require('../nba_possession_engine');
const discovery=require('../nba_matchup_discovery');
const nfl=require('../nfl_goal1');
const proposed=require('../prop_matchup_score');
const mean=values=>values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;
const DAY=86400000;

function summarize(fixtures,threshold){
 const dates=[...new Set(fixtures.map(x=>x.date))].sort();
 const cutoff=dates[Math.floor(dates.length*2/3)];
 const split=rows=>{
  const metrics=key=>{
   const ranked=rows.filter(r=>r[key]>=threshold);
   return {selected:ranked.length,clearRate:mean(ranked.map(x=>x.hit)),meanScore:mean(rows.map(x=>x[key]))};
  };
  const current=metrics('current'),proposed=metrics('proposed');
  const matched=[...rows].sort((a,b)=>b.proposed-a.proposed).slice(0,current.selected);
  return {rows:rows.length,fixtures:new Set(rows.map(x=>x.fixture)).size,current,proposed,
   proposedAtCurrentVolume:{selected:matched.length,clearRate:mean(matched.map(x=>x.hit))}};
 };
 assert.ok(dates.length>=4,'At least four chronological fixture dates are required');
 return {threshold,cutoff,development:split(fixtures.filter(x=>x.date<cutoff)),holdout:split(fixtures.filter(x=>x.date>=cutoff))};
}
function nbaReplay(feed,positions){
 const fields={points:['PTS'],rebounds:['OREB','DREB'],assists:['AST'],threes:['3PT'],steals:['STL'],blocks:['BLK'],stocks:['STL','BLK'],
  pr:['PTS','OREB','DREB'],pa:['PTS','AST'],ra:['OREB','DREB','AST'],pra:['PTS','OREB','DREB','AST']};
 const rows=[],skipped=[];
 const finals=engine.records(feed,Infinity);
 for(const actual of finals.slice(0,65).reverse()){
  const tip=Date.parse(actual.date),now=tip-2*3600000,stamp=new Date(now).toISOString();
  const earlier=finals.filter(g=>Date.parse(g.date)<tip-DAY);
  const teams={},seen=new Set();
  for(const game of earlier)for(const p of game.players){
   const id=String(p.id);
   if(seen.has(id)||p.didNotPlay||!p.team||!(parseFloat(p.stats?.MIN)>0))continue;
   seen.add(id);(teams[p.team]??=[]).push(id);
  }
  const game={...actual,status:'STATUS_SCHEDULED',players:[]};
  const replay={generated_at:stamp,games:earlier};
  const result=discovery.analyze(game,replay,{generated_at:stamp,teams,players:positions},{generated_at:stamp,injuries:[]},now);
  if(!result.ready){skipped.push(result.reason);continue;}
  // Candidate eligibility, line, and original matchup rating come from the same
  // earlier-only classifier. This comparison is conditional on its 80+ pool.
  for(const row of result.candidates){
   const p=actual.players.find(x=>String(x.id)===String(row.playerId)&&!x.didNotPlay);
   if(!p||!(parseFloat(p.stats?.MIN)>0))continue;
   const values=fields[row.market].map(k=>k==='3PT'?Number(p.stats?.[k]?.split('-')[0]):p.stats?.[k]==null||p.stats[k]===''?NaN:Number(p.stats[k]));
   const candidate=proposed.nba(row);
   if(!candidate||!values.every(Number.isFinite))continue;
   const value=values.reduce((sum,item)=>sum+item,0);
   if(value===row.recommendedOverLine)continue;
   rows.push({date:actual.date.slice(0,10),fixture:actual.id,current:row.researchScore,proposed:candidate.score,
    hit:Number(row.side==='under'?value<row.recommendedOverLine:value>row.recommendedOverLine)});
  }
 }
 return {...summarize(rows,80),skipped:skipped.length,
  scope:'Conditional on the existing 80+ candidate pool. Prior observed active rosters were reconstructed. Static position labels come from the roster metadata. Historical injury reports are unavailable.'};
}
function nflReplay(records){
 const specs={PASS:['passYards','passAttempts'],RUSH:['rushYards','rushAttempts'],REC:['recYards','targets'],CATCH:['receptions','targets']};
 const players=[...new Map(records.filter(p=>p.market==='ATD'&&p.playerAppearancesVerified===true&&p.seasonGameStats?.length).map(p=>[p.player_id,p])).values()];
 const rows=[];
 const weeks=[...new Set(players.flatMap(p=>p.seasonGameStats.map(g=>g.week)))].filter(Number.isInteger).sort((a,b)=>a-b);
 for(const week of weeks.slice(5))for(const [category,[stat,use]] of Object.entries(specs)){
  const cfg=nfl.SPECS[category],peers=new Map(),allowed=new Map();
  const prior=players.filter(p=>cfg.pos.includes(p.pos)).map(player=>({player,entries:player.seasonGameStats.filter(g=>g.week<week&&Number.isFinite(g[stat])&&Number.isFinite(g[use]))}));
  for(const {player,entries} of prior)for(const e of entries.filter(e=>e[use]>0)){
   const [, ,away,home]=(e.gameId||'').split('_');if(player.team!==away&&player.team!==home)continue;
   const opponent=player.team===away?home:away;
   if(!peers.has(player.pos))peers.set(player.pos,[]);peers.get(player.pos).push(e);
   const key=player.pos+'|'+opponent;if(!allowed.has(key))allowed.set(key,[]);allowed.get(key).push(e);
  }
  for(const {player,entries} of prior){
   const played=entries.filter(e=>e[use]>0);if(played.length<5)continue;
   const actual=player.seasonGameStats.find(g=>g.week===week);
   if(!actual||!Number.isFinite(actual[stat]))continue;
   const [, ,away,home]=(actual.gameId||'').split('_');if(player.team!==away&&player.team!==home)continue;
   const defense=allowed.get(player.pos+'|'+(player.team===away?home:away)),peer=peers.get(player.pos);
   if(!defense||defense.length<8||!peer)continue;
   const avg=key=>mean(played.map(e=>e[key])),def=key=>mean(defense.map(e=>e[key]));
   const recentUsage={PASS:'recent3PassAttempts',RUSH:'recent3Carries',REC:'recent3Targets',CATCH:'recent3Targets'}[category];
   const current=nfl.matchupRating({[cfg.player]:avg(stat),[cfg.usage]:avg(use),[cfg.def]:def(stat),[cfg.volume]:def(use),[recentUsage]:mean(played.slice(-3).map(e=>e[use]))},category);
   const candidate=proposed.nfl({production:played.map(e=>e[stat]),opportunities:played.map(e=>e[use]),opponentAllowance:def(stat),peerProduction:mean(peer.map(e=>e[stat])),peerOpportunities:mean(peer.map(e=>e[use]))});
   if(!current||!candidate)continue;
   const line=Math.floor(avg(stat))+.5;
   rows.push({date:String(week).padStart(2,'0'),fixture:actual.gameId,current:current.score,proposed:candidate.score,hit:Number(actual[stat]>line)});
  }
 }
 return {...summarize(rows,nfl.MIN_SCORE),scope:'Earlier-week per-player position allowances reconstructed from current feed histories. Synthetic half-point lines use the earlier player average. Historical injury and snap snapshots are unavailable.'};
}
if(require.main===module)console.log(JSON.stringify({nba:nbaReplay(require('../data/nba_games.json'),require('../data/nba_rosters.json').players),nfl:nflReplay(require('../data/matchups.json'))},null,2));
module.exports={nbaReplay,nflReplay};
