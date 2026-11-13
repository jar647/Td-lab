/* Worker keeps 10k–100k correlated game simulations off the page thread. */
importScripts('./nfl_game_engine.js?v=nfl-depth-chart-qb-v4');
self.onmessage=function(event){
 const {players,count,seed,selected,requestId,options}=event.data||{};
 try{
  const result=self.PropVaultGameEngine.simulate(players,count,seed,selected,options);
  self.postMessage({requestId,result});
 }catch(err){
  self.postMessage({requestId,error:String(err&&err.message||err)});
 }
};
