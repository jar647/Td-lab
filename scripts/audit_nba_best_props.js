'use strict';
// Diagnostic only. Reads the same published snapshots used by the NBA Best Props UI.
const fs = require('node:fs');
const path = require('node:path');
const gf = require('../nba_game_first');
const matchups = require('../nba_matchup_discovery');
const lines = require('../nba_prop_lines');
const data = name => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', name), 'utf8'));
const feed=data('nba_games.json'), rosters=data('nba_rosters.json'), injuries=data('nba_injuries.json'), context=data('nba_game_context.json');
const now=Date.now(), eastern=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
const today=eastern(now);
const games=feed.games.filter(g=>g.status==='STATUS_SCHEDULED'&&Date.parse(g.date)>now&&eastern(Date.parse(g.date))===today);
const stat={games:games.length,research:0,qualifiedResearch:0,rawSimulationRows:0,eligibleRows:0,candidateRows:0,simScoreAboveMinimum:0,roles:0,heldRoles:0,modelFailures:0,researchFailures:0};
console.log('TIME',new Date(now).toISOString(),'ET',today);
console.log('SNAPSHOTS',JSON.stringify({games:feed.generated_at,rosters:rosters.generated_at,injuries:injuries.generated_at,context:context.generated_at,scheduled:games.length,final:feed.games.filter(g=>g.status==='STATUS_FINAL').length}));
for(const g of games){
 let research,sim;
 try{research=matchups.analyze(g,feed,rosters,injuries,now,{context});}catch(e){stat.researchFailures++;console.log('MATCHUP_EXCEPTION',g.id,e.message);continue;}
 try{sim=gf.analyze(g,feed,injuries,rosters,context,now,{count:1000});}catch(e){stat.modelFailures++;console.log('SIM_EXCEPTION',g.id,e.message);continue;}
 const eligible=(sim.rows||[]).filter(x=>x.eligible&&!x.reviewRequired), scored=(sim.rows||[]).filter(x=>lines.qualifiesScore(x.matchupRating?.score,x.market));
 const qualified=(research.candidates||[]).filter(x=>lines.qualifiesScore(x.researchScore,x.market));
 const cand=(sim.rows||[]).map(x=>gf.candidate(x)).filter(Boolean);
 for(const r of (sim.rows||[]).filter(x=>x.eligible&&!x.reviewRequired&&lines.qualifiesScore(x.matchupRating?.score,x.market))){
   const chosen=r.selectedLineEvidence||{},line=chosen.line,boosted=gf.candidate({...r,matchupBoost:Math.max(.001,Math.abs(r.matchupBoost||0))});
   console.log('ELIGIBLE_DEBUG',JSON.stringify({game:g.id,player:r.name,market:r.market,score:r.matchupRating?.score,forecast:r.forecast,boost:r.matchupBoost,matchupGames:r.matchupGames,samples:r.samples?.length,selected:chosen.available,selectedReason:chosen.reason,selectedLine:line,side:r.side,roleSupported:r.roleEvidence?.roleStatus,roleEligible:r.roleEvidence?.eligible,probability:Number.isFinite(line)&&r.samples?.length?r.samples.filter(x=>x>line).length/r.samples.length:null,acceptedWithPositiveBoost:Boolean(boosted),candidateAccepted:Boolean(gf.candidate(r))}));
 }

 if(sim.reason)stat.modelFailures++;
 if(research.ready!==true)stat.researchFailures++;
 const roles=Object.values(research.roleEvidence?.players||{}), held=roles.filter(x=>!x.eligible);
 const topHoldReasons=Object.entries(held.flatMap(x=>x.holdReasons||[]).reduce((a,r)=>(a[r]=(a[r]||0)+1,a),{})).sort((a,b)=>b[1]-a[1]).slice(0,5);
 stat.research+=(research.candidates||[]).length;stat.qualifiedResearch+=qualified.length;
 stat.rawSimulationRows+=(sim.rows||[]).length;stat.eligibleRows+=eligible.length;stat.simScoreAboveMinimum+=scored.length;stat.candidateRows+=cand.length;
 stat.roles+=roles.length;stat.heldRoles+=held.length;
 console.log('GAME',JSON.stringify({id:g.id,match:g.away+' @ '+g.home,starts:g.date,ready:research.ready,researchReason:research.reason,rotationReady:research.roleSummary?.ready,rotationReason:research.roleSummary?.reason,coverage:research.coverage,roles:roles.length,roleHeld:held.length,holds:topHoldReasons,research:(research.candidates||[]).length,qualifiedResearch:qualified.length,bestResearch:research.candidates?.slice(0,3).map(x=>({name:x.name,market:x.market,score:x.researchScore})),simReason:sim.reason,simRows:sim.rows?.length,simEligible:eligible.length,simAboveScore:scored.length,accepted:cand.length,highestScores:sim.rows?.filter(x=>Number.isFinite(x.matchupRating?.score)).sort((a,b)=>b.matchupRating.score-a.matchupRating.score).slice(0,3).map(x=>({name:x.name,market:x.market,score:x.matchupRating.score,eligible:x.eligible,review:x.reviewRequired})),acceptedExamples:cand.slice(0,2).map(x=>({name:x.name,market:x.market,score:x.score,line:x.line,prob:x.probability}))}));
}
console.log('TOTAL',JSON.stringify(stat));

async function verifyPublishedSelection(){
 const selection=require('../nba_selection_ui');
 const autoAlt=require('../nba_auto_alt_ui');
 const snapshots={'./data/nba_games.json':feed,'./data/nba_rosters.json':rosters,'./data/nba_injuries.json':injuries,'./data/nba_game_context.json':context};
 const provider=selection.create({now:()=>now,fetch:async url=>({ok:true,json:async()=>snapshots[url]})});
 const result=await provider.getCandidates();
 const shortlisted=autoAlt.shortlist(result.candidates||[]);
 const sourceAgeMinutes=Object.fromEntries([['games',feed],['rosters',rosters],['injuries',injuries]].map(([k,v])=>[k,Math.round((now-Date.parse(v.generated_at))/60000)]));
 const verdict=!result.ready?'PROVIDER_NOT_READY':shortlisted.length?'QUALIFYING_MODEL_RESEARCH_AVAILABLE':stat.researchFailures||stat.modelFailures?'ZERO_PROPS_INCOMPLETE_EVIDENCE':stat.qualifiedResearch?'ZERO_PROPS_REQUIRES_EXCLUSION_REVIEW':'ZERO_SUPPORTED_MATCHUP_SCORES_NOT_ALL_REAL_WORLD_PROPS';
 console.log('PROVIDER',JSON.stringify({ready:result.ready,reason:result.reason,passed:result.candidates?.length||0,shortlisted:shortlisted.length,legs:shortlisted.map(r=>({player:r.name,market:r.market,score:r.score,line:r.line,probability:r.probability}))}));
 console.log('AUDIT_VERDICT',JSON.stringify({verdict,sourceAgeMinutes,scheduledGames:games.length,modelFailures:stat.modelFailures,researchFailures:stat.researchFailures,qualifiedResearch:stat.qualifiedResearch,eligibleSimulationRows:stat.eligibleRows,qualifiedSimulationRows:stat.simScoreAboveMinimum,modelCandidates:stat.candidateRows,displayed:shortlisted.length,sportsbookLinesVerified:false,probabilitiesCalibrated:false}));

 if(result.ready!==true)throw Error('Selection provider is not ready: '+result.reason);
 if(stat.candidateRows>0&&shortlisted.length===0)throw Error('Eligible simulated props were rejected by the UI selection provider');
 provider.destroy();
}
verifyPublishedSelection().catch(err=>{console.error('PROVIDER_ERROR',err.stack||err.message);process.exitCode=1});
