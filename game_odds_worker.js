/* Game-only simulator runs 100k independent draws off the UI thread. */
importScripts('./nba_possession_engine.js','./game_odds_engine.js');
self.onmessage=function(event){
 const data=event.data||{};
 try{
  const result=self.CookGameOdds.simulate(data.game,data.market||{},data.count||100000,data.seed||6472026);
  self.postMessage({requestId:data.requestId,result});
 }catch(error){
  self.postMessage({requestId:data.requestId,error:String(error&&error.message||error)});
 }
};
