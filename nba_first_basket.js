/* First FIELD GOAL research. Opening-event evidence only; no box-score PPG proxy. */
(function(root){
 'use strict';
 function analyze(game,history,starters,{injuryFresh=false,rosterFresh=false,now=Date.now()}={}){
  const tip=Date.parse(game.date),teams=[game.away,game.home];
  const output={available:false,rows:[],reason:'',definition:'First made field goal in the game; free throws do not count.',uncalibrated:true};
  if(game.status!=='STATUS_SCHEDULED'||!Number.isFinite(tip)||tip<=now){output.reason='Pregame first-basket rankings close at tipoff.';return output}
  const pools={},teamWeights={};
  for(const team of teams){
   if((starters[team]||[]).length!==5){output.reason='Five projected starters per team are required.';return output}
   const seen=new Set();
   pools[team]=history.filter(g=>{
    if(seen.has(String(g.id)))return false;seen.add(String(g.id));
    return g.status==='STATUS_FINAL'&&Number(g.season_type)===2&&Date.parse(g.date)<tip&&Date.parse(g.date)<now&&
     (g.home===team||g.away===team)&&g.first_basket?.available&&g.first_basket.first_by_team?.[team];
   }).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)).slice(0,20);
   const n=pools[team].length;
   if(n<3){output.reason=team+': only '+n+' verified opening sequences; need at least 3. No probability invented.';return output}
   const wins=pools[team].filter(g=>g.first_basket.first_game.team===team).length;
   teamWeights[team]=(wins+2)/(n+4);
  }
  const total=teams.reduce((s,t)=>s+teamWeights[t],0);
  for(const team of teams){
   const pool=pools[team],n=pool.length,teamProbability=teamWeights[team]/total;
   for(const p of starters[team]){
    if(/OUT|DOUBTFUL|SUSPENDED|INACTIVE/.test(String(p.injury?.status||'').toUpperCase()))continue;
    const firstTeam=pool.filter(g=>g.first_basket.first_by_team[team].player_id===String(p.id)).length;
    const firstGame=pool.filter(g=>g.first_basket.first_game.player_id===String(p.id)&&g.first_basket.first_game.team===team).length;
    output.rows.push({id:String(p.id),name:p.name,team,games:n,firstTeam,firstGame,
     probability:teamProbability*(firstTeam+1)/(n+6),status:p.injury?.status||'UNVERIFIED'});
   }
  }
  output.rows.sort((a,b)=>b.probability-a.probability||b.firstGame-a.firstGame||a.name.localeCompare(b.name));
  output.available=true;output.otherProbability=Math.max(0,1-output.rows.reduce((s,p)=>s+p.probability,0));
  output.reason='Projected starters, not confirmed. '+(!injuryFresh?'Injury feed missing/stale. ':'')+(!rosterFresh?'Roster feed missing/stale. ':'')+
   'Experimental estimate: shrunk team first-field-goal frequency × player share of team opening field goals. Recent regular-season sample, up to 20 verified games/team; one-count player smoothing and an other-player reserve. No betting edge or validated probability.';
  return output;
 }
 const api={analyze};root.CookNBAFirstBasket=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
