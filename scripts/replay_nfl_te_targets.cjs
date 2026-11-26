'use strict';
// Earlier-week diagnostic of the target-bump rule. Archived role and injury
// snapshots are unavailable in the bundled feed, so this measures signal only.
const engine=require('../nfl_game_engine');
const mean=values=>values.reduce((a,b)=>a+b,0)/values.length;
function replay(records){
 const players=[...new Map(records.filter(p=>p.market==='ATD'&&p.pos==='TE'&&p.playerAppearancesVerified&&p.seasonGameStats?.length)
  .map(p=>[p.team+'|'+p.player_id,p])).values()];
 const games=new Map();
 for(const p of players)for(const row of p.seasonGameStats){
  const [, ,away,home]=(row.gameId||'').split('_');
  if(![away,home].includes(p.team)||!Number.isInteger(row.week)||!Number.isFinite(row.targets))continue;
  const opponent=p.team===home?away:home,key=opponent+'|'+row.gameId;
  if(!games.has(key))games.set(key,{week:row.week,opponent,targets:0});
  games.get(key).targets+=row.targets;
 }
 const evaluated=[];
 for(const p of players)for(const actual of p.seasonGameStats){
  const [, ,away,home]=(actual.gameId||'').split('_');
  if(![away,home].includes(p.team)||!Number.isFinite(actual.targets))continue;
  const opponent=p.team===home?away:home,allowances=new Map();
  for(const game of games.values())if(game.week<actual.week){
   if(!allowances.has(game.opponent))allowances.set(game.opponent,[]);
   allowances.get(game.opponent).push(game.targets);
  }
  const baseline=engine.tightEndTargetBaseline([...allowances].filter(([,values])=>values.length>=5)
   .map(([opp,values])=>({market:'ATD',pos:'TE',opp,defTargetsAllowed:mean(values)})));
  const defense=allowances.get(opponent);
  if(!defense||defense.length<5)continue;
  const history=p.seasonGameStats.filter(row=>row.week<actual.week).sort((a,b)=>a.week-b.week);
  const signal=engine.quietTightEndTargets(history,mean(defense),baseline);
  if(!signal)continue;
  const expected=.65*mean(history.map(r=>r.targets))+.35*mean(history.slice(-5).map(r=>r.targets));
  evaluated.push({week:actual.week,game:actual.gameId,actual:actual.targets,baseline:expected,scenario:expected+signal.addedWeight});
 }
 const weeks=[...new Set(evaluated.map(x=>x.week))].sort((a,b)=>a-b);
 const cutoff=weeks[Math.floor(weeks.length*2/3)];
 const summarize=rows=>({players:rows.length,games:new Set(rows.map(x=>x.game)).size,
  baselineMAE:rows.length?mean(rows.map(x=>Math.abs(x.actual-x.baseline))):null,
  scenarioMAE:rows.length?mean(rows.map(x=>Math.abs(x.actual-x.scenario))):null});
 return {cutoff,development:summarize(evaluated.filter(x=>x.week<cutoff)),holdout:summarize(evaluated.filter(x=>x.week>=cutoff)),
  scope:'Uses earlier weeks in the current-roster feed, so positional totals may omit players no longer in the feed. No historical depth chart, injury or snap-share gate. Evaluates target forecasts only.'};
}
if(require.main===module)console.log(JSON.stringify(replay(require('../data/matchups.json')),null,2));
module.exports={replay};
