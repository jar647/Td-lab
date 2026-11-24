/* Read-only, independent market benchmark. Quotes are fetched only after forecasts exist. */
'use strict';
const fs=require('node:fs'),engine=require('../nba_possession_engine.js'),strength=require('./nba_spread_strength_research.cjs');
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const norm=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]/g,'');
function line(v){if(typeof v==='string'&&/^(pk|even)$/i.test(v.trim()))return 0;if(typeof v!=='number'&&(typeof v!=='string'||!/^[-+]?\d+(?:\.\d+)?$/.test(v.trim())))return null;const n=Number(v);return Number.isFinite(n)&&Math.abs(n)<=60&&Number.isInteger(n*2)?n:null;}
function closingQuote(data,r){
 const h=data?.header,comp=h?.competitions?.find(c=>String(c.id)===String(r.game_id));
 if(String(h?.id)!==String(r.game_id)||!comp?.status?.type?.completed||comp.status.type.name!=='STATUS_FINAL')throw Error('Final fixture not verified');
 const teams=comp.competitors||[],home=teams.find(t=>t.homeAway==='home'),away=teams.find(t=>t.homeAway==='away');
 if(!home||!away||norm(home.team?.displayName)!==norm(r.home)||norm(away.team?.displayName)!==norm(r.away)||Date.parse(comp.date)!==Date.parse(r.start)||Number(home.score)!==r.actual.home||Number(away.score)!==r.actual.away)throw Error('Closing source fixture, tipoff or score mismatch');
 // Fixed provider policy: only explicit pregame DraftKings close fields; never substitute current or opening prices.
 const rows=(data.pickcenter||[]).filter(x=>norm(x.provider?.name)==='draftkings');
 const valid=rows.map(x=>{
  const h=x.pointSpread?.home?.close,a=x.pointSpread?.away?.close;
  const hs=line(h?.line),as=line(a?.line);
  if(hs===null||as===null||hs!==-as)return null;
  const price=v=>{const n=Number(v);return Number.isInteger(n)&&Math.abs(n)>=100&&Math.abs(n)<=10000?n:null;};
  return {provider:'DraftKings',home_spread:hs,away_spread:as,home_price:price(h?.odds),away_price:price(a?.odds)};
 }).filter(Boolean);
 if(!valid.length)throw Error('Explicit paired DraftKings closing spread unavailable');
 if(new Set(valid.map(x=>JSON.stringify(x))).size!==1)throw Error('Conflicting closing quotes');
 return valid[0];
}
function summarize(rows){
 const paired=rows.filter(r=>r.quote&&r.actual&&finite(r.baseline)&&finite(r.candidate));
 const scores=name=>{const errors=paired.map(r=>(name==='market'?-r.quote.home_spread:r[name])-(r.actual.home-r.actual.away));return {margin_mae:mean(errors.map(Math.abs)),margin_bias:mean(errors),rmse:errors.length?Math.sqrt(mean(errors.map(e=>e*e))):null};};
 const compare=(name)=>{let wins=0,losses=0,ties=0;const gaps=[];
  for(const r of paired){const actual=r.actual.home-r.actual.away,market=-r.quote.home_spread,delta=r[name]-market;gaps.push(Math.abs(delta));const a=Math.abs(r[name]-actual),b=Math.abs(market-actual);if(a<b)wins++;else if(a>b)losses++;else ties++;}
  return {closer_than_market:wins,farther_than_market:losses,equal:ties,mean_absolute_market_gap:mean(gaps),within_3_points:mean(gaps.map(x=>Number(x<=3))),over_7_points:mean(gaps.map(x=>Number(x>7)))};};
 const ats=name=>{let win=0,loss=0,push=0,pass=0,net=0,priced=0;
  for(const r of paired){const gap=r[name]+r.quote.home_spread;if(Math.abs(gap)<3){pass++;continue;}const home=gap>0,settle=(r.actual.home-r.actual.away+r.quote.home_spread)*(home?1:-1),price=home?r.quote.home_price:r.quote.away_price;if(settle>0)win++;else if(settle<0)loss++;else push++;if(price!==null){priced++;net+=settle>0?(price>0?price/100:100/-price):settle<0?-1:0;}}
  return {win,loss,push,pass,hit_rate:win+loss?win/(win+loss):null,priced,diagnostic_roi:priced?net/priced:null};};
 return {eligible:rows.length,matched:paired.length,missing:rows.length-paired.length,baseline:scores('baseline'),candidate:scores('candidate'),market:scores('market'),baseline_comparison:compare('baseline'),candidate_comparison:compare('candidate'),baseline_gap3_ats:ats('baseline'),candidate_gap3_ats:ats('candidate')};
}
function historical(feed){
 const rows=[],skipped=[];
 for(const g of engine.records(feed,Infinity).slice(0,80).reverse()){
  try{const tip=Date.parse(g.date),earlier={...feed,games:feed.games.filter(x=>Date.parse(x.date)<tip-86400000)},rating=strength.fit(engine.records(earlier,tip));
   if(!finite(rating.rating[g.home])||!finite(rating.rating[g.away]))throw Error('Missing team rating');
   const model=engine.build({...g,status:'STATUS_SCHEDULED'},earlier,{injuries:[]},{},tip-1,{historical:true}),draw=engine.draws(model,1000,6472026);
   rows.push({game_id:String(g.id),home:g.home,away:g.away,start:g.date,actual:{home:g.h.pts,away:g.a.pts},baseline:mean(draw.home.map((x,i)=>x-draw.away[i])),candidate:rating.rating[g.home]-rating.rating[g.away]+(String(g.neutralSite)==='true'?0:rating.home)});
  }catch(e){skipped.push({game_id:String(g.id),reason:e.message});}
 }
 return {rows,skipped};
}
function prospective(ledger,feed){
 const finals=new Map(engine.records(feed,Infinity).map(g=>[String(g.id),g]));
 return (ledger.records||[]).filter(r=>r.sport==='NBA'&&r.version==='nba-possession-strength-prospective-v1').flatMap(r=>{
  const g=finals.get(r.game_id);
  if(!g||g.home!==r.home||g.away!==r.away||Date.parse(g.date)!==Date.parse(r.start)||!finite(r.baseline?.margin)||!finite(r.candidate?.margin)||Date.parse(r.captured_at)>=Date.parse(r.start))return [];
  return [{game_id:r.game_id,home:r.home,away:r.away,start:r.start,captured_at:r.captured_at,actual:{home:g.h.pts,away:g.a.pts},baseline:r.baseline.margin,candidate:r.candidate.margin}];
 });
}
async function main(){
 const feed=JSON.parse(fs.readFileSync('data/nba_games.json')),ledger=JSON.parse(fs.readFileSync('data/nba_spread_prospective.json'));
 const hist=historical(feed),fresh=prospective(ledger,feed),cache=new Map();
 for(const r of [...hist.rows,...fresh]){
  if(!cache.has(r.game_id)){
   const url='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event='+encodeURIComponent(r.game_id);
   try{const response=await fetch(url,{signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('HTTP '+response.status);cache.set(r.game_id,{quote:closingQuote(await response.json(),r),source_url:url});}
   catch(e){cache.set(r.game_id,{quote:null,reason:e.message,source_url:url});}
  }
  Object.assign(r,cache.get(r.game_id));
 }
 const dates=[...new Set(hist.rows.map(r=>r.start.slice(0,10)))].sort(),cutoff=dates[Math.floor(dates.length*2/3)];
 const report={status:'RESEARCH_ONLY',generated_at:new Date().toISOString(),provider:'ESPN explicit DraftKings closing spread',historical_diagnostic:summarize(hist.rows.filter(r=>r.start.slice(0,10)>=cutoff)),historical_development:summarize(hist.rows.filter(r=>r.start.slice(0,10)<cutoff)),prospective:summarize(fresh),historical_skipped:hist.skipped,rows:{historical:hist.rows,prospective:fresh},limits:'Historical replay uses reused games, 1000 draws, no historical injury snapshots, 24h embargo; prospective predictions are frozen before tipoff. Closing quotes used only for grading, not inputs. Gap-3 ATS/ROI at closing quotes is diagnostic, not executable profit. No claim of calibration, no model promotion. Missing explicit quotes excluded, never imputed.'};
 console.log(JSON.stringify(report,null,2));
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1});
module.exports={closingQuote,summarize,prospective};
