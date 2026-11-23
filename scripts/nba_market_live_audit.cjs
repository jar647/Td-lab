/* Independent read-only smoke audit of the published NBA feed with the current
 * branch's exact production selection engine. Does not place bets or modify data. */
'use strict';
const selection=require('../nba_selection_ui.js');
const base='https://jar647.github.io/Td-lab/';
const markets=['points','rebounds','assists','threes','pr','pa','ra','pra','steals','blocks','stocks'];
const now=Date.now();
const url=path=>new URL(String(path).replace(/^\.\//,''),base).href;
const fetcher=(path,options={})=>fetch(url(path),{...options,cache:'no-store',signal:AbortSignal.timeout(30000)});
(async()=>{
 const provider=selection.create({now:()=>now,fetch:fetcher});
 const report=await provider.getCandidates();
 const audit=report.diagnostics?.marketAudit||{};
 const counts=Object.fromEntries(markets.map(m=>[m,Object.fromEntries(['simulated','eligible','rated','beforeFinalSafety','afterFinalSafety'].map(stage=>[stage,audit[stage]?.[m]||0]))]));
 const out={at:new Date(now).toISOString(),ready:report.ready===true,reason:report.reason||null,
  gamesAnalyzed:report.diagnostics?.gamesAnalyzed??null,modelUnavailableGames:report.diagnostics?.modelUnavailableGames??null,
  qualified:report.candidates?.length||0,counts,preThresholdScoreBands:audit.preScoreBands||{},held:(report.held||[]).slice(0,12)};
 console.log('NBA_MARKET_LIVE_AUDIT '+JSON.stringify(out));
 provider.destroy();
 if(report.ready!==true)console.log('NBA_MARKET_LIVE_AUDIT_UNAVAILABLE: live source refresh or simulation failed; a successful Pages publication alone does not verify predictions.');
})().catch(error=>{
 console.log('NBA_MARKET_LIVE_AUDIT_UNAVAILABLE '+String(error?.stack||error));
});
