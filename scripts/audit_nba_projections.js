/* Walk-forward audit: every predictor sees only games strictly before tipoff.
 * Historical injury/lineup announcements are unavailable; report DNP separately.
 * Development/validation split is chronological and includes no target-game inputs. */
'use strict';
const fs=require('fs'),path=require('path');
function audit(feed,engine,options={}){
 const count=options.runs||1000,days=[...new Set(feed.games.filter(g=>g.status==='STATUS_FINAL'&&g.season_type===2).map(g=>g.date.slice(0,10)))].sort();
 const snapshots=new Map((options.snapshots||[]).filter(s=>Date.parse(s.locked_at)<Date.parse(s.tipoff)&&Date.parse(s.input_timestamps?.games)<=Date.parse(s.locked_at)&&Date.parse(s.input_timestamps?.injuries)<=Date.parse(s.locked_at)&&Date.parse(s.locked_at)-Date.parse(s.input_timestamps?.injuries)<=12*3600000).map(s=>[String(s.game_id),s]));
 const split=days[Math.floor(days.length*.65)],rows=[],failures=[],games=[];
 const avg=a=>a.reduce((s,x)=>s+x,0)/Math.max(1,a.length),minutes=p=>{const x=String(p?.stats?.MIN||'0').split(':').map(Number);return x[0]+(x[1]||0)/60;};
 for(const g of [...feed.games].filter(g=>g.status==='STATUS_FINAL'&&g.season_type===2&&(!options.gameIds||options.gameIds.includes(g.id))&&(!options.snapshots||snapshots.has(String(g.id)))).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date))){
  try{
   const snapshot=snapshots.get(String(g.id)),now=Math.min(Date.parse(g.date)-1,snapshot?Date.parse(snapshot.input_timestamps.games):Infinity),safeFeed={...feed,games:feed.games.filter(h=>h.status!=='STATUS_FINAL'||Date.parse(h.date)+4*3600000<=now)},model=engine.build({...g,status:'STATUS_SCHEDULED'},safeFeed,{injuries:[]},{},now,{historical:true});
   if(snapshot)for(const [team,t] of Object.entries(model.teams)){const norm=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]/g,''),absent=new Set((snapshot.team_context[team]?.absences||[]).map(norm));t.players=t.players.filter(p=>!absent.has(norm(p.name)));t.minutes=engine.rotationMinutes?engine.rotationMinutes(t.players):engine.allocate(Object.fromEntries(t.players.map(p=>[p.id,p.weight])));if(!t.minutes)throw Error('Frozen absence scenario lacks supported rotation');}
   const r=engine.draws(model,count,6472026);
   const fold=g.date.slice(0,10)>=split?'validation':'development';
   const history=safeFeed.games.filter(h=>h.status==='STATUS_FINAL'&&h.season_type===2&&Date.parse(h.date)<now);
   for(const predicted of r.players){
    const actual=g.players.find(p=>String(p.id)===String(predicted.id)&&p.team===predicted.team),active=actual&&!actual.didNotPlay&&minutes(actual)>0;
    const prior=history.filter(h=>[h.home,h.away].includes(predicted.team)).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)).flatMap(h=>(h.players||[]).filter(p=>String(p.id)===String(predicted.id)&&p.team===predicted.team&&!p.didNotPlay&&minutes(p)>0)).slice(0,5);
    if(prior.length<3)continue;
    const keys={points:'PTS',rebounds:'REB',assists:'AST',minutes:'MIN'};
    for(const [market,key] of Object.entries(keys)){
     const value=active?(market==='minutes'?minutes(actual):Number(actual.stats[key])):0;
     if(!Number.isFinite(value))continue;
     const vals=prior.map(p=>market==='minutes'?minutes(p):Number(p.stats[key])).filter(Number.isFinite);
     const baseline=avg(vals);
     rows.push({game:g.id,date:g.date,fold,player:predicted.player,playerId:predicted.id,team:predicted.team,market,prediction:predicted[market],baseline,actual:value,active:!!active,actualMinutes:active?minutes(actual):0});
    }
   }
   games.push({game:g.id,fold,home:g.home,away:g.away,points:avg(r.home)+avg(r.away),actualPoints:g.players.filter(p=>!p.didNotPlay).reduce((s,p)=>s+Number(p.stats.PTS||0),0),rebounds:r.players.reduce((s,p)=>s+p.rebounds,0),actualRebounds:g.players.filter(p=>!p.didNotPlay).reduce((s,p)=>s+Number(p.stats.REB||0),0),assists:r.players.reduce((s,p)=>s+p.assists,0),actualAssists:g.players.filter(p=>!p.didNotPlay).reduce((s,p)=>s+Number(p.stats.AST||0),0),blowoutRate:r.blowoutRate,actualBlowout:Math.abs(g.players.filter(p=>p.team===g.home&&!p.didNotPlay).reduce((s,p)=>s+Number(p.stats.PTS||0),0)-g.players.filter(p=>p.team===g.away&&!p.didNotPlay).reduce((s,p)=>s+Number(p.stats.PTS||0),0))>=18});
  }catch(e){failures.push({game:g.id,reason:e.message})}
 }
 const metrics=rs=>rs.length?({n:rs.length,mae:avg(rs.map(r=>Math.abs(r.prediction-r.actual))),baselineMae:avg(rs.map(r=>Math.abs(r.baseline-r.actual))),bias:avg(rs.map(r=>r.prediction-r.actual)),baselineBias:avg(rs.map(r=>r.baseline-r.actual)),rmse:Math.sqrt(avg(rs.map(r=>(r.prediction-r.actual)**2)))}):{n:0,mae:null,baselineMae:null,bias:null,baselineBias:null,rmse:null};
 const folds={};for(const fold of ['development','validation']){const xs=rows.filter(r=>r.fold===fold&&r.active),gs=games.filter(g=>g.fold===fold);folds[fold]={games:gs.length,activePlayerMetrics:Object.fromEntries(['points','rebounds','assists','minutes'].map(k=>[k,metrics(xs.filter(r=>r.market===k))])),rotationPlayerMetrics:Object.fromEntries(['points','rebounds','assists','minutes'].map(k=>[k,metrics(rows.filter(r=>r.fold===fold&&r.market===k))])),gameTotals:Object.fromEntries(['points','rebounds','assists'].map(k=>[k,{predicted:avg(gs.map(g=>g[k])),actual:avg(gs.map(g=>g['actual'+k[0].toUpperCase()+k.slice(1)]))}]))};}
 return {model:engine.VERSION,runs:count,availabilityMode:options.snapshots?'Dated frozen absence snapshots; no reconstructed future availability':'Historical availability unknown',sourceGeneratedAt:feed.generated_at,splitDate:split,folds,limitations:'Retrospective walk-forward box scores only. Historical injury/lineup announcements unavailable; this does not validate current availability adjustments or betting probabilities. A conservative four-hour completion buffer excludes games that might still have been in progress at the forecast cutoff. Chronological validation is an internal holdout, not independent external validation.',observations:options.includeRows?rows:undefined,excludedGames:failures.length,largestValidationErrors:rows.filter(r=>r.fold==='validation'&&r.active&&r.market==='rebounds').sort((a,b)=>Math.abs(b.prediction-b.actual)-Math.abs(a.prediction-a.actual)).slice(0,12),failures};
}
if(require.main===module){const enginePath=process.argv[2]||path.resolve(__dirname,'../nba_possession_engine'),output=process.argv[3],feed=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../data/nba_games.json'))),report=audit(feed,require(enginePath),{includeRows:true,snapshots:process.argv[4]?JSON.parse(fs.readFileSync(process.argv[4])).snapshots:undefined});if(output)fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({model:report.model,splitDate:report.splitDate,folds:report.folds,excludedGames:report.excludedGames},null,2));}
module.exports={audit};
