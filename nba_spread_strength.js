/* Shared opponent-adjusted spread research. Continuous margins, not legal score outcomes. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.CookNBASpreadStrength=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
function fit(history){
 const rows=history.map(g=>({h:g.home,a:g.away,y:g.h.pts-g.a.pts,
   venue:String(g.neutralSite)==='true'?0:1,w:1}));
 if(rows.length<40)throw Error('Insufficient historical team strength');
 const teams=[...new Set(rows.flatMap(r=>[r.h,r.a]))],rating=Object.fromEntries(teams.map(t=>[t,0]));
 let home=2;
 // Shrunk least squares on signed game margins, fitted jointly against opponents.
 for(let iter=0;iter<40;iter++){
  home=(rows.reduce((s,r)=>s+r.w*r.venue*(r.y-rating[r.h]+rating[r.a]),0)+12*2)/(rows.reduce((s,r)=>s+r.w*r.venue*r.venue,0)+12);
  for(const t of teams){
   const games=rows.filter(r=>r.h===t||r.a===t);
   rating[t]=games.reduce((s,r)=>s+r.w*(r.h===t?r.y-home*r.venue+rating[r.a]:-r.y+home*r.venue+rating[r.h]),0)/(games.reduce((s,r)=>s+r.w,0)+8);
  }
 }
 return {home,rating};
}

function prepare(game,feed,engine,now=Date.now()){
 const cutoff=now-86400000;
 const hist=engine.records(feed,cutoff),rating=fit(hist);
 if(!Number.isFinite(rating.rating[game.home])||!Number.isFinite(rating.rating[game.away]))throw Error('Team rating missing');
 return {version:'nba-possession-strength-prospective-v1',margin:rating.rating[game.home]-rating.rating[game.away]+(String(game.neutralSite)==='true'?0:rating.home),historyGames:hist.length,cutoff:new Date(cutoff).toISOString()};
}
function distribution(candidate,result){
 if(!candidate||!Number.isFinite(candidate.margin)||!result?.audit?.passed||!result.possession)return null;
 const bins=Object.entries(result.scoreBins?.margin||{}).map(([x,n])=>[Number(x),Number(n)]);
 if(!bins.length||bins.some(([x,n])=>!Number.isFinite(x)||!Number.isSafeInteger(n)||n<0))return null;
 const count=bins.reduce((s,[,n])=>s+n,0);
 if(count!==result.runCount)return null;
 const baseline=bins.reduce((s,[x,n])=>s+x*n,0)/count;
 return {...candidate,baseline,shift:candidate.margin-baseline,count,bins};
}
function cover(dist,homeSpread,home){
 if(!dist||!Number.isFinite(homeSpread)||Math.abs(homeSpread%1)!==.5)return null;
 let win=0,loss=0,push=0;
 for(const [x,n] of dist.bins){const v=x+dist.shift+homeSpread;if(v===0)push+=n;else if((v>0)===home)win+=n;else loss+=n;}
 return {win:win/dist.count,loss:loss/dist.count,push:push/dist.count};
}
return {fit,prepare,distribution,cover};
});
