/* Complete NFL research boards. Visibility is independent of recommendation eligibility. */
(function(root){
'use strict';
const POSITIONS={PASS:['QB'],PTD:['QB'],RUSH:['QB','RB','WR','TE'],REC:['RB','WR','TE'],CATCH:['RB','WR','TE'],TD:['QB','RB','WR','TE']};
const FIELDS={PASS:'defPassYardsAllowed',PTD:'defPassTDsAllowed',RUSH:'defRushYardsAllowed',REC:'defRecYardsAllowed',CATCH:'defReceptionsAllowed',TD:'tdallowed'};
const ORDER={QB:0,RB:1,WR:2,TE:3};
const BLOCKED=/^(OUT|INACTIVE|SUSPENDED|IR|PUP|RES|DEV|CUT|RET|EXE|TRD|TRT|DOUBTFUL)$/;
const HTTPS=/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d+)?(?:[/?#][^\s]*)?$/i;
function finite(v){if(typeof v!=='number'&&typeof v!=='string'||typeof v==='string'&&v.trim()==='')return null;const n=Number(v);return Number.isFinite(n)?n:null}
function gameKey(r){return [String(r.team||''),String(r.opp||'')].sort().join('|')}
function identity(r){return String(r.player_id||r.team+'|'+r.player)}
function sample(r){const n=finite(r.seasonGamesPlayed??r.games);return n!==null&&n>=0?n:0}
function blocked(r){return BLOCKED.test(String(r.availability||'').toUpperCase())||BLOCKED.test(String(r.injuryReportStatus||'').toUpperCase())}
function https(v){return typeof v==='string'&&HTTPS.test(v.trim())}
function starter(r){const c=r.starterContext;return r.qbRole==='EXPECTED_STARTER'&&https(c?.source)&&typeof c.note==='string'&&c.note.trim()!==''}
function depthContext(r){
 const d=r.depthChart;
 if(!d||d.sourceStatus!=='ok'||!['first','reserve'].includes(d.unit)||!https(d.source)||typeof d.observedAt!=='string'||!Number.isFinite(Date.parse(d.observedAt)))return null;
 const season=finite(d.season);if(!Number.isInteger(season)||season<1900)return null;
 if(r.season!==null&&r.season!==undefined&&r.season!==''&&finite(r.season)!==season)return null;
 return d;
}
function isReserveQuarterback(r){return r?.pos==='QB'&&!starter(r)&&depthContext(r)?.unit==='reserve'}
function usage(r){const key=r.pos==='QB'?'PassAttempts':r.pos==='RB'?'Carries':'Targets';return finite(r['recent3'+key])??finite(r['player'+key])??0}
function opponentContext(records,record,category){
 const field=FIELDS[category];if(!field||!record?.opp||!record.pos)return null;
 const defenses=new Map();
 for(const r of records||[]){
  if(!r||r.market!=='ATD'||r.pos!==record.pos||!r.opp||defenses.has(String(r.opp)))continue;
  const value=finite(r[field]);if(value!==null&&value>=0)defenses.set(String(r.opp),value);
 }
 const own=finite(record[field]),value=own!==null&&own>=0?own:defenses.get(String(record.opp));
 if(value===undefined||value===null)return null;
 if(!defenses.has(String(record.opp))&&record.opp)defenses.set(String(record.opp),value);
 const values=[...defenses.values()],total=values.length;
 if(!total)return null;
 const higher=values.filter(v=>v>value).length,tied=values.filter(v=>v===value).length,rank=1+higher;
 const easeScore=total===1?50:Math.round(100*(values.filter(v=>v<value).length+(tied-1)/2)/(total-1));
 return {field,value,rank,total,easeScore,tied,label:'#'+rank+(tied>1?' (tied)':'')+' of '+total+' feed defenses vs '+record.pos+' by allowance (1 = most allowed)'};
}
function defaultRating(record,category){
 const goal=typeof module==='object'&&module.exports?require('./nfl_goal1.js'):root.PropVaultGoal1;
 if(category==='TD'){
  const td=typeof module==='object'&&module.exports?require('./nfl_td_matchup.js'):root.PropShopNFLTD;
  return td?.rating(record)||null;
 }
 return goal?.matchupRating(record,category)||null;
}
function rows(records,category,options={}){
 const positions=POSITIONS[category];if(!positions||!Array.isArray(records))return [];
 const game=options.game||'ALL',position=options.position||'ALL',ratingFor=options.ratingFor||defaultRating;
 const goal=typeof module==='object'&&module.exports?require('./nfl_goal1.js'):root.PropVaultGoal1;
 const minimum=goal?.MIN_SCORE??60;
 const candidates=records.filter(r=>r&&r.market==='ATD'&&r.player&&r.team&&positions.includes(r.pos)&&(position==='ALL'||r.pos===position)&&(game==='ALL'||gameKey(r)===game));
 const unique=new Map();
 for(const r of candidates){
  const key=gameKey(r)+'|'+r.team+'|'+identity(r),previous=unique.get(key);
  const quality=x=>(x.playerAppearancesVerified===true?10000:0)+sample(x)+(starter(x)?.5:0);
  if(!previous||quality(r)>quality(previous))unique.set(key,r);
 }
 const chosen=[...unique.values()],leaders=new Map();
 for(const r of chosen){
  if(blocked(r)||r.qbRole==='BACKUP'||isReserveQuarterback(r)||usage(r)<=0)continue;
  const key=gameKey(r)+'|'+r.team+'|'+r.pos,previous=leaders.get(key);
  if(!previous||Number(starter(r))-Number(starter(previous))>0||starter(r)===starter(previous)&&usage(r)>usage(previous))leaders.set(key,r);
 }
 const result=chosen.map(record=>{
  const reasons=[],games=sample(record),verified=record.playerAppearancesVerified===true;
  let rating=null;
  if(verified&&games>0){try{rating=ratingFor(record,category)||null}catch{rating=null}}
  const raw=finite(rating?.score),score=raw!==null&&raw>=0&&raw<=100?raw:null;
  if(score===null)rating=null;
  if(!verified)reasons.push('Verified player performance is unavailable');
  if(games<=0)reasons.push('No recorded player appearances');
  const requiredGames=category==='PASS'||category==='PTD'?1:category==='TD'?2:3;
  if(games>0&&games<requiredGames)reasons.push('Limited sample: '+games+' verified '+(games===1?'game':'games')+'; '+requiredGames+' required for recommendations');
  if(score===null)reasons.push('Score unavailable: incomplete player or opponent metrics');
  else if(score<minimum)reasons.push('Below '+minimum+'/100 recommendation minimum');
  const roster=String(record.availability||'UNVERIFIED').toUpperCase(),injury=String(record.injuryReportStatus||'UNVERIFIED').toUpperCase();
  if(blocked(record))reasons.push((BLOCKED.test(injury)?injury:roster)+' · unavailable for recommendations');
  else if(!['ROSTER_ACTIVE','QUESTIONABLE'].includes(roster))reasons.push('Current roster availability is unverified');
  if(record.qbRole==='BACKUP')reasons.push('Backup QB · no starting assumption');
  else if(isReserveQuarterback(record))reasons.push('Depth-chart reserve QB · no starting assumption');
  const exclusion=typeof options.excluded==='function'?options.excluded(record):false;
  if(exclusion)reasons.push(typeof exclusion==='string'?exclusion:'Excluded from recommendations');
  const recommendable=reasons.length===0;
  const leader=leaders.get(gameKey(record)+'|'+record.team+'|'+record.pos)===record,depth=depthContext(record),firstUnit=depth?.unit==='first';
  const roleLabel=starter(record)?'Sourced expected starter':firstUnit?'Depth-chart first unit · game-day status unconfirmed':depth?.unit==='reserve'?'Depth-chart reserve'+(leader?' · recent usage leader':'')+' · game-day status unconfirmed':leader?'Recent usage leader · starter unconfirmed':record.qbRole==='BACKUP'?'Backup QB · starter unconfirmed':'Starting status unconfirmed';
  let statusLabel=blocked(record)?(BLOCKED.test(injury)?injury:roster)+' · research only':record.qbRole==='BACKUP'?'Backup QB · research only':isReserveQuarterback(record)?'Depth-chart reserve QB · research only':!verified?'History unverified · research only':games<requiredGames?'Limited sample · research only':score===null?'Score unavailable · research only':score<minimum?'Below '+minimum+'/100 · research only':roster==='QUESTIONABLE'||injury==='QUESTIONABLE'?'Questionable · verify game-day status':'Roster active · game-day status unconfirmed';
  if(exclusion&&!blocked(record))statusLabel='Excluded from recommendations · research only';
  const depthOrder=finite(depth?.order);
  return {record,rating,score,recommendable,reasons,statusLabel,roleLabel,opponentContext:opponentContext(records,record,category),key:gameKey(record)+'|'+record.team+'|'+identity(record)+'|'+category,_rolePriority:starter(record)?3:firstUnit?2:leader?1:0,_depthOrder:depth&&depthOrder!==null&&depthOrder>=0?depthOrder:Infinity};
 });
 result.sort((a,b)=>gameKey(a.record).localeCompare(gameKey(b.record))||String(a.record.team).localeCompare(String(b.record.team))||b._rolePriority-a._rolePriority||ORDER[a.record.pos]-ORDER[b.record.pos]||(a._depthOrder-b._depthOrder)||(b.score??-1)-(a.score??-1)||String(a.record.player).localeCompare(String(b.record.player)));
 return result.map(({_rolePriority,_depthOrder,...row})=>row);
}
const api={rows,opponentContext,gameKey,identity,POSITIONS,isReserveQuarterback};
if(typeof module==='object'&&module.exports)module.exports=api;
root.PropShopNFLBoard=api;
})(typeof globalThis!=='undefined'?globalThis:this);
