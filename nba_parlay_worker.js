/* Use the existing game-first engine off the UI thread. No separate simulation. */
'use strict';
importScripts('./nba_game_context.js?v=nba-sim-availability-1',
 './nba_possession_engine.js?v=nba-over-threes85-v1',
 './nba_prop_evidence.js?v=nba-prop-select-v2',
 './nba_prop_lines.js?v=nba75-threes85-v1',
 './nba_matchup_discovery.js?v=nba75-threes85-v1',
 './nba_game_first.js?v=nba75-threes85-v1');
self.onmessage=function(event){
 const {requestId,feed,rosters,injuries,context,games,now}=event.data||{};
 try{
  if(!Array.isArray(games)||!Array.isArray(feed?.games)||!Number.isFinite(now))throw Error('Invalid NBA source inputs. Refresh and retry.');
  const candidates=[],held=[];
  games.forEach((game,index)=>{
   if(game.status!=='STATUS_SCHEDULED'||Date.parse(game.date)<=now)return;
   const result=CookNBAGameFirst.analyze(game,feed,injuries,rosters,context,now,{count:1000});
   const rows=(result.rows||[]).map(row=>CookNBAGameFirst.candidate(row)).filter(Boolean);
   candidates.push(...rows);
   if(!rows.length)held.push({gameId:String(game.id),reason:result.reason||'No supported OVER matchup meets 75/100 (three-pointers require 85/100).'});
   self.postMessage({type:'progress',requestId,completed:index+1,total:games.length});
  });
  self.postMessage({type:'result',requestId,candidates,held});
 }catch(error){self.postMessage({type:'error',requestId,error:error.message||'NBA analysis unavailable.'});}
};
