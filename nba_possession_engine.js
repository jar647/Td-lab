/* NBA possession research engine. All injury/rest/rotation adjustments are explicit
 * assumptions, not fitted causal effects. No market input changes these draws. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.CookNBAPossessions=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const contextAPI=typeof module==='object'&&module.exports?require('./nba_game_context.js'):globalThis.CookNBAGameContext;
const VERSION='nba-possession-context-v2.1',clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
const finite=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x))?Number(x):null;
const norm=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
function min(p){const x=p.stats?.MIN;if(String(x).includes(':')){const [m,s]=String(x).split(':').map(Number);return m+s/60}return finite(x)}
function pair(x){if(typeof x!=='string'||!/^\d+-\d+$/.test(x))return null;return x.split('-').map(Number)}
function box(players){const out={pts:0,fgm:0,fga:0,tpm:0,tpa:0,ftm:0,fta:0,orb:0,drb:0,ast:0,to:0,minutes:0};let n=0;
 for(const p of players){if(p.didNotPlay)continue;const fg=pair(p.stats?.FG),tp=pair(p.stats?.['3PT']),ft=pair(p.stats?.FT),m=min(p),orb=finite(p.stats?.OREB),drb=finite(p.stats?.DREB),ast=finite(p.stats?.AST),to=finite(p.stats?.TO),pts=finite(p.stats?.PTS);
 if(!fg||!tp||!ft||[m,orb,drb,ast,to,pts].some(x=>x===null)||fg[0]>fg[1]||tp[1]>fg[1]||tp[0]>fg[0]||ft[0]>ft[1])return null;
 n++;out.pts+=pts;out.fgm+=fg[0];out.fga+=fg[1];out.tpm+=tp[0];out.tpa+=tp[1];out.ftm+=ft[0];out.fta+=ft[1];out.orb+=orb;out.drb+=drb;out.ast+=ast;out.to+=to;out.minutes+=m;
 }return n>=5&&out.minutes>=225&&out.fga>30&&out.pts===2*out.fgm+out.tpm+out.ftm?out:null;
}
function allocate(weights,total=240,cap=40){const entries=Object.entries(weights).filter(([,v])=>v>0),out={};if(entries.length*cap<total)return null;let left=total,pending=entries;
 while(pending.length){const sum=pending.reduce((s,[,w])=>s+w,0),full=pending.filter(([,w])=>left*w/sum>cap);if(!full.length){for(const [id,w]of pending)out[id]=left*w/sum;break}for(const [id]of full){out[id]=cap;left-=cap}const ids=new Set(full.map(([id])=>id));pending=pending.filter(([id])=>!ids.has(id))}return out;
}
function boundedMinutes(weights,lower,upper,total){const out={...lower};let left=total-Object.values(out).reduce((a,b)=>a+b,0),pending=Object.keys(weights).filter(id=>upper[id]-out[id]>1e-8);if(left< -1e-6||pending.reduce((s,id)=>s+upper[id]-out[id],0)<left-1e-6)throw Error('Quarter rotation budget unavailable');while(left>1e-8&&pending.length){const sum=pending.reduce((s,id)=>s+Math.max(.001,weights[id]),0),full=pending.filter(id=>left*Math.max(.001,weights[id])/sum>=upper[id]-out[id]);if(!full.length){for(const id of pending)out[id]+=left*Math.max(.001,weights[id])/sum;left=0;break}for(const id of full){left-=upper[id]-out[id];out[id]=upper[id]}pending=pending.filter(id=>!full.includes(id))}return out;}
function records(feed,cutoff){const seen=new Set();return (feed.games||[]).filter(g=>g.status==='STATUS_FINAL'&&g.season_type===2&&Date.parse(g.date)<cutoff&&!seen.has(String(g.id))&&seen.add(String(g.id))).map(g=>{const h=box((g.players||[]).filter(p=>p.team===g.home)),a=box((g.players||[]).filter(p=>p.team===g.away));if(!h||!a)return null;
 // Common box-score possession approximation, averaged over opponents and normalized for overtime.
 const duration=(h.minutes+a.minutes)/10,poss=((h.fga+.44*h.fta-h.orb+h.to)+(a.fga+.44*a.fta-a.orb+a.to))/2;
 return poss>50&&duration>=45?{...g,h,a,poss:poss*48/duration,duration}:null;
 }).filter(Boolean).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));}
function build(game,feed,injuries,rosters,now=Date.now(),options={}){
 if(!options.historical&&contextAPI)injuries=contextAPI.availability(options.context,game,injuries,now);
 const tip=Date.parse(game.date),cutoff=Math.min(tip,now),fresh=(d,h)=>d&&(!d.status||d.status==='ok')&&Date.parse(d.generated_at)<=now+300000&&now-Date.parse(d.generated_at)<=h*3600000;
 if(!Number.isFinite(tip))throw Error('Tipoff is unavailable');
 if(!options.historical&&(game.status!=='STATUS_SCHEDULED'||now>=tip))throw Error('Pregame simulation closed after tipoff');
 if(!options.historical&&(!fresh(feed,12)||!fresh(injuries,12)||!fresh(rosters,72)))throw Error('Fresh game, injury and roster feeds are required for rotation simulation');
 if(!options.historical&&tip-now<=90*60000&&now-Date.parse(injuries.generated_at)>15*60000)throw Error('Inside 90 minutes of tipoff, availability must be refreshed within 15 minutes');
 if(!options.historical&&!Array.isArray(injuries?.injuries))throw Error('Injury report schema unavailable');
 const hist=records(feed,cutoff);if(hist.length<8)throw Error('At least eight earlier complete shooting box scores are required');
 const league=hist.flatMap(g=>[{...g.h,poss:g.poss,duration:g.duration},{...g.a,poss:g.poss,duration:g.duration}]),total=k=>league.reduce((s,x)=>s+x[k],0);
 const zoneTotal=(zone,key)=>hist.filter(g=>g.shot_profile?.available).reduce((sum,g)=>sum+Object.values(g.shot_profile.teams||{}).reduce((s,t)=>s+(t[zone]?.[key]||0),0),0);
 const L={rim:zoneTotal('rim','attempts')>=100?zoneTotal('rim','made')/zoneTotal('rim','attempts'):null,mid:zoneTotal('two_other','attempts')>=100?zoneTotal('two_other','made')/zoneTotal('two_other','attempts'):null,two:(total('fgm')-total('tpm'))/Math.max(1,total('fga')-total('tpa')),three:total('tpm')/Math.max(1,total('tpa')),ft:total('ftm')/Math.max(1,total('fta')),pace:mean(hist.map(g=>g.poss)),ortg:100*total('pts')/league.reduce((s,x)=>s+x.poss*x.duration/48,0)};
 L.orb=total('orb')/Math.max(1,total('orb')+total('drb'));
 const teams={},warnings=[],uncertain=[];
 for(const team of [game.home,game.away]){
  const hs=hist.filter(g=>[g.home,g.away].includes(team)).slice(0,12);if(hs.length<3)throw Error(team+': at least three complete earlier team box scores required');
  const own=g=>g.home===team?g.h:g.a,opp=g=>g.home===team?g.a:g.h,rows=hs.map(own),def=hs.map(opp),sum=(rs,k)=>rs.reduce((s,x)=>s+x[k],0),pos=hs.reduce((s,g)=>s+g.poss*g.duration/48,0),shrink=hs.length/(hs.length+12);
  const two=(sum(def,'fgm')-sum(def,'tpm'))/Math.max(1,sum(def,'fga')-sum(def,'tpa')),three=sum(def,'tpm')/Math.max(1,sum(def,'tpa'));
  const ids=options.historical?null:rosters.teams?.[team];if(!options.historical&&(!Array.isArray(ids)||!ids.length))throw Error(team+': current roster missing');
  const observed=new Map();for(const g of hs)for(const p of g.players||[]){if(p.team!==team||p.didNotPlay||(min(p)||0)<1||ids&&!ids.map(String).includes(String(p.id)))continue;
   if(!observed.has(String(p.id)))observed.set(String(p.id),[]);observed.get(String(p.id)).push(p);}
  const players=[],absent=[];
  for(const [id,appearances]of observed){const p=appearances[0],recent=appearances.slice(0,5),baseline=mean(recent.map(min));if(recent.length<3||baseline<5)continue;
   const injuryMatches=(injuries.injuries||[]).filter(x=>String(x.player_id||x.id||'')===id||norm(x.player||x.name)===norm(p.name)),statuses=[...new Set(injuryMatches.map(x=>String(x.status||'UNKNOWN').toUpperCase()))];const status=options.historical?'HISTORICAL AVAILABILITY UNKNOWN':statuses.length>1?'UNKNOWN':statuses[0]||'NOT LISTED';
   if(/\b(OUT|INACTIVE|DOUBTFUL|SUSPENDED)\b/.test(status)){absent.push(p.name);continue}
   const pending=!options.historical&&!['NOT LISTED','ACTIVE','AVAILABLE','PROBABLE'].includes(status);if(pending&&baseline>=15)uncertain.push(p.name);
   const valid=appearances.filter(p=>pair(p.stats?.FG)&&pair(p.stats?.['3PT'])&&pair(p.stats?.FT)&&finite(p.stats?.AST)!==null&&finite(p.stats?.OREB)!==null&&finite(p.stats?.DREB)!==null);
   if(valid.length<3)continue;const mins=valid.reduce((s,p)=>s+min(p),0),v=k=>valid.reduce((s,p)=>s+(finite(p.stats[k])||0),0),ps=k=>valid.reduce((s,p)=>{const q=pair(p.stats[k]);return [s[0]+q[0],s[1]+q[1]]},[0,0]),fg=ps('FG'),tp=ps('3PT'),ft=ps('FT');
   const rotationRows=hs.filter(g=>g.rotation_profile?.available).map(g=>g.rotation_profile.players?.[id]).filter(Boolean);const quarterWeights=rotationRows.length>=3?[0,1,2,3].map(q=>mean(rotationRows.map(r=>r.quarters[q]))):null;
   const zones=hs.filter(g=>g.shot_profile?.available).map(g=>g.shot_profile.players?.[id]).filter(Boolean),za=(z,k)=>zones.reduce((sum,x)=>sum+(x[z]?.[k]||0),0),zoneN=za('rim','attempts')+za('two_other','attempts');
   const starterRows=appearances.filter(p=>p.starter===true),benchRows=appearances.filter(p=>p.starter===false);
   players.push({roleMinutes:{starter:mean(starterRows.map(min)),starterGames:starterRows.length,bench:mean(benchRows.map(min)),benchGames:benchRows.length},recentStarterRate:recent.filter(p=>p.starter===true).length/recent.length,quarterWeights,rimShare:zoneN>=30&&L.rim!==null?za('rim','attempts')/zoneN:null,rimFG:L.rim!==null?(za('rim','made')+20*L.rim)/(za('rim','attempts')+20):null,midFG:L.mid!==null?(za('two_other','made')+20*L.mid)/(za('two_other','attempts')+20):null,id,name:p.name,team,status,pending,baseline,weight:.65*mean(recent.slice(0,3).map(min))+.35*baseline,fga:fg[1]/mins,tpa:tp[1]/mins,fta:ft[1]/mins,ast:v('AST')/mins,to:v('TO')/mins,orb:v('OREB')/mins,drb:v('DREB')/mins,two:(fg[0]-tp[0]+20*L.two)/(fg[1]-tp[1]+20),three:(tp[0]+30*L.three)/(tp[1]+30),ft:(ft[0]+20*L.ft)/(ft[1]+20),sample:valid.length});
  }
  const minutes=allocate(Object.fromEntries(players.map(p=>[p.id,p.weight])));if(!minutes)throw Error(team+': fewer than six supported active rotation players');
  const rest=(tip-Date.parse(hs[0].date))/86400000,venue=hs.filter(g=>(g.home===team)===(game.home===team)),venueShift=venue.length>=3?(mean(venue.map(g=>own(g).pts/(g.poss*g.duration/48)))-sum(rows,'pts')/pos)*venue.length/(venue.length+12):0;
  // Opponent strength correction from opponents' earlier allowance, shrunk heavily.
  const schedule=hs.map(g=>{const opponent=g.home===team?g.away:g.home,prior=hist.filter(h=>[h.home,h.away].includes(opponent)&&Date.parse(h.date)<Date.parse(g.date)).slice(0,10);return prior.length>=3?mean(prior.map(h=>(h.home===opponent?h.a.pts:h.h.pts)/(h.poss*h.duration/48))):L.ortg/100});
  const strength=clamp((L.ortg/100-mean(schedule))*.25,-.03,.03);
  const zoneDefense=zone=>{const known=hs.filter(g=>g.shot_profile?.available).map(g=>g.shot_profile.teams?.[g.home===team?g.away:g.home]).filter(Boolean),attempts=known.reduce((s,x)=>s+(x[zone]?.attempts||0),0),made=known.reduce((s,x)=>s+(x[zone]?.made||0),0),prior=zone==='rim'?L.rim:L.mid;return attempts>=30&&prior!==null?(made/attempts-prior)*known.length/(known.length+12):null};
  teams[team]={rotationProfileGames:hs.filter(g=>g.rotation_profile?.available).length,rimDefense:zoneDefense('rim'),midDefense:zoneDefense('two_other'),shotProfileGames:hs.filter(g=>g.shot_profile?.available).length,players,minutes,absent,historicalOrb:sum(rows,'orb')/rows.length,historicalAst:sum(rows,'ast')/rows.length,venueChanged:hs[0].home!==game.home,rest,games:hs.length,pace:mean(hs.map(g=>g.poss)),twoDefense:(two-L.two)*shrink,threeDefense:(three-L.three)*shrink,turnover:clamp(sum(rows,'to')/pos,.05,.25),forceTurnover:clamp(sum(def,'to')/pos,.05,.25),ftTrips:clamp(.5*sum(rows,'fta')/pos,.04,.3),allowFT:clamp(.5*sum(def,'fta')/pos,.04,.3),orb:clamp(sum(rows,'orb')/Math.max(1,sum(rows,'orb')+sum(def,'drb')),.1,.4),assist:clamp(sum(rows,'ast')/Math.max(1,sum(rows,'fgm')),.3,.85),venueShift,strength};
  if(players.some(p=>minutes[p.id]>p.baseline*1.4&&minutes[p.id]-p.baseline>6))warnings.push(team+': substantial rotation redistribution');
 }
 const allIds=Object.values(teams).flatMap(t=>t.players.map(p=>p.id));if(new Set(allIds).size!==allIds.length)throw Error('Player appears on both current rosters');
 const model={version:VERSION,game:{id:String(game.id),home:game.home,away:game.away,date:game.date},teams,league:L,pace:clamp((teams[game.home].pace+teams[game.away].pace+L.pace)/3,75,120),paceSamples:hist.map(g=>g.poss),uncertain,warnings,generatedAt:new Date(now).toISOString(),inputTimes:{games:feed.generated_at,injuries:injuries.generated_at,rosters:rosters.generated_at},historical:!!options.historical,limits:'Estimated possessions from shooting box scores, not play-by-play counts. Shot-distance buckets are used only with verified play-description coverage; otherwise two/three-point splits are used. Tonight’s defensive assignments are not confirmed; historical exposure/defender tracking mixtures apply only with fresh sources. Optical tracking locations are unavailable. Rest, home-court and rotation effects are heuristic. Back-to-back venue-change is a small fatigue proxy; actual travel mileage and flight schedules are unavailable. Questionable participation is an equal-weight sensitivity scenario, not an injury probability. Uncalibrated.'};
 if(uncertain.length)warnings.push('Questionable players: equal-weight in/out sensitivity, not confirmed participation');
 if(contextAPI&&!options.historical)contextAPI.apply(model,options.context,now);
 return model;
}
function random(seed){let s=seed>>>0;return ()=>{s+=0x6D2B79F5;let t=s;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296}}
function draws(model,count=10000,seed=6472026,options={}){
 if(!Number.isInteger(count)||count<1000||count>100000)throw Error('Runs must be between 1000 and 100000');
 const rng=random(seed),gauss=()=>Math.sqrt(-2*Math.log(Math.max(1e-12,rng())))*Math.cos(2*Math.PI*rng()),g=model.game,home=[],away=[],players=Object.values(model.teams).flatMap(t=>t.players),sums=Object.fromEntries(players.map(p=>[p.id,{points:0,rebounds:0,assists:0,minutes:0,played:0}])),legs=(options.legs||[]).slice(0,5),legWins=legs.map(()=>0),pairWins=legs.map(()=>legs.map(()=>0));const playerOutcomes=options.collectPlayerOutcomes?{}:null;let allWin=0,overtime=0,overtimePeriods=0,blowouts=0;
 const choose=(ps,weight,exclude)=>{const values=ps.map(p=>p.id===exclude?0:Math.max(0,weight(p))),sum=values.reduce((a,b)=>a+b,0);if(!sum)return null;let n=rng()*sum;for(let i=0;i<ps.length;i++){n-=values[i];if(n<=0)return ps[i]}return ps.at(-1)};
 for(let run=0;run<count;run++){
  const states={};for(const team of [g.home,g.away]){const t=model.teams[team],active=t.players.filter(p=>!p.pending||options.availability==='in'||options.availability!=='out'&&rng()<.5),weights=Object.fromEntries(active.map(p=>[p.id,p.weight]));const minutes=allocate(weights);if(!minutes)throw Error(team+': in/out scenario lacks six supported rotation players');const weighted=key=>active.reduce((sum,p)=>sum+minutes[p.id]*p[key],0);states[team]={...t,turnover:clamp((t.turnover+weighted('to')/t.pace)/2,.05,.25),ftTrips:clamp((t.ftTrips+.5*weighted('fta')/t.pace)/2,.04,.3),orb:clamp(t.orb*weighted('orb')/Math.max(1,t.historicalOrb),.08,.4),assist:clamp(t.assist*weighted('ast')/Math.max(1,t.historicalAst),.2,.85),active,minutes,stats:Object.fromEntries(t.players.map(p=>[p.id,{points:0,rebounds:0,assists:0,minutes:0}])),score:0,heat:gauss()*.018};}
  const sampled=model.paceSamples[Math.floor(rng()*model.paceSamples.length)],pace=clamp(model.pace+.65*(sampled-model.league.pace)+gauss()*1.5,70,130),sharedHeat=gauss()*.008;
  const period=(duration,late,qIndex=-1)=>{
   for(const team of [g.home,g.away]){const s=states[team],large=late&&Math.abs(states[g.home].score-states[g.away].score)>=18;
    const weights=Object.fromEntries(s.active.map(p=>[p.id,s.minutes[p.id]*(qIndex>=0&&p.quarterWeights?Math.max(.05,p.quarterWeights[qIndex])/(Math.max(.1,p.quarterWeights.reduce((a,b)=>a+b,0))/4):1)*(large?(s.minutes[p.id]>=28?.8:1.15):1)]));const lower={},upper={};for(const p of s.active){const spent=s.stats[p.id].minutes,remaining=s.minutes[p.id]-spent;lower[p.id]=qIndex>=0&&!large?Math.max(0,remaining-12*(3-qIndex)):0;upper[p.id]=qIndex>=0?Math.max(0,Math.min(12,large?40-spent:remaining)):duration;}s.periodMinutes=boundedMinutes(weights,lower,upper,5*duration);if(!s.periodMinutes)throw Error('Unsupported period rotation');for(const p of s.active)s.stats[p.id].minutes+=s.periodMinutes[p.id];
   }
   for(const team of [g.home,g.away]){const s=states[team],d=states[team===g.home?g.away:g.home];s.matchupDeltas=Object.fromEntries(s.active.map(p=>[p.id,contextAPI?contextAPI.defensiveDelta(p,d.active,d.periodMinutes):null]));}
   const possessions=Math.round(pace*duration/48);
   for(let n=0;n<possessions;n++)for(const team of [g.home,g.away]){
    const s=states[team],d=states[team===g.home?g.away:g.home],mins=p=>s.periodMinutes[p.id],restPenalty=s.rest<1.3?(.005+(s.venueChanged?.0025:0)):0,context=clamp(s.venueShift*.25+s.strength+(team===g.home?.004:-.004)-restPenalty,-.025,.025);
    const turn=(s.turnover+d.forceTurnover)/2,ftTrip=(s.ftTrips+d.allowFT)/2;
    const rebound=()=>{const offensive=rng()<s.orb,t=offensive?s:d,p=choose(t.active,p=>t.periodMinutes[p.id]*(offensive?p.orb:p.drb));if(p)t.stats[p.id].rebounds++;return offensive};
    const event=rng();if(event<turn)continue;
    if(event<turn+ftTrip){const p=choose(s.active,p=>mins(p)*p.fta);if(p){for(let k=0;k<2;k++){const made=rng()<p.ft;if(made){s.stats[p.id].points++;s.score++}else if(k===1)rebound()}}continue;}
    for(let attempt=0;attempt<5;attempt++){
     const p=choose(s.active,p=>mins(p)*p.fga);if(!p)break;const three=rng()<p.tpa/Math.max(.001,p.fga),zone=!three&&p.rimShare!==null&&d.rimDefense!==null&&d.midDefense!==null?(rng()<p.rimShare?'rim':'mid'):null,teamDefense=three?d.threeDefense:zone==='rim'?d.rimDefense:zone==='mid'?d.midDefense:d.twoDefense,tracked=s.matchupDeltas[p.id],defense=tracked===null?teamDefense:.8*teamDefense+.2*tracked,shooting=(three?p.three:zone==='rim'?p.rimFG:zone==='mid'?p.midFG:p.two)+defense,chance=clamp(shooting+s.heat+sharedHeat+context,.12,.85);
     if(rng()<chance){const pts=three?3:2;s.stats[p.id].points+=pts;s.score+=pts;if(rng()<s.assist){const helper=choose(s.active,x=>mins(x)*x.ast,p.id);if(helper)s.stats[helper.id].assists++}break;}
     if(!rebound())break;
    }
   }
  };
  for(let q=0;q<4;q++)period(12,q===3,q);if(Math.abs(states[g.home].score-states[g.away].score)>=18)blowouts++;
  let ot=0;while(states[g.home].score===states[g.away].score){ot++;period(5,false);if(ot>20)throw Error('Overtime failed to resolve')}
  if(ot)overtime++;overtimePeriods+=ot;
  const stats={...states[g.home].stats,...states[g.away].stats};home.push(states[g.home].score);away.push(states[g.away].score);
  for(const p of players){const x=stats[p.id],sum=sums[p.id];if(playerOutcomes){const samples=playerOutcomes[p.id]??={points:[],rebounds:[],assists:[]};for(const k of ['points','rebounds','assists'])samples[k].push(x[k]);}for(const k of ['points','rebounds','assists','minutes'])sum[k]+=x[k];if(x.minutes>0)sum.played++;}
  const won=legs.map((leg,i)=>{const p=players.find(p=>p.id===String(leg.player_id)||norm(p.name)===norm(leg.player)),x=p&&stats[p.id],fields={points:['points'],rebounds:['rebounds'],assists:['assists'],pra:['points','rebounds','assists'],pointsrebounds:['points','rebounds'],pointsassists:['points','assists'],reboundsassists:['rebounds','assists']}[norm(leg.market)],value=x&&fields?fields.reduce((s,k)=>s+x[k],0):null;const win=value!==null&&x.minutes>0&&(String(leg.side).toLowerCase()==='under'?value<Number(leg.line):value>Number(leg.line));if(win)legWins[i]++;return win;});
  if(won.length&&won.every(Boolean))allWin++;for(let i=0;i<won.length;i++)for(let j=0;j<won.length;j++)if(won[i]&&won[j])pairWins[i][j]++;
 }
 return {playerOutcomes,home,away,players:players.map(p=>({id:p.id,player:p.name,team:p.team,status:p.status,...Object.fromEntries(Object.entries(sums[p.id]).map(([k,v])=>[k,v/count]))})),overtimeRate:overtime/count,overtimePeriods:overtimePeriods/count,blowoutRate:blowouts/count,legs:legs.map((l,i)=>({...l,hitRate:legWins[i]/count})),jointHitRate:legs.length?allWin/count:null,pairHitRates:pairWins.map(r=>r.map(n=>n/count)),model:VERSION,runCount:count};
}
return {VERSION,box,allocate,records,build,draws};
});

