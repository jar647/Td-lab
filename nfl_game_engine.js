/* THE PROP VAULT game-first research simulator.
   Generative team plays -> pass/rush attempts -> allocated targets/carries ->
   catches, receiving/pass/rush yards. Never a calibrated sportsbook model.
   UMD export for browser worker and Node test runner. No external dependencies.
*/
(function(root){
"use strict";
const MARKETS={
 rushYards:[25,40,50,60,70,80,100],
 recYards:[20,25,30,40,50,60,70,80,100],
 receptions:[2,3,4,5,6,7,8],
 passYards:[150,175,200,225,250,275,300]
};
const finite=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const mean=(arr,k)=>arr.length?arr.reduce((a,x)=>a+(finite(x[k])??0),0)/arr.length:0;
const rng=seed=>{let t=seed>>>0;return ()=>{t+=0x6D2B79F5;let x=t;x=Math.imul(x^x>>>15,x|1);x^=x+Math.imul(x^x>>>7,x|61);return ((x^x>>>14)>>>0)/4294967296;}};
function normal(random){const u=Math.max(1e-9,random()),v=random();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)}
function randCount(n,p,random){let x=0;for(let i=0;i<n;i++)if(random()<p)x++;return x;}
function weighted(items,sum,random){let u=random()*sum;for(let i=0;i<items.length;i++){u-=items[i].weight;if(u<0)return items[i]}return items[items.length-1]}
function blocked(p){
 const report=String(p.injuryReportStatus||'').toUpperCase();
 const roster=String(p.availability||'').toUpperCase();
 return /^(OUT|INACTIVE|SUSPENDED|IR|PUP|RES|DEV|CUT|RET|EXE|TRD|TRT)$/.test(report)||
        /^(OUT|INACTIVE|SUSPENDED|IR|PUP|RES|DEV|CUT|RET|EXE|TRD|TRT)$/.test(roster);
}
function playerParams(p){
 const history=Array.isArray(p.seasonGameStats)?p.seasonGameStats:[];
 if(history.length<3||p.playerAppearancesVerified===false)return null;
 const key=String(p.player_id||p.team+'|'+p.player);
 const rec=mean(history,'receptions'),targets=mean(history,'targets'),carries=mean(history,'rushAttempts');
 const pass=mean(history,'passAttempts');
 const yardsPerCatch=clamp((mean(history,'recYards')+35)/(rec+3),3,23);
 const rushPerCarry=clamp((mean(history,'rushYards')+18)/(carries+4),1.7,7);
 const targetRate=clamp((rec+3)/(targets+6),.28,.88);
 const norm=Array.isArray(p.last5GameStats)&&p.last5GameStats.length>=3?p.last5GameStats:history.slice(-5);
 const usage=(field)=>.65*mean(history,field)+.35*mean(norm,field);
 const ratios=p.defenseOpponentRatio||{};
 return {id:key,name:String(p.player||key),team:String(p.team),pos:String(p.pos),
  gameCount:history.length,questionable:/QUESTIONABLE|DOUBTFUL|UNVERIFIED|NOT_REPORTED|LIMITED|DNP_PRACTICE/.test(
   [p.injuryReportStatus,p.availability,p.injuryPracticeStatus].join('|').toUpperCase()),
  pass:usage('passAttempts'),targets:usage('targets'),carries:usage('rushAttempts'),
  verifiedTeamPass:finite(p.teamPassAttemptsPerGame),
  catchRate:targetRate,ypc:yardsPerCatch,ypcarry:rushPerCarry,
  passMatch:clamp(finite(ratios.PASS)??1,.85,1.12),
  recMatch:clamp(finite(ratios.REC)??1,.85,1.12),
  rushMatch:clamp(finite(ratios.RUSH)??1,.85,1.12),
  output:{passYards:0,rushYards:0,recYards:0,receptions:0}
 };
}
function build(records){
 if(!Array.isArray(records)||!records.length)throw Error('No matchup player records');
 const entries=records.filter(p=>p&&p.team&&p.opp&&!blocked(p)).map(playerParams).filter(Boolean);
 const teams=[...new Set(records.map(p=>String(p.team)))].sort();
 if(teams.length!==2)throw Error('Exactly two teams are required for one game');
 const league=teams.map(team=>{
  const roster=entries.filter(p=>p.team===team);
  const qbs=roster.filter(p=>p.pos==='QB').sort((a,b)=>b.pass-a.pass);
  const quarterbackVerified=qbs.length>0&&qbs[0].pass>=12;
  const candidates=roster.map(p=>p.verifiedTeamPass).filter(x=>x!==null&&x>=12&&x<=65);
  // If the QB's individual history is unavailable (injury, return, change of
  // starter), use verified historical TEAM passing attempts instead.
  // An internal anonymous passer enables receiver-target simulations, but
  // MUST NOT generate a named player/QB passing-yard market or imply a starter.
  const fallbackAttempts=candidates.length?candidates[0]:null;
  if(!quarterbackVerified&&fallbackAttempts===null)
   throw Error(team+': no verified quarterback or historical team passing volume');
  const qb=quarterbackVerified?qbs[0]:{
   id:'UNVERIFIED_TEAM_QB_'+team,team,pos:'TEAM_PASSER_UNVERIFIED',
   pass:fallbackAttempts,passMatch:1,
   output:{passYards:0,rushYards:0,recYards:0,receptions:0}
  };
  const receivers=roster.filter(p=>['WR','TE','RB'].includes(p.pos)&&p.targets>=.25);
  const runners=roster.filter(p=>['RB','QB','WR'].includes(p.pos)&&p.carries>=.15);
  const passAttempts=clamp(qb.pass,20,48);
  const rushAttempts=clamp(runners.reduce((a,p)=>a+p.carries,0),12,44);
  const pace=clamp(passAttempts+rushAttempts,42,83);
  const passRate=clamp(passAttempts/pace,.36,.78);
  // Untracked backup players and receiving targets remain a real residual
  // category rather than inflating the known players to 100% of opportunities.
  function pool(known,total,minimum){
   const sum=known.reduce((a,p)=>a+Math.max(.05,p.weight),0);
   const other=Math.max(minimum,total-sum);
   return {items:[...known,{p:null,weight:other}],sum:sum+other};
  }
  const targetPool=pool(receivers.map(p=>({p,weight:p.targets})),passAttempts,2.5);
  const carryPool=pool(runners.map(p=>({p,weight:p.carries})),rushAttempts,1);
  return {team,roster,qb,pace,passRate,targetPool,carryPool,
   outlook:{team,passVolumeSource:quarterbackVerified?'VERIFIED_QB_PLAYER_HISTORY':'VERIFIED_TEAM_PBP_NO_QB_PROPS',
    quarterbackPlayerPropsAvailable:quarterbackVerified,
    warning:quarterbackVerified?null:'QB individual history is insufficient; team passing volume based on completed PBP. No QB props are projected.',
    estimatedPlays:Math.round(pace),estimatedPassAttempts:Math.round(passAttempts),
    estimatedRushAttempts:Math.round(rushAttempts),passingShare:Math.round(passRate*100),
    untrackedTargetShare:Math.round(targetPool.items[targetPool.items.length-1].weight/targetPool.sum*100),
    untrackedCarryShare:Math.round(carryPool.items[carryPool.items.length-1].weight/carryPool.sum*100)}
  };
 });
 if(league.some(t=>t.roster.length<4))throw Error('Not enough position-verified players for complete matchup');
 return {teams:league,players:entries};
}
function simulate(records,count=10000,seed=1307,selected=[]){
 if(!Number.isInteger(count)||count<1000||count>100000)throw Error('Simulation count must be 1,000 to 100,000');
 const model=build(records),random=rng(seed);
 const hits=new Map(),totals=new Map(),samples=new Map();
 const selections=selected.map(x=>({id:String(x.id),market:String(x.market),line:Number(x.line)}));
 const byId=new Map(model.players.map(p=>[p.id,p]));
 const allStats={};
 for(const p of model.players){allStats[p.id]={rushYards:0,recYards:0,receptions:0,passYards:0};}
 for(const p of model.players)for(const [market,lines] of Object.entries(MARKETS)){
  if(market==='passYards'&&p.pos!=='QB')continue;
  if(['recYards','receptions'].includes(market)&&!['RB','WR','TE'].includes(p.pos))continue;
  if(market==='rushYards'&&!['QB','RB','WR'].includes(p.pos))continue;
  for(const line of lines)hits.set(p.id+'|'+market+'|'+line,0);
 }
 let joint=0;
 const sumScores={};
 for(let trial=0;trial<count;trial++){
  for(const p of model.players){p.output.passYards=0;p.output.rushYards=0;p.output.recYards=0;p.output.receptions=0;}
  const paceShock=normal(random)*.11;
  const scriptShock=normal(random);
  for(let ti=0;ti<model.teams.length;ti++){
   const t=model.teams[ti];
   const plays=clamp(Math.round(t.pace*Math.exp(paceShock+normal(random)*.07)),35,90);
   const passRate=clamp(t.passRate+(ti===0?1:-1)*scriptShock*.032+normal(random)*.043,.33,.84);
   const attempts=randCount(plays,passRate,random),rushes=plays-attempts;
   let qbYards=0;
   const teamRecFactor=clamp(Math.exp(normal(random)*.12),.68,1.42);
   const teamRushFactor=clamp(Math.exp(normal(random)*.14),.65,1.47);
   for(let a=0;a<attempts;a++){
    const to=weighted(t.targetPool.items,t.targetPool.sum,random);
    if(to.p){
     const p=to.p;
     if(random()<p.catchRate){
      const yards=clamp(p.ypc*p.recMatch*teamRecFactor*Math.exp(normal(random)*.55-.55*.55/2),0,85);
      p.output.receptions+=1;p.output.recYards+=yards;qbYards+=yards;
     }
    }else if(random()<.65)qbYards+=clamp(9.5*teamRecFactor*Math.exp(normal(random)*.55-.15),0,70);
   }
   t.qb.output.passYards+=qbYards*t.qb.passMatch;
   for(let c=0;c<rushes;c++){
    const to=weighted(t.carryPool.items,t.carryPool.sum,random);
    if(!to.p)continue;
    const p=to.p;
    const yards=clamp(p.ypcarry*p.rushMatch*teamRushFactor*Math.exp(normal(random)*.68-.68*.68/2),0,55);
    p.output.rushYards+=yards;
   }
   const scores=sumScores[t.team]||(sumScores[t.team]={plays:0,passes:0,rushes:0});
   scores.plays+=plays;scores.passes+=attempts;scores.rushes+=rushes;
  }
  for(const p of model.players){
   for(const [market,lines] of Object.entries(MARKETS)){
    for(const line of lines){
     const key=p.id+'|'+market+'|'+line;
     if(!hits.has(key))continue;
     if(p.output[market]>=line)hits.set(key,hits.get(key)+1);
    }
   }
   for(const field of Object.keys(allStats[p.id]))allStats[p.id][field]+=p.output[field];
  }
  if(selections.length&&selections.every(x=>{
   const p=byId.get(x.id);return p&&MARKETS[x.market]&&p.output[x.market]>=x.line;
  }))joint++;
 }
 const markets=[];
 for(const [key,n] of hits.entries()){
  const [id,market,line]=key.split('|');
  const p=byId.get(id);
  if(!p)continue;
  const rate=n/count;
  // Wilson score interval describes Monte Carlo sampling noise ONLY.
  const z=1.96,den=1+z*z/count,mid=(rate+z*z/(2*count))/den;
  const err=z*Math.sqrt(rate*(1-rate)/count+z*z/(4*count*count))/den;
  markets.push({id,name:p.name,team:p.team,pos:p.pos,market,line:Number(line),hits:n,
   scenarioRate:Math.round(rate*10000)/10000,scenarioLow:Math.max(0,mid-err),
   scenarioHigh:Math.min(1,mid+err),questionable:p.questionable,
   modeledMean:Math.round(allStats[p.id][market]/count*10)/10});
 }
 const summary=model.teams.map(t=>({
  ...t.outlook,scenarioAvgPlays:Math.round(sumScores[t.team].plays/count*10)/10,
  scenarioAvgPasses:Math.round(sumScores[t.team].passes/count*10)/10,
  scenarioAvgRushes:Math.round(sumScores[t.team].rushes/count*10)/10
 }));
 return {status:'RESEARCH_ONLY_UNCALIBRATED',modelVersion:'game-first-volume-v1',
  count,seed,teams:summary,markets,
  joint:selections.length?{legs:selections.length,hits:joint,scenarioRate:joint/count}:null,
  assumptions:['Generative team play volume and pass/rush split','Player targets and carries compete for team opportunities',
   'Receptions require target and completion','Quarterback passing yards derive from completed receiver outcomes',
   'Pace/game script drive within-game dependencies','Distribution parameters and correlations are NOT calibrated']};
}
const api={build,simulate,MARKETS,blocked};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.PropVaultGameEngine=api;
})(typeof self!=='undefined'?self:typeof globalThis!=='undefined'?globalThis:this);
