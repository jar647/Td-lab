/* NBA tracking opportunities. Source-backed only: never infer official tracking from box scores. */
(function(root){
 'use strict';
 const finite=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
 function rowsFor(feed,id,tip){
  const entries=feed&&feed.players&&feed.players[String(id)];
  const rows=Array.isArray(entries)?entries:Array.isArray(entries?.games)?entries.games:[];
  return rows.filter(r=>Number.isFinite(Date.parse(r.date))&&Date.parse(r.date)<tip)
   .filter(r=>finite(r.potential_assists)||finite(r.rebound_chances))
   .sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
 }
 function avg(rows,key,n){const values=rows.slice(0,n).map(r=>r[key]).filter(finite);return values.length?values.reduce((a,b)=>a+b,0)/values.length:null}
 function summary(feed,id,tip){
  const rows=rowsFor(feed,id,tip);
  const snapshot=feed?.players?.[String(id)];
  const asOf=Date.parse(feed?.data_as_of||'');
  if(snapshot?.averages&&Number.isFinite(asOf)&&asOf<tip){const a=snapshot.averages;return {count:0,rolling:true,potentialAssists5:a.potential_assists_5??null,potentialAssists10:a.potential_assists_10??null,reboundChances5:a.rebound_chances_5??null,reboundChances10:a.rebound_chances_10??null,assistConversion5:null,reboundConversion5:null};}
  return {count:rows.length,potentialAssists5:avg(rows,'potential_assists',5),
   potentialAssists10:avg(rows,'potential_assists',10),
   reboundChances5:avg(rows,'rebound_chances',5),
   reboundChances10:avg(rows,'rebound_chances',10),
   assistConversion5:ratio(rows,'assists','potential_assists',5),
   reboundConversion5:ratio(rows,'rebounds','rebound_chances',5)};
 }
 function ratio(rows,num,den,n){const v=rows.slice(0,n).filter(r=>finite(r[num])&&finite(r[den])&&r[den]>0);if(!v.length)return null;const d=v.reduce((a,r)=>a+r[den],0);return d?v.reduce((a,r)=>a+r[num],0)/d:null}
 function render(feed,id,tip,escapeHtml){
  const x=summary(feed,id,tip),esc=escapeHtml||String;
  const fmt=v=>v===null?'N/A':v.toFixed(1);
  const pct=v=>v===null?'N/A':(v*100).toFixed(0)+'%';
  if(!x.count&&!x.rolling)return '<p class="muted">Tracking opportunities: unavailable for this player. No estimated figures substituted.</p>';
  const stamp=feed?.generated_at||feed?.generated_at_utc||'not supplied';
  return '<p class="muted"><strong>Opportunity tracking</strong> · '+(x.rolling?'official rolling averages':x.count+' prior games')+' · '+esc(feed.source||'Source unspecified')+' · refreshed '+esc(stamp)+
   '<br>Potential assists L5 / L10: '+fmt(x.potentialAssists5)+' / '+fmt(x.potentialAssists10)+
   ' · Assist conversion L5: '+pct(x.assistConversion5)+
   '<br>Rebound chances L5 / L10: '+fmt(x.reboundChances5)+' / '+fmt(x.reboundChances10)+
   ' · Rebound conversion L5: '+pct(x.reboundConversion5)+'</p>';
 }
 root.CookNBAOpportunities={summary,render};
})(typeof window!=='undefined'?window:globalThis);
