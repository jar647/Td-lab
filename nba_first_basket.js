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
 const fresh=(stamp,now,hours)=>{const t=Date.parse(stamp);return Number.isFinite(t)&&t<=now+300000&&now-t<=hours*3600000};
 const day=stamp=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stamp));
 function projectedStarters(game,history,rosters,injuries){
  const result={},statuses=new Set(['NOT LISTED','ACTIVE','AVAILABLE','PROBABLE']);
  for(const team of [game.away,game.home]){
   const members=new Set((rosters.teams?.[team]||[]).map(String)),players=new Map();
   for(const g of history)for(const p of g.players||[]){
    const id=String(p.id??'');if(p.team!==team||!members.has(id)||p.didNotPlay)continue;
    const raw=p.stats?.MIN,parts=String(raw??'').split(':'),min=raw===null||raw===undefined||raw===''?NaN:parts.length===2?Number(parts[0])+Number(parts[1])/60:Number(raw);
    if(!Number.isFinite(min)||min<=0)continue;
    if(!players.has(id))players.set(id,{id,name:rosters.players?.[id]?.name||p.name,team,position:rosters.players?.[id]?.position||p.position,rows:[]});
    if(players.get(id).rows.length<5)players.get(id).rows.push({minutes:min,starter:p.starter===true});
   }
   result[team]=[...players.values()].map(p=>{
    const injury=(injuries.injuries||[]).find(x=>String(x.player_id??x.id??'')===p.id||String(x.player||x.name||'').trim().toLowerCase()===String(p.name).trim().toLowerCase());
    const status=String(injury?.status||'NOT LISTED').toUpperCase(),mins=p.rows.reduce((s,r)=>s+r.minutes,0)/p.rows.length;
    const starts=p.rows.filter(r=>r.starter).length,recentStarts=p.rows.slice(0,3).filter(r=>r.starter).length;
    return {...p,injury:{status},mins,rank:recentStarts*8+starts*4+mins*.4};
   }).filter(p=>typeof p.name==='string'&&p.name.trim()&&p.rows.length>=3&&p.mins>=15&&statuses.has(p.injury.status))
    .sort((a,b)=>b.rank-a.rank||a.id.localeCompare(b.id)).slice(0,5);
  }
  return result;
 }
 function slate(feed,rosters,injuries,now=Date.now()){
  const output={picks:[],skipped:[],upcomingGames:0,analyzedGames:0,reason:null,definition:'First made field goal in the game; free throws do not count.'};
  if(!fresh(feed?.generated_at,now,12)||!fresh(rosters?.generated_at,now,72)||!fresh(injuries?.generated_at,now,12)||!Array.isArray(injuries?.injuries)||(injuries.status&&injuries.status!=='ok')){
   output.reason='PASS · Fresh game, roster and injury feeds are required.';return output;
  }
  const seen=new Set(),all=(feed.games||[]).filter(g=>{const id=String(g.id??'');if(!id||seen.has(id))return false;seen.add(id);return true});
  const today=day(now),upcoming=all.filter(g=>g.status==='STATUS_SCHEDULED'&&Date.parse(g.date)>now&&day(g.date)===today);
  output.upcomingGames=upcoming.length;const ranked=[];
  for(const game of upcoming){
   const tip=Date.parse(game.date);
   if(tip-now<=90*60000&&!fresh(injuries.generated_at,now,.25)){output.skipped.push({game,reason:'Fresh injury check required within 90 minutes of tipoff.'});continue;}
   const date=new Date(tip),seasonStart=Date.UTC(date.getUTCFullYear()-(date.getUTCMonth()<9?1:0),9,1);
   const history=all.filter(g=>g.status==='STATUS_FINAL'&&Number(g.season_type)===2&&Date.parse(g.date)>=seasonStart&&Date.parse(g.date)<Math.min(tip,now)).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
   const starters=projectedStarters(game,history,rosters,injuries);
   const verified=history.filter(g=>{const first=g.first_basket;return first?.available&&[g.home,g.away].includes(first.first_game?.team)&&first.first_game?.player_id&&[g.home,g.away].every(t=>first.first_by_team?.[t]?.player_id);});
   const result=analyze(game,verified,starters,{injuryFresh:true,rosterFresh:true,now});
   if(!result.available){output.skipped.push({game,reason:result.reason});continue;}
   output.analyzedGames++;
   for(const row of result.rows){const player=starters[row.team].find(p=>p.id===row.id);ranked.push({...row,position:player?.position,game,key:[game.id,row.id,'first-basket'].join('|')});}
  }
  ranked.sort((a,b)=>b.probability-a.probability||b.firstGame-a.firstGame||a.key.localeCompare(b.key));
  const players=new Set();output.picks=ranked.filter(p=>!players.has(p.id)&&players.add(p.id)).slice(0,5);
  if(!output.picks.length)output.reason=upcoming.length?'PASS · No supported first-basket candidates. See game coverage below.':'No upcoming NBA games today (Eastern Time).';
  return output;
 }
 const api={analyze,projectedStarters,slate};root.CookNBAFirstBasket=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
