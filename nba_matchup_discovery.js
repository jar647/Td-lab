/* Matchup discovery from recorded box scores. No simulated forecasts or prices. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./nba_possession_engine'):root.CookNBAPossessions);if(typeof module==='object'&&module.exports)module.exports=api;root.CookNBAMatchups=api;})(typeof globalThis!=='undefined'?globalThis:this,function(boxes){
'use strict';
const positions=['PG','SG','SF','PF','C'],markets=['points','rebounds','assists','threes'],labels={points:'points',rebounds:'rebounds',assists:'assists',threes:'3-pointers'};
const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null,norm=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]/g,'');
function position(raw){const x=typeof raw==='object'?raw?.abbreviation||raw?.displayName||raw?.name:raw;return {POINTGUARD:'PG',SHOOTINGGUARD:'SG',SMALLFORWARD:'SF',POWERFORWARD:'PF',CENTER:'C',PG:'PG',SG:'SG',SF:'SF',PF:'PF',C:'C'}[String(x||'').toUpperCase().replace(/[^A-Z]/g,'')]||null;}
function minutes(raw){if(raw===null||raw===undefined||raw==='')return null;if(String(raw).includes(':')){const [m,s]=String(raw).split(':').map(Number);return Number.isFinite(m)&&Number.isFinite(s)?m+s/60:null}const n=Number(raw);return Number.isFinite(n)?n:null;}
function recorded(p){const min=minutes(p.stats?.MIN);if(p.didNotPlay||!(min>0))return null;const rawThree=p.stats?.['3PM']??p.stats?.['3PTM']??p.stats?.['3PT'];const three=typeof rawThree==='string'&&rawThree.includes('-')?Number(rawThree.split('-')[0]):Number(rawThree);const values={minutes:min,points:Number(p.stats?.PTS),rebounds:Number(p.stats?.REB),assists:Number(p.stats?.AST),threes:three};return markets.every(k=>k==='threes'?rawThree!==undefined&&rawThree!==null&&String(rawThree).trim()!==''&&Number.isFinite(three)&&three>=0:p.stats?.[{points:'PTS',rebounds:'REB',assists:'AST'}[k]]!==undefined&&Number.isFinite(values[k])&&values[k]>=0)?values:null;}
function minimumScore(side,market){return market==='threes'?85:String(side).toLowerCase()==='under'?85:75;}
function qualifies(row){return !!row&&Number.isFinite(row.researchScore)&&row.researchScore>=minimumScore(row.side,row.market)&&row.researchScore<=100;}
function rate(history,threshold,n,side='over'){const rows=history.slice(0,n),hits=rows.filter(v=>side==='under'?v<threshold:v>=threshold).length;return {hits,games:rows.length,rate:rows.length?hits/rows.length:null};}
function thresholds(history,market){const max=Math.max(...history,1),limit=Math.min({points:70,rebounds:35,assists:25,threes:15}[market],Math.ceil(max)+3);return Array.from({length:limit},(_,i)=>i+1);}
function baseline(history,market,side='over'){if(side==='under')return thresholds(history,market).map(n=>n+.5).find(t=>rate(history,t,5,side).rate>=.8&&rate(history,t,10,side).rate>=.7)??null;const steps={points:[5,10,15,20,25,30,35,40,45,50],rebounds:[2,4,6,8,10,12,15,18,20],assists:[2,3,4,5,6,7,8,10,12,15],threes:[1,2,3,4,5,6,7,8,9,10]}[market];return steps.filter(t=>rate(history,t,5).rate>=.8&&rate(history,t,10).rate>=.7).at(-1)||null;}
function analyze(game,feed,rosters,injuries,now=Date.now()){
 const cutoff=Math.min(Date.parse(game.date),now),year=new Date(game.date).getUTCFullYear()-(new Date(game.date).getUTCMonth()<9),seasonStart=Date.UTC(year,9,1);
 const recent=boxes.records(feed,cutoff).filter(g=>Date.parse(g.date)>=seasonStart),members=rosters?.teams||{},metadata=rosters?.players||{};
 const pos=p=>position(p.position)||position(metadata[String(p.id)]?.position);
 const profiles=new Map(),defense=new Map(),teamHistory=new Map(),coverage={games:0,omittedTeamGames:0};
 for(const prior of recent){for(const team of [prior.home,prior.away]){if(!teamHistory.has(team))teamHistory.set(team,[]);teamHistory.get(team).push(prior);}}
 for(const g of recent){
  for(const team of [g.home,g.away]){
   const opponents=(g.players||[]).filter(p=>p.team!==team&&!p.didNotPlay),observed=opponents.map(p=>({p,stats:recorded(p),position:pos(p)})).filter(x=>x.stats),totalMinutes=observed.reduce((s,x)=>s+x.stats.minutes,0),known=observed.filter(x=>x.position).reduce((s,x)=>s+x.stats.minutes,0);
   const bucket=defense.get(team)||[];
   if(totalMinutes>0&&known/totalMinutes>=.98&&bucket.length<10){const byPosition=Object.fromEntries(positions.map(p=>[p,{points:0,rebounds:0,assists:0,threes:0}]));for(const x of observed)if(x.position)for(const k of markets)byPosition[x.position][k]+=x.stats[k];bucket.push({game:g.id,values:byPosition});defense.set(team,bucket);coverage.games++;}else if(bucket.length<10)coverage.omittedTeamGames++;
  }
  for(const p of g.players||[]){const stats=recorded(p),position=pos(p);if(!stats||!position||!Array.isArray(members[p.team])||!members[p.team].map(String).includes(String(p.id)))continue;
   const id=String(p.id);if(!profiles.has(id))profiles.set(id,{id,name:p.name,team:p.team,position,rows:[]});const row=profiles.get(id);if(row.team!==p.team||row.rows.length>=10)continue;row.rows.push({...stats,date:g.date,home:p.team===g.home});
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
  for(const position of positions)for(const market of markets){const allowed=avg(sample.map(r=>r.values[position][market])),reference=league[position][market];if(!(reference>0)||allowed===reference)continue;const side=allowed<reference?'under':'over';
   const weakness={team:opponent,attacking,position,market,allowed,leagueAverage:reference,games:sample.length,side,excess:Math.abs(allowed/reference-1)};weaknesses.push(weakness);
   const peers=peerProfiles.filter(p=>p.position===position),peerAverage=avg(peers.map(p=>avg(p.rows.slice(0,5).map(r=>r[market]))));
   if(peers.length<3||!(peerAverage>0))continue;
   for(const player of peerProfiles.filter(p=>p.team===attacking&&p.position===position)){
    const history=player.rows.map(r=>r[market]),playerAverage=avg(history.slice(0,5)),recentMinutes=avg(player.rows.slice(0,5).map(r=>r.minutes));if((side==='over'?!(playerAverage>peerAverage):!(playerAverage<peerAverage))||player.rows[0].minutes<15)continue;
    const injury=(injuries?.injuries||[]).find(p=>String(p.player_id||p.id||'')===player.id||norm(p.player||p.name)===norm(player.name)),status=String(injury?.status||'NOT LISTED').toUpperCase();if(!['NOT LISTED','ACTIVE','AVAILABLE','PROBABLE'].includes(status))continue;
    const threshold=baseline(history,market,side);if(threshold===null)continue;
    const ownHistory=teamHistory.get(attacking)||[],opponentHistory=teamHistory.get(opponent)||[],lastTeam=ownHistory[0],restDays=lastTeam?Math.max(0,Math.round((Date.parse(game.date)-Date.parse(lastTeam.date))/86400000)-1):null,backToBack=restDays===0;
    const venueRows=player.rows.filter(r=>r.home===(attacking===game.home)),venueAverage=venueRows.length>=3?avg(venueRows.map(r=>r[market])):null;
    const projectedMinutes=Math.round(Math.min(40,Math.max(0,recentMinutes+(backToBack&&recentMinutes>32?-1:0)))*10)/10;
    const paceSample=rows=>rows.slice(0,5).map(g=>{const a=(g.players||[]).filter(p=>p.team===g.home),b=(g.players||[]).filter(p=>p.team===g.away);const possession=x=>{const sum=k=>x.reduce((v,p)=>v+(Number(p.stats?.[k])||0),0);return sum('FGA')+.44*sum('FTA')-sum('OREB')+sum('TO')};return (possession(a)+possession(b))/2}).filter(v=>v>70&&v<140);
    const paceValues=[...paceSample(ownHistory),...paceSample(opponentHistory)],paceEstimate=paceValues.length>=6?Math.round(avg(paceValues)*10)/10:null;
    // Matchup quality uses observed position allowances, role, recent production,
    // minutes stability and availability. Neither prices nor a chosen line enters it.
    const clamp=x=>Math.max(0,Math.min(1,x));
    const minutesHistory=player.rows.slice(0,5).map(r=>r.minutes);
    const minutesSpread=Math.max(...minutesHistory)-Math.min(...minutesHistory);
    const earlierAverage=avg(history.slice(5)),recentForm=earlierAverage>0?clamp((side==='under'?earlierAverage/Math.max(.1,playerAverage):playerAverage/earlierAverage)/1.2):.5;
    const factors=[
     {label:side==='under'?'Opponent suppression at position':'Opponent weakness at position',points:Math.round(30*clamp(weakness.excess/.3)),max:30},
     {label:'Usage / production versus position peers',points:Math.round(20*clamp((side==='under'?1-playerAverage/peerAverage:playerAverage/peerAverage-1)/.5)),max:20},
     {label:'Recent performance',points:Math.round(15*recentForm),max:15},
     {label:'Minutes and stability',points:Math.round(20*clamp(projectedMinutes/32)*clamp(1-minutesSpread/30)),max:20},
     {label:'Available with supported samples',points:Math.round(15*Math.min(player.rows.length,sample.length,10)/10*(status==='PROBABLE'?.8:1)),max:15}
    ];
    const researchScore=factors.reduce((s,f)=>s+f.points,0);
    const matchupRating={side,score:researchScore,factors};
    candidates.push({side,key:[game.id,player.id,market,...(side==='under'?['under']:[])].join('|'),game,playerId:player.id,name:player.name,team:attacking,opponent,position,market,history,playerAverage,peerAverage,peerPlayers:peers.length,recentMinutes,projectedMinutes,restDays,backToBack,venueAverage,venueGames:venueRows.length,paceEstimate,researchScore,matchupRating,status,baseline:threshold,last5:rate(history,threshold,5,side),last10:rate(history,threshold,10,side),thresholds:side==='under'?thresholds(history,market).map(n=>n+.5):thresholds(history,market),weakness,priority:weakness.excess*(playerAverage/peerAverage),eligible:pregame&&inputsFresh});
   }
  }
 }
 candidates.sort((a,b)=>b.researchScore-a.researchScore||b.priority-a.priority||b.last5.rate-a.last5.rate||a.key.localeCompare(b.key));const seen=new Set(),topThree=candidates.filter(p=>p.eligible&&qualifies(p)&&!seen.has(p.playerId)&&seen.add(p.playerId)).slice(0,3);
 return {game,weaknesses:weaknesses.sort((a,b)=>b.excess-a.excess),candidates:candidates.filter(p=>p.eligible&&qualifies(p)),topThree,bestSingle:topThree[0]||null,coverage,ready:inputsFresh,reason:!pregame?'Historical view: recommendations close at tipoff.':!inputsFresh?'Fresh game, injury and roster data are required for player recommendations.':!weaknesses.length?'Position-level samples are incomplete or no above-average allowances qualify yet.':!topThree.length?'PASS · No supported matchup meets OVER 75/100 or UNDER 85/100.':null,method:'ESPN listed primary positions; detailed labels use ESPN Fantasy default positions when roster labels are broad. Position totals combine all opposing players at that position; broad G/F labels are not split into invented PG/SG/SF/PF assignments. Hit rates describe earlier appearances, not future win probabilities.'};
}
return {minimumScore,qualifies,analyze,position,recorded,rate,baseline,thresholds,positions,markets,labels};
});
