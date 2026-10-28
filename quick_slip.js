/* CoOk It Up local quick-slip organizer. Picks stay on this device. */
(function(root){
 'use strict';
 const KEY='cookitup_quick_slip_v1';
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const encode=value=>encodeURIComponent(JSON.stringify(value)).replace(/'/g,'%27');
 const decode=value=>JSON.parse(decodeURIComponent(value));
 let picks=[];
 try{const saved=JSON.parse(root.localStorage?.getItem(KEY)||'[]');if(Array.isArray(saved))picks=saved}catch(_){}
 let panel,launcher;
 function save(){try{root.localStorage?.setItem(KEY,JSON.stringify(picks))}catch(_){}update()}
 function button(pick){return '<button type="button" class="quick-slip-add" data-quick-slip="'+encode(pick)+'">＋ Add to Quick Slip</button>'}
 function createButton(pick){
  const el=root.document.createElement('button');el.type='button';el.className='quick-slip-add';el.dataset.quickSlip=encode(pick);el.textContent='＋ Add to Quick Slip';return el;
 }
 function addFromButton(button){
  let pick;try{pick=decode(button.dataset.quickSlip)}catch(_){return}
  for(const [inputKey,valueKey] of [['lineInputId','line'],['overOddsInputId','overOdds'],['underOddsInputId','underOdds']]){
   const input=pick[inputKey]&&root.document?.getElementById(pick[inputKey]);
   if(input)pick[valueKey]=input.value.trim()||null;
   delete pick[inputKey];
  }
  const key=[pick.sport,pick.game,pick.player,pick.market,pick.recommendationLine??pick.line??''].join('|').toLowerCase();
  const exists=picks.findIndex(p=>p.key===key);
  if(exists>=0)picks[exists]={...picks[exists],...pick,key};else picks.push({...pick,key});
  save();
  const old=button.textContent;button.textContent='Added ✓';button.classList.add('is-added');
  setTimeout(()=>{if(button.isConnected){button.textContent=old;button.classList.remove('is-added')}},1200);
 }
 function recommendation(pick){
  if(pick.recommendation)return pick.recommendation;
  const line=pick.recommendationLine??pick.line;
  const market=pick.market||'Player prop';
  if(line===null||line===undefined||line==='')return market;
  const numeric=Number(line);
  return Number.isFinite(numeric)?(Number.isInteger(numeric)?numeric+'+ '+market:'Over '+numeric+' '+market):String(line)+' '+market;
 }
 function row(pick,index){
  const has=(value)=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
  const sample=has(pick.sampleHits)&&has(pick.sampleSize)&&Number(pick.sampleSize)>0
   ?'<span class="quick-slip-sample">Sample '+esc(pick.sampleHits)+'/'+esc(pick.sampleSize)+' ('+(100*Number(pick.sampleHits)/Number(pick.sampleSize)).toFixed(0)+'%)</span>':'';
  const scenario=has(pick.scenarioRate)
   ?'<span class="quick-slip-sample">Scenario '+(100*Number(pick.scenarioRate)).toFixed(1)+'% · uncalibrated</span>':'';
  const matchup=has(pick.matchupEdge)
   ?'<span class="quick-slip-sample">Matchup '+(Number(pick.matchupEdge)>=0?'+':'')+(100*Number(pick.matchupEdge)).toFixed(0)+'% vs sample</span>':'';
  const edge=has(pick.estimatedEdge)
   ?'<span class="quick-slip-edge">Edge '+(Number(pick.estimatedEdge)>=0?'+':'')+(100*Number(pick.estimatedEdge)).toFixed(1)+'% vs '+esc(pick.edgeBasis||'price')+' · uncalibrated</span>':'';
  return '<article class="quick-slip-row"><div class="quick-slip-pick"><div><strong>'+esc(pick.player||'Player')+'</strong><div class="quick-slip-recommendation">'+esc(recommendation(pick))+'</div><div class="quick-slip-evidence">'+sample+matchup+scenario+edge+'</div></div><button type="button" class="quick-slip-remove" aria-label="Remove '+esc(pick.player||'player')+' from Quick Slip" data-slip-remove="'+index+'">×</button></div></article>';
 }
 function update(){
  if(!panel||!launcher)return;
  const count=panel.querySelector('[data-slip-count]');if(count)count.textContent=String(picks.length);
  launcher.textContent='Quick Slip · '+picks.length;
  const list=panel.querySelector('[data-slip-list]');if(!list)return;
  list.innerHTML=picks.length?picks.map(row).join(''):'<p class="quick-slip-empty">Your slip is empty. Tap “Add to Quick Slip” beside a recommendation.</p>';
 }
 function open(){panel?.scrollIntoView({behavior:'smooth',block:'start'})}
 function remove(index){picks.splice(index,1);save()}
 function mount(){
  if(root.document.getElementById('quickSlipPanel'))return;
  const style=root.document.createElement('style');
  style.textContent='.quick-slip-panel{scroll-margin-top:18px;border:1px solid #42a77a;background:#10291e;border-radius:14px;padding:16px;margin:14px 0;color:#eafff4}.quick-slip-panel h2{margin:0 0 6px}.quick-slip-help,.quick-slip-meta{font-size:12px;line-height:1.5;color:#a9c7b7}.quick-slip-row{border-top:1px solid #315644;padding:12px 0}.quick-slip-pick{display:flex;justify-content:space-between;align-items:center;gap:12px}.quick-slip-pick strong{font-size:16px}.quick-slip-recommendation{font-weight:750;color:#72f1b8;margin-top:3px}.quick-slip-evidence{display:flex;flex-wrap:wrap;gap:5px 12px;margin-top:4px}.quick-slip-sample,.quick-slip-edge{font-size:12px;line-height:1.5;color:#a9c7b7}.quick-slip-edge{color:#ffce7d}.quick-slip-add{display:inline-block;margin:8px 0;padding:9px 12px;border:1px solid #269b69;border-radius:9px;background:#123927;color:#72f1b8;font-weight:800;cursor:pointer}.quick-slip-add.is-added{background:#1b8259;color:white}.quick-slip-remove,.quick-slip-clear{border:1px solid #55705f;border-radius:8px;background:#16281e;color:#eafff4;padding:5px 10px;cursor:pointer}.quick-slip-remove{width:34px;height:34px;flex:none;font-size:23px;line-height:1}.quick-slip-launcher{position:fixed;right:14px;bottom:18px;z-index:10000;border:1px solid #68f3b4;border-radius:999px;background:#0f3525;color:#88ffbf;padding:12px 16px;font-weight:900;box-shadow:0 5px 20px #0008}.quick-slip-empty{color:#b6cfc0}.quick-slip-warning{color:#ffce7d;font-size:12px;margin:8px 0}';
  root.document.head.appendChild(style);
  panel=root.document.createElement('section');panel.id='quickSlipPanel';panel.className='quick-slip-panel';
  panel.innerHTML='<h2>Quick Slip <span data-slip-count>0</span></h2><p class="quick-slip-help">Your saved player props in one place. Enter every selection manually in your sportsbook.</p><div data-slip-list></div><p class="quick-slip-warning">Research organizer only. Check the live line, price, player status, and parlay eligibility yourself. Nothing is sent to Hard Rock.</p><button type="button" class="quick-slip-clear">Clear slip</button>';
  const main=root.document.querySelector('main');if(main)main.prepend(panel);else root.document.body.prepend(panel);
  launcher=root.document.createElement('button');launcher.type='button';launcher.id='quickSlipLauncher';launcher.className='quick-slip-launcher';launcher.textContent='Quick Slip · 0';launcher.setAttribute('aria-label','Open Quick Slip');
  if(root.document.querySelector('.foot'))launcher.style.bottom='calc(88px + env(safe-area-inset-bottom))';
  root.document.body.appendChild(launcher);
  root.document.addEventListener('click',event=>{
   const addButton=event.target.closest?.('.quick-slip-add');if(addButton){addFromButton(addButton);return}
   if(event.target.closest?.('#quickSlipLauncher')){open();return}
   const removeButton=event.target.closest?.('[data-slip-remove]');if(removeButton){remove(Number(removeButton.dataset.slipRemove));return}
   if(event.target.closest?.('.quick-slip-clear')){picks=[];save()}
  });
  update();
 }
 const api={button,createButton,addFromButton,formatRecommendation:recommendation,add:pick=>{const b={dataset:{quickSlip:encode(pick)},textContent:'Added',classList:{add(){}},isConnected:false};addFromButton(b)},open,clear:()=>{picks=[];save()},getPicks:()=>picks.map(x=>({...x}))};
 root.CookItUpQuickSlip=api;
 if(root.document)mount();
})(typeof window!=='undefined'?window:globalThis);
