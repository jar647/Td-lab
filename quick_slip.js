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
 function save(){try{root.localStorage?.setItem(KEY,JSON.stringify(picks))}catch(_){} update()}
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
  const key=[pick.sport,pick.game,pick.player,pick.market,pick.line??''].join('|').toLowerCase();
  const exists=picks.findIndex(p=>p.key===key);
  if(exists>=0)picks[exists]={...picks[exists],...pick,key};else picks.push({...pick,key,side:'',odds:''});
  save();
  const old=button.textContent;button.textContent='Added ✓';button.classList.add('is-added');
  setTimeout(()=>{if(button.isConnected){button.textContent=old;button.classList.remove('is-added')}},1200);
 }
 function row(pick,index){
  const quotes=pick.overOdds||pick.underOdds?'<p class="quick-slip-quotes">Card prices entered: Over '+esc(pick.overOdds||'—')+' · Under '+esc(pick.underOdds||'—')+'</p>':'';
  return '<article class="quick-slip-row"><div><strong>'+esc(pick.player)+'</strong> · '+esc(pick.market||'Player prop')+
   '<div class="quick-slip-meta">'+esc(pick.sport)+' · '+esc(pick.game||'Game not specified')+(pick.team?' · '+esc(pick.team):'')+'</div></div>'+quotes+
   '<div class="quick-slip-fields"><label>Vegas line<input type="number" step="0.5" min="0" inputmode="decimal" data-slip-index="'+index+'" data-slip-field="line" value="'+esc(pick.line??'')+'" placeholder="Enter line"></label>'+
   '<label>Side<select data-slip-index="'+index+'" data-slip-field="side"><option value="">Choose</option><option value="OVER"'+(pick.side==='OVER'?' selected':'')+'>Over</option><option value="UNDER"'+(pick.side==='UNDER'?' selected':'')+'>Under</option></select></label>'+
   '<label>Odds<input type="text" inputmode="text" data-slip-index="'+index+'" data-slip-field="odds" value="'+esc(pick.odds||'')+'" placeholder="Optional"></label></div>'+
   '<button type="button" class="quick-slip-remove" data-slip-remove="'+index+'">Remove</button></article>';
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
  style.textContent='.quick-slip-panel{scroll-margin-top:18px;border:1px solid #42a77a;background:#10291e;border-radius:14px;padding:16px;margin:14px 0;color:#eafff4}.quick-slip-panel h2{margin:0 0 6px}.quick-slip-help,.quick-slip-meta,.quick-slip-quotes{font-size:12px;line-height:1.5;color:#a9c7b7}.quick-slip-row{border-top:1px solid #315644;padding:12px 0}.quick-slip-fields{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin:10px 0}.quick-slip-fields label{font-size:11px;color:#a9c7b7}.quick-slip-fields input,.quick-slip-fields select{display:block;width:100%;margin-top:4px;padding:9px;border:1px solid #426b55;border-radius:8px;background:#081810;color:#fff;font-size:16px}.quick-slip-add{display:inline-block;margin:8px 0;padding:9px 12px;border:1px solid #269b69;border-radius:9px;background:#123927;color:#72f1b8;font-weight:800;cursor:pointer}.quick-slip-add.is-added{background:#1b8259;color:white}.quick-slip-remove,.quick-slip-clear{border:1px solid #55705f;border-radius:8px;background:#16281e;color:#eafff4;padding:7px 10px;cursor:pointer}.quick-slip-launcher{position:fixed;right:14px;bottom:18px;z-index:10000;border:1px solid #68f3b4;border-radius:999px;background:#0f3525;color:#88ffbf;padding:12px 16px;font-weight:900;box-shadow:0 5px 20px #0008}.quick-slip-empty{color:#b6cfc0}.quick-slip-warning{color:#ffce7d;font-size:12px;margin:8px 0}@media(max-width:520px){.quick-slip-fields{grid-template-columns:1fr 1fr}.quick-slip-fields label:last-child{grid-column:1/-1}}';
  root.document.head.appendChild(style);
  panel=root.document.createElement('section');panel.id='quickSlipPanel';panel.className='quick-slip-panel';
  panel.innerHTML='<h2>Quick Slip <span data-slip-count>0</span></h2><p class="quick-slip-help">Save picks here for quick access across CoOk It Up. Choose a side and line, then enter each leg manually in your sportsbook. Nothing is sent to Hard Rock.</p><div data-slip-list></div><p class="quick-slip-warning">Research organizer only. Check the live line, price, player status, and parlay eligibility yourself.</p><button type="button" class="quick-slip-clear">Clear slip</button>';
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
  root.document.addEventListener('change',event=>{
   const field=event.target.closest?.('[data-slip-index][data-slip-field]');if(!field)return;
   const index=Number(field.dataset.slipIndex),name=field.dataset.slipField,pick=picks[index];if(!pick)return;
   pick[name]=field.value;
   if(name==='side'){
    const quote=field.value==='OVER'?pick.overOdds:field.value==='UNDER'?pick.underOdds:'';
    pick.odds=quote||'';
    const odds=panel.querySelector('[data-slip-index="'+index+'"][data-slip-field="odds"]');if(odds)odds.value=pick.odds;
   }
   try{root.localStorage?.setItem(KEY,JSON.stringify(picks))}catch(_){}
  });
  update();
 }
 const api={button,createButton,addFromButton,add:pick=>{const b={dataset:{quickSlip:encode(pick)},textContent:'Added',classList:{add(){}},isConnected:false};addFromButton(b)},open,clear:()=>{picks=[];save()},getPicks:()=>picks.map(x=>({...x}))};
 root.CookItUpQuickSlip=api;
 if(root.document)mount();
})(typeof window!=='undefined'?window:globalThis);
