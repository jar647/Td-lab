/* Saved-pick smart shortlist: heuristic research only, no invented joint probabilities. */
(function(root){
'use strict';
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key=(p,i)=>p.key||[p.sport,p.game,p.player,p.market,p.line,i].join('|');
const number=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
function confidence(p){const scenario=number(p.scenarioRate);const sample=number(p.sampleSize),hits=number(p.sampleHits);return {scenario:scenario!==null&&scenario>=0&&scenario<=1?scenario:null,sample:sample>0&&hits!==null?hits/sample:null,score:number(p.propScore)??number(p.researchScore)??number(p.matchupConfidence)}}
function relation(a,b){
 if(String(a.sport)!==String(b.sport))return null;
 const sameGame=a.gameId&&b.gameId?String(a.gameId)===String(b.gameId):a.game&&b.game&&String(a.game)===String(b.game);
 if(!sameGame)return null;
 const sameTeam=a.team&&b.team&&a.team===b.team;
 const passing=p=>/pass|rec|catch/i.test(String(p.market||'')+' '+String(p.recommendation||''));
 const qb=p=>/pass/i.test(String(p.market||'')+' '+String(p.recommendation||''));
 const rec=p=>/rec|catch/i.test(String(p.market||'')+' '+String(p.recommendation||''));
 if(sameTeam&&((qb(a)&&rec(b))||(qb(b)&&rec(a))))return {kind:'Shared passing offense',detail:'QB passing production and receiver production may move together; verify with joint game simulation.'};
 if(sameTeam&&passing(a)&&passing(b))return {kind:'Shared team passing volume',detail:'Players depend on the same offense and may compete for targets.'};
 return {kind:'Same-game dependence',detail:'These legs share a game. Direction and strength require aligned simulation outcomes.'};
}
function rank(p){const c=confidence(p);return c.score!==null?c.score/100:c.scenario!==null?c.scenario:c.sample!==null?c.sample*0.7:0}
function mount({host,slip}){
 let selected=new Set(),placed=[],stamp=0;
 try{placed=JSON.parse(localStorage.getItem('prop_shop_placed_slips_v1')||'[]');if(!Array.isArray(placed))placed=[]}catch(_){}
 host.innerHTML='<h3>Smart Slip Analyzer</h3><p class="quick-slip-help">Choose 2–5 saved picks. Correlation flags are qualitative, not simulated probabilities. The existing ticket simulator handles eligible exact NFL lines.</p><div data-smart-picks></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" data-smart-build>Suggest 5 legs</button><button type="button" data-smart-check>Analyze selection</button></div><div data-smart-results role="status" aria-live="polite"></div><details><summary>Placed slips · local tracking</summary><p class="quick-slip-help">Save only picks you actually placed. No automatic settlement or sportsbook integration.</p><div data-smart-placed></div></details>';
 const list=host.querySelector('[data-smart-picks]'),out=host.querySelector('[data-smart-results]'),history=host.querySelector('[data-smart-placed]');
 function picks(){return slip.getPicks().map((p,i)=>({...p,_key:key(p,i)}))}
 function showHistory(){history.innerHTML=placed.length?placed.map((s,i)=>'<p><b>'+escape(s.date)+'</b> · '+s.picks.length+' legs · '+escape(s.status||'Pending')+' <button type="button" data-smart-grade="'+i+'" data-grade="won">Won</button> <button type="button" data-smart-grade="'+i+'" data-grade="lost">Lost</button> <button type="button" data-smart-grade="'+i+'" data-grade="push">Push</button><br>'+s.picks.map(p=>escape(p.player+' '+p.prop)).join(' · ')+'</p>').join(''):'<p>No placed slips recorded.</p>'}
 function render(){const ps=picks(),valid=new Set(ps.map(p=>p._key));selected=new Set([...selected].filter(k=>valid.has(k)));list.innerHTML=ps.map((p,i)=>'<label style="display:flex;align-items:center;gap:8px;margin:8px 0"><input type="checkbox" style="width:auto" data-smart-pick="'+i+'" '+(selected.has(p._key)?'checked':'')+'><span>'+escape(p.player)+' · '+escape(p.recommendation||p.market||'prop')+'</span></label>').join('')||'<p>Save player props to use the analyzer.</p>';showHistory()}
 function analyze(){const ps=picks().filter(p=>selected.has(p._key));if(ps.length<2||ps.length>5){out.textContent='Select 2–5 legs.';return}const related=[];for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++){const r=relation(ps[i],ps[j]);if(r)related.push({a:ps[i].player,b:ps[j].player,...r})}
 const weakest=[...ps].sort((a,b)=>rank(a)-rank(b))[0],c=confidence(weakest);
 out.innerHTML='<h4>Selected: '+ps.length+' legs</h4><p><b>Review first:</b> '+escape(weakest.player)+' · '+escape(weakest.recommendation||weakest.market)+' ('+(c.score!==null?'research score '+c.score+'/100':c.scenario!==null?'uncalibrated scenario '+(c.scenario*100).toFixed(1)+'%':c.sample!==null?'small-sample rate '+(c.sample*100).toFixed(0)+'%':'insufficient evidence')+'). Ranking is a research heuristic, not a calibrated weakest-leg probability.</p><h4>Correlation alerts</h4>'+(related.length?related.map(r=>'<p><b>'+escape(r.a)+' + '+escape(r.b)+': '+escape(r.kind)+'</b><br>'+escape(r.detail)+'</p>').join(''):'<p>No shared-game pairs identified from saved metadata; missing game identifiers may hide dependencies.</p>')+'<p>Do not multiply displayed scenario percentages to price this slip. Use the exact joint simulator when supported, and enter actual combined sportsbook odds there.</p><button type="button" data-smart-place>Record these as placed</button>';
 }
 list.addEventListener('change',e=>{const n=e.target.dataset.smartPick;if(n===undefined)return;const p=picks()[Number(n)];if(!p)return;if(e.target.checked){if(selected.size>=5){e.target.checked=false;out.textContent='Maximum five legs.';return}selected.add(p._key)}else selected.delete(p._key);out.textContent='Selection updated. Analyze again.'});
 host.querySelector('[data-smart-build]').addEventListener('click',()=>{const ps=[...picks()].sort((a,b)=>rank(b)-rank(a)),chosen=[];for(const p of ps){if(chosen.length>=5)break;const samePlayer=chosen.some(q=>q.sport===p.sport&&q.player===p.player);if(!samePlayer)chosen.push(p)}selected=new Set(chosen.map(p=>p._key));render();analyze()});
 host.querySelector('[data-smart-check]').addEventListener('click',analyze);
 host.addEventListener('click',e=>{if(e.target.matches('[data-smart-place]')){const ps=picks().filter(p=>selected.has(p._key));if(ps.length<2||ps.length>5)return;placed.unshift({date:new Date().toISOString(),status:'Pending',picks:ps.map(p=>({player:p.player,prop:p.recommendation||p.market,key:p._key}))});placed=placed.slice(0,100);localStorage.setItem('prop_shop_placed_slips_v1',JSON.stringify(placed));showHistory();out.textContent='Placed slip recorded locally. Grade it after results are final.'}const index=e.target.dataset.smartGrade;if(index!==undefined&&placed[Number(index)]){placed[Number(index)].status=e.target.dataset.grade;localStorage.setItem('prop_shop_placed_slips_v1',JSON.stringify(placed));showHistory()}});
 slip.onChange(()=>{render();out.textContent='Saved picks changed. Reanalyze your selection.'});render();
 return {render,analyze};
}
root.PropShopSmartSlip={mount,relation,confidence,rank};
if(typeof module==='object'&&module.exports)module.exports={relation,confidence,rank};
})(typeof window!=='undefined'?window:globalThis);
