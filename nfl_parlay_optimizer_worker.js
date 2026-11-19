/* Search existing aligned game outcomes off the page thread. No new model. */
'use strict';
importScripts('./market_odds.js','./nfl_goal1.js?v=nfl-prop-score60-v1','./nfl_book_review.js?v=nfl-book-review-v1','./nfl_parlay.js?v=nfl-offered-lines-v1','./nfl_parlay_optimizer.js?v=nfl-offered-lines-v1');
self.onmessage=function(event){
 const {requestId,candidates,offers,simulations,options}=event.data||{};
 try{const result=PropShopNFLParlayOptimizer.optimize(candidates,offers,new Map(simulations),options);self.postMessage({requestId,result})}
 catch(error){self.postMessage({requestId,error:error.message||'Offered-line comparison failed'})}
};
