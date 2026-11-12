/* Game-only simulator runs 100k independent draws off the UI thread. */
importScripts('./nba_game_context.js?v=nba-sim-availability-1','./nba_possession_engine.js?v=nba-simulator-reliability-v4','./game_odds_engine.js?v=nba-simulator-reliability-v4');
self.onmessage=function(event){
 const data=event.data||{};
 try{
  const result=self.CookGameOdds.simulate(data.game,data.market||{},data.count||100000,data.seed||6472026,{onProgress:(completed,total)=>self.postMessage({requestId:data.requestId,progress:{completed,total}})});
  self.postMessage({requestId:data.requestId,result});
 }catch(error){
  self.postMessage({requestId:data.requestId,error:String(error&&error.message||error)});
 }
};



