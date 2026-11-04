/* Matchup discovery from recorded box scores. No simulated forecasts or prices. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./nba_possession_engine'):root.CookNBAPossessions);if(typeof module==='object'&&module.exports)module.exports=api;root.CookNBAMatchups=api;})(typeof globalThis!=='undefined'?globalThis:this,function(boxes){
'use strict';
const positions=['PG','SG','SF','PF','C'],markets=['points','rebounds','assists'],labels={points:'points',rebounds:'rebounds',assists:'assists'};
const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null,norm=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]/g,'');
function position(raw){const x=typeof raw==='object'?raw?.abbreviation||raw?.displayName||raw?.name:raw;return {POINTGUARD:'PG',SHOOTINGGUARD:'SG',SMALLFORWARD:'SF',POWERFORWARD:'PF',CENTER:'C',PG:'PG',SG:'SG',SF:'SF',PF:'PF',C:'C'}[String(x||'').toUpperCase().replace(/[^A-Z]/g,'')]||null;}
function minutes(raw){if(raw===null||raw===undefined||raw==='')return null;if(String(raw).includes(':')){const [m,s]=String(raw).split(':').map(Number);return Number.isFinite(m)&&Number.isFinite(s)?m+s/60:null}const n=Number(raw);return Number.isFinite(n)?n:null;}
function recorded(p){const min=minutes(p.stats?.MIN);if(p.didNotPlay||!(min>0))return null;const values={minutes:min,points:Number(p.stats?.PTS),rebounds:Number(p.stats?.REB),assists:Number(p.stats?.AST)};return markets.every(k=>p.stats?.[{points:'PTS',rebounds:'REB',assists:'AST'}[k]]!==undefined&&Number.isFinite(values[k])&&values[k]>=0)?values:null;}
function rate(history,threshold,n){const rows=history.slice(0,n),hits=rows.filter(v=>v>=threshold).length;return {hits,games:rows.length,rate:rows.length?hits/rows.length:null};}
function thresholds(history,market){const max=Math.max(...history,1),limit=Math.min({points:70,rebounds:35,assists:25}[market],Math.ceil(max)+3);return Array.from({length:limit},(_,i)=>i+1);}
function baseline(history,market){const steps={points:[5,10,15,20,25,30,35,40,45,50],rebounds:[2,4,6,8,10,12,15,18,20],assists:[2,3,4,5,6,7,8,10,12,15]}[market];return steps.filter(t=>rate(history,t,5).rate>=.8&&rate(history,t,10).rate>=.7).at(-1)||null;}
function analyze(game,feed,rosters,injuries,now=Date.now()){
 const cutoff=Math.min(Date.parse(game.date),now),year=new Date(game.date).getUTCFullYear()-(new Date(game.date).getUTCMonth()<9),seasonStart=Date.UTC(year,9,1);
 const recent=boxes.records(feed,cutoff).filter(g=>Date.parse(g.date)>=seasonStart),members=rosters?.teams||{},metadata=rosters?.players||{};
 const pos=p=>position(p.position)||position(metadata[String(p.id)]?.position);
 const profiles=new Map(),defense=new Map(),coverage={games:0,omittedTeamGames:0};
 for(const g of recent){
  for(const team of [g.home,g.away]){
   const opponents=(g.players||[]).filter(p=>p.team!==team&&!p.didNotPlay),observed=opponents.map(p=>({p,stats:recorded(p),position:pos(p)})).filter(x=>x.stats),totalMinutes=observed.reduce((s,x)=>s+x.stats.minutes,0),known=observed.filter(x=>x.position).reduce((s,x)=>s+x.stats.minutes,0);
   const bucket=defense.get(team)||[];
   if(totalMinutes>0&&known/totalMinutes>=.98&&bucket.length<10){const byPosition=Object.fromEntries(positions.map(p=>[p,{points:0,rebounds:0,assists:0}]));for(const x of observed)if(x.position)for(const k of markets)byPosition[x.position][k]+=x.stats[k];bucket.push({game:g.id,values:byPosition});defense.set(team,bucket);coverage.games++;}else if(bucket.length<10)coverage.omittedTeamGames++;
  }
  for(const p of g.players||[]){const stats=recorded(p),position=pos(p);if(!stats||!position||!Array.isArray(members[p.team])||!members[p.team].map(String).includes(String(p.id)))continue;
   const id=String(p.id);if(!profiles.has(id))profiles.set(id,{id,name:p.name,team:p.team,position,rows:[]});const row=profiles.get(id);if(row.team!==p.team||row.rows.length>=10)continue;row.rows.push(stats);
  }
 }
 const peerProfiles=[...profiles.values()].filter(p=>p.rows.length>=5&&avg(p.rows.slice(0,5).map(r=>r.minutes))>=20);
 const league=Object.fromEntries(positions.map(p=>[p,Object.fromEntries(markets.map(k=>[k,avg([...defense.values()].flat().map(r=>r.values[p][k]))]))]));
 const weaknesses=[],candidates=[];
 const injuryAt=Date.parse(injuries?.generated_at),rosterAt=Date.parse(rosters?.generated_at),feedAt=Date.parse(feed?.generated_at),pregame=game.status==='STATUS_SCHEDULED'&&Date.parse(game.date)>now;
 const fresh=(stamp,h)=>Number.isFinite(stamp)&&stamp<=now+300000&&now-stamp<=h*3600000;
 const inputsFresh=fresh(feedAt,12)&&fresh(rosterAt,72)&&fresh(injuryAt,Date.parse(game.date)-now<=90*60000?.25:12)&&Array.isArray(injuries?.injuries)&&(!injuries.status||injuries.status==='ok');
 for(const attacking of [game.away,game.home]){
  const opponent=attacking===game.home?game.away:game.home,sample=defense.get(opponent)||[];if(sample.length<5||coverage.games<30)continue;
  for(const position of positions)for(const market of markets){const allowed=avg(sample.map(r=>r.values[position][market])),reference=league[position][market];if(!(reference>0&&allowed>reference))continue;
   const weakness={team:opponent,attacking,position,market,allowed,leagueAverage:reference,games:sample.length,excess:allowed/reference-1};weaknesses.push(weakness);
   const peers=peerProfiles.filter(p=>p.position===position),peerAverage=avg(peers.map(p=>avg(p.rows.slice(0,5).map(r=>r[market]))));
   if(peers.length<3||!(peerAverage>0))continue;
   for(const player of peerProfiles.filter(p=>p.team===attacking&&p.position===position)){
    const history=player.rows.map(r=>r[market]),playerAverage=avg(history.slice(0,5)),recentMinutes=avg(player.rows.slice(0,5).map(r=>r.minutes));if(!(playerAverage>peerAverage)||player.rows[0].minutes<15)continue;
    const injury=(injuries?.injuries||[]).find(p=>String(p.player_id||p.id||'')===player.id||norm(p.player||p.name)===norm(player.name)),status=String(injury?.status||'NOT LISTED').toUpperCase();if(!['NOT LISTED','ACTIVE','AVAILABLE','PROBABLE'].includes(status))continue;
    const threshold=baseline(history,market);if(threshold===null)continue;
    candidates.push({key:[game.id,player.id,market].join('|'),game,playerId:player.id,name:player.name,team:attacking,opponent,position,market,history,playerAverage,peerAverage,peerPlayers:peers.length,recentMinutes,status,baseline:threshold,last5:rate(history,threshold,5),last10:rate(history,threshold,10),thresholds:thresholds(history,market),weakness,priority:weakness.excess*(playerAverage/peerAverage),eligible:pregame&&inputsFresh});
   }
  }
 }
 candidates.sort((a,b)=>b.priority-a.priority||b.last5.rate-a.last5.rate||a.key.localeCompare(b.key));const seen=new Set(),topThree=candidates.filter(p=>p.eligible&&!seen.has(p.playerId)&&seen.add(p.playerId)).slice(0,3);
 return {game,weaknesses:weaknesses.sort((a,b)=>b.excess-a.excess),candidates:candidates.filter(p=>p.eligible),topThree,bestSingle:topThree[0]||null,coverage,ready:inputsFresh,reason:!pregame?'Historical view: recommendations close at tipoff.':!inputsFresh?'Fresh game, injury and roster data are required for player recommendations.':!weaknesses.length?'Position-level samples are incomplete or no above-average allowances qualify yet.':!topThree.length?'No eligible above-average player has a supported baseline in the matched positions.':null,method:'ESPN listed primary positions; detailed labels use ESPN Fantasy default positions when roster labels are broad. Position totals combine all opposing players at that position; broad G/F labels are not split into invented PG/SG/SF/PF assignments. Hit rates describe earlier appearances, not future win probabilities.'};
}
return {analyze,position,recorded,rate,baseline,thresholds,positions,markets,labels};
});
