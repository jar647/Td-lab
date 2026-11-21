/* Use the existing game-first engine off the UI thread. No separate simulation. */
'use strict';
importScripts('./nba_game_context.js?v=nba-sim-availability-1',
 './nba_possession_engine.js?v=nba-over-threes85-v1',
 './nba_prop_evidence.js?v=nba-prop-select-v2',
 './nba_prop_lines.js?v=nba75-threes85-v1',
 './nba_matchup_discovery.js?v=nba75-threes85-v1',
 './nba_game_first.js?v=nba-best-props-gate-20261120-v2');
self.onmessage=function(event){
 const {requestId,feed,rosters,injuries,context,games,now}=event.data||{};
 try{
  if(!Array.isArray(games)||!Array.isArray(feed?.games)||!Number.isFinite(now))throw Error('Invalid NBA source inputs. Refresh and retry.');
  const candidates=[],held=[],diagnostics={gamesAnalyzed:0,modelRows:0,eligibleRows:0,ratedRows:0,qualifiedRows:0,modelUnavailableGames:0};
  games.forEach((game,index)=>{
   if(game.status!=='STATUS_SCHEDULED'||Date.parse(game.date)<=now)return;
   const result=CookNBAGameFirst.analyze(game,feed,injuries,rosters,context,now,{count:1000});
   diagnostics.gamesAnalyzed++;
   const sourceRows=result.rows||[];
   diagnostics.modelRows+=sourceRows.length;
   diagnostics.eligibleRows+=sourceRows.filter(r=>['over','under'].includes(r.side)&&r.eligible===true&&!r.reviewRequired).length;
   diagnostics.ratedRows+=sourceRows.filter(r=>['over','under'].includes(r.side)&&Number.isFinite(r.matchupRating?.score)&&r.matchupRating.score>=CookNBAGameFirst.minimumScore(r.market,r.side)).length;
   if(result.reason&&!sourceRows.length)diagnostics.modelUnavailableGames++;
   const rows=sourceRows.map(row=>CookNBAGameFirst.candidate(row)).filter(Boolean);
   diagnostics.qualifiedRows+=rows.length;
   candidates.push(...rows);
   if(!rows.length)held.push({gameId:String(game.id),reason:result.reason||'No supported OVER or UNDER matchup meets 80/100.'});
   self.postMessage({type:'progress',requestId,completed:index+1,total:games.length});
  });
  self.postMessage({type:'result',requestId,candidates,held,diagnostics});
 }catch(error){self.postMessage({type:'error',requestId,error:error.message||'NBA analysis unavailable.'});}
};
