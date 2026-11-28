/* Use the existing game-first engine off the UI thread. No separate simulation. */
'use strict';
importScripts('./nba_game_context.js?v=nba-sim-availability-1',
 './nba_possession_engine.js?v=nba-prop-workload-1',
 './nba_prop_evidence.js?v=nba80-def-under-20261121',
 './nba_prop_lines.js?v=nba80-def-under-20261121',
 './nba_matchup_discovery.js?v=nba-score-band-audit-20261123',
 './nba_game_first.js?v=nba-qualified-view-v1');
self.onmessage=function(event){
 const {requestId,feed,rosters,injuries,context,games,now}=event.data||{};
 try{
  if(!Array.isArray(games)||!Array.isArray(feed?.games)||!Number.isFinite(now))throw Error('Invalid NBA source inputs. Refresh and retry.');
  const candidates=[],held=[],diagnostics={gamesAnalyzed:0,modelRows:0,eligibleRows:0,ratedRows:0,qualifiedRows:0,modelUnavailableGames:0};
  const stages={simulated:{},eligible:{},rated:{}};
  const bands={};
  const recordBands=source=>{for(const [market,counts] of Object.entries(source||{})){if(!bands[market])bands[market]={under60:0,from60to69:0,from70to79:0,atLeast80:0};for(const key of Object.keys(bands[market]))bands[market][key]+=counts[key]||0;}};
  const increment=(stage,market)=>{const key=CookNBAPropLines.canonical(market)||String(market||'unknown').toLowerCase();stages[stage][key]=(stages[stage][key]||0)+1;};
  games.forEach((game,index)=>{
   if(game.status!=='STATUS_SCHEDULED'||Date.parse(game.date)<=now)return;
   const result=CookNBAGameFirst.analyze(game,feed,injuries,rosters,context,now,{count:1000});
   diagnostics.gamesAnalyzed++;
   const sourceRows=result.rows||[];
   recordBands(result.scoreBands);
   diagnostics.modelRows+=sourceRows.length;
   for(const row of sourceRows){
    increment('simulated',row.market);
    if(!['over','under'].includes(row.side)||row.eligible!==true||row.reviewRequired)continue;
    increment('eligible',row.market);
    if(Number.isFinite(row.matchupRating?.score)&&row.matchupRating.score>=CookNBAGameFirst.minimumScore(row.market,row.side))increment('rated',row.market);
   }
   diagnostics.eligibleRows+=sourceRows.filter(r=>['over','under'].includes(r.side)&&r.eligible===true&&!r.reviewRequired).length;
   diagnostics.ratedRows+=sourceRows.filter(r=>['over','under'].includes(r.side)&&Number.isFinite(r.matchupRating?.score)&&r.matchupRating.score>=CookNBAGameFirst.minimumScore(r.market,r.side)).length;
   if(result.reason&&!sourceRows.length)diagnostics.modelUnavailableGames++;
   const rows=sourceRows.map(row=>CookNBAGameFirst.candidate(row)).filter(Boolean);
   diagnostics.qualifiedRows+=rows.length;
   candidates.push(...rows);
   if(!rows.length)held.push({gameId:String(game.id),reason:result.reason||'No supported OVER or UNDER matchup meets 80/100.'});
   self.postMessage({type:'progress',requestId,completed:index+1,total:games.length});
  });
  diagnostics.marketStages=stages;
  diagnostics.scoreBands=bands;
  self.postMessage({type:'result',requestId,candidates,held,diagnostics});
 }catch(error){self.postMessage({type:'error',requestId,error:error.message||'NBA analysis unavailable.'});}
};
