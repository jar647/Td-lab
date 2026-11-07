const assert=require('node:assert/strict');
const {research,availableLines,actualSeconds,methodKind}=require('./ufc_prop_research.js');
const options={names:['Alpha','Bravo'],rounds:3,line:2.5,boutId:'current',eventDate:'2026-11-07T22:00:00Z'};
const fight=(id,profileId,over=true,changes={})=>({bout_id:id,event_id:'event-'+id,event_date:'2026-01-01',starts_at:'2026-01-01T12:00:00Z',scheduled_rounds:3,status:'final',fighter_a:profileId,fighter_a_name:profileId==='a'?'Alpha':'Bravo',fighter_b:'opponent-'+id,fighter_b_name:'Opponent '+id,winner:profileId,method:'kotko',method_display:'KO/TKO',end_round:over?3:1,end_clock:over?'3:00':'2:00',...changes});
const pair=(over=true)=>[0,1].map(side=>({id:side?'b':'a',recent_fights:[0,1,2].map(i=>fight(side+'-'+i,side?'b':'a',over))}));
assert.deepEqual(availableLines(3),[0.5,1.5,2.5]);
assert.deepEqual(availableLines(5),[0.5,1.5,2.5,3.5,4.5]);
assert.deepEqual(availableLines('3'),[0.5,1.5,2.5]);
assert.equal(actualSeconds({end_round:3,end_clock:'2:30'},3),750);
assert.equal(actualSeconds({end_round:2,end_clock:'5:00'},3),600);
for(const row of [{end_round:3,end_clock:'5:01'},{end_round:0,end_clock:'5:00'},{end_round:4,end_clock:'1:00'},{end_round:1,end_clock:'0:00'},{end_round:3,end_clock:null}])assert.equal(actualSeconds(row,3),null);
assert.equal(research(pair(),options).totals.lean,'over');
assert.equal(research(pair(false),options).totals.lean,'under');
assert.equal(research(pair(),{...options,line:.5}).totals.lean,'over');
assert.equal(research(pair(),{...options,line:3.5}).totals.status,'invalid_line');
assert.equal(research(pair(),{...options,rounds:null}).totals.status,'unknown_rounds');
assert.equal(research(pair(),{...options,eventDate:'invalid'}).totals.status,'invalid_event_date');
assert.equal(research(pair(),{...options,rounds:5,line:3.5}).totals.pooled.sample,0);
assert.equal(research(pair(),{...options,rounds:5,line:3.5}).totals.lean,null);
const boundary=pair();boundary[0].recent_fights[0].end_clock='2:30';
let result=research(boundary,options).totals;
assert.equal(result.fighters[0].excluded.exact_threshold,1);
assert.equal(result.pooled.sample,5);assert.equal(result.lean,null);
const duplicates=pair();duplicates[0].recent_fights.push({...duplicates[0].recent_fights[0]});
assert.equal(research(duplicates,options).totals.pooled.sample,6);
assert.equal(research(duplicates,options).totals.fighters[0].excluded.duplicate_bout,1);
const shared=fight('shared','a',true,{fighter_b:'b',fighter_b_name:'Bravo'});
const headToHead=pair();headToHead[0].recent_fights[0]=shared;headToHead[1].recent_fights[0]={...shared};
result=research(headToHead,options).totals;
assert.equal(result.fighters[0].sample,3);assert.equal(result.fighters[1].sample,3);assert.equal(result.pooled.sample,5);assert.equal(result.lean,null);
const conflicts=pair();conflicts[0].recent_fights.push({...conflicts[0].recent_fights[0],end_clock:'4:00'});
assert.equal(research(conflicts,options).totals.pooled.sample,5);
for(const change of [
 {bout_id:'current'}, {starts_at:'2026-11-08T12:00:00Z'}, {status:'scheduled'}, {scheduled_rounds:null},
 {winner:'draw',method:'decision'}, {winner:null}, {method:'no-contest',method_display:'No Contest'},
 {method:'disqualification',method_display:'DQ'}, {method:'decision---technical',method_display:'Technical Decision'},
 {method:'decision',method_display:'Decision',end_round:2,end_clock:'2:00'},
 {starts_at:null,event_date:'2026-11-07'}, {starts_at:'broken',event_date:'2026-01-01'}
]) {
 const profiles=pair();Object.assign(profiles[0].recent_fights[0],change);
 assert.equal(research(profiles,options).totals.pooled.sample,5,JSON.stringify(change));
 assert.equal(research(profiles,options).totals.lean,null);
}
assert.equal(methodKind({method:'submission',method_display:'Submission - Rear Naked Choke'}),'submission');
assert.equal(methodKind({method:'decision---split'}),'decision');
assert.equal(methodKind({method:'doctor-stoppage',method_display:'TKO - Doctor Stoppage'}),'ko');
const decision=pair();decision[0].recent_fights[0]=fight('decision','a',true,{method:'decision---unanimous',method_display:'Decision',end_clock:'5:00'});
assert.equal(research(decision,options).totals.lean,'over');
const mixed=pair();mixed[1].recent_fights=pair(false)[1].recent_fights;
assert.equal(research(mixed,options).totals.status,'mixed_history');
const records=[{id:'a',ufc_record:{wins:10,losses:4,wins_ko:7,wins_sub:2,wins_dec:1,losses_ko:1,losses_sub:2,losses_dec:1}},
 {id:'b',ufc_record:{wins:8,losses:5,wins_ko:3,wins_sub:4,wins_dec:1,losses_ko:4,losses_sub:1,losses_dec:0}}];
result=research(records,options);
assert.equal(result.methods[0].candidate,'ko');
assert.equal(result.methods[0].rows[0].winShare,.7);
assert.equal(result.methods[0].rows[0].opponentLossShare,.8);
assert.equal(result.methods[0].rows[0].totalWins,10);
assert.equal(result.methods[1].candidate,null);
assert.equal(result.methods[0].recordSource,'career_record');
const missing=[{ufc_record:{wins:5,losses:2,wins_ko:3}},{ufc_record:{wins:6,losses:4,losses_ko:3}}];
result=research(missing,options).methods[0];
assert.equal(result.rows[0].candidate,true);
assert.equal(result.rows[1].winCount,null);
assert.equal(result.rows[1].opponentLossCount,null);
assert.equal(result.rows[1].winShare,null);
const zeros=[{ufc_record:{wins:0,losses:3,wins_ko:0,wins_sub:0,wins_dec:0}},{ufc_record:{wins:3,losses:0,losses_ko:0,losses_sub:0,losses_dec:0}}];
result=research(zeros,options).methods[0];
assert.equal(result.rows[0].winCount,0);assert.equal(result.rows[0].winShare,null);assert.equal(result.rows[0].opponentLossShare,null);assert.equal(result.candidate,null);
for(const value of [true,'3',-1,Infinity,NaN,{},[]]) {
 const invalid=JSON.parse(JSON.stringify(records));invalid[0].ufc_record.wins_ko=value;
 assert.equal(research(invalid,options).methods[0].rows[0].winCount,null);
}
const incoherent=JSON.parse(JSON.stringify(records));incoherent[0].ufc_record.wins_ko=11;
assert.equal(research(incoherent,options).methods[0].candidate,null);
assert.equal(research(incoherent,options).methods[0].rows[0].winCount,null);
const tooFew=JSON.parse(JSON.stringify(records));tooFew[1].ufc_record.losses=2;tooFew[1].ufc_record.losses_ko=2;tooFew[1].ufc_record.losses_sub=0;
assert.equal(research(tooFew,options).methods[0].candidate,null);
const after=JSON.parse(JSON.stringify(records));after[0].fetched_at='2026-11-08T12:00:00Z';
assert.equal(research(after,options).methods[0].candidate,null);
assert.ok(research(after,options).methods[0].cautions.some(x=>x.includes('pre-event')));
const recent=pair();result=research(recent,options).methods;
assert.equal(result[0].recordSource,'recent_results');assert.equal(result[0].recordSample,3);assert.equal(result[0].rows[0].winCount,3);assert.equal(result[0].candidate,null);
// Historical winner side tokens resolve without changing the sample identity.
recent[0].recent_fights.forEach(f=>{f.winner='a';});
assert.equal(research(recent,options).methods[0].rows[0].winCount,3);
const futureRecent=pair();futureRecent[0].recent_fights.forEach(f=>{f.starts_at='2026-12-01T12:00:00Z';});
assert.equal(research(futureRecent,options).methods[0].recordSource,'unavailable');
const conflictingResult=pair();conflictingResult[0].recent_fights.push({...conflictingResult[0].recent_fights[0],winner:conflictingResult[0].recent_fights[0].fighter_b});
assert.equal(research(conflictingResult,options).methods[0].recordSample,2);

// An explicit overall-professional record is never completed with UFC/DWCS
// counts; the scope and independent source timestamp stay visible.
const overall=records.map(p=>({...p,method_record:{...p.ufc_record},method_record_scope:'overall_professional',method_record_source:'ESPN overall professional record',method_record_fetched_at:'2026-11-07T12:00:00Z',fetched_at:'2026-01-01T12:00:00Z'}));
result=research(overall,options).methods[0];
assert.equal(result.candidate,'ko');
assert.equal(result.recordSource,'overall_professional');
assert.equal(result.recordScope,'overall_professional');
assert.equal(result.recordScopeLabel,'Overall professional record');
assert.equal(result.recordSourceLabel,'ESPN overall professional record');
assert.equal(result.rows[0].opponentRecordSourceLabel,'ESPN overall professional record');
const partialOverall=JSON.parse(JSON.stringify(overall));
partialOverall[0].method_record={wins:12,losses:5,wins_ko:8,wins_sub:2,wins_dec:null};
result=research(partialOverall,options).methods[0];
assert.equal(result.rows[0].totalWins,12);
assert.equal(result.rows[0].winCount,8);
assert.equal(result.rows[2].winCount,null);
assert.equal(result.rows[2].winShare,null);
const mixedScope=JSON.parse(JSON.stringify(overall));delete mixedScope[1].method_record;
result=research(mixedScope,options).methods[0];
assert.equal(result.candidate,null);
assert.equal(result.rows[0].winCount,7);
assert.equal(result.rows[0].opponentLossCount,4);
assert.match(result.rows[0].reason,/different or unconfirmed competition scopes/);
assert.equal(result.opponentRecordScope,'provider_promotion');
const lateOverall=JSON.parse(JSON.stringify(overall));lateOverall[0].method_record_fetched_at='2026-11-08T12:00:00Z';
result=research(lateOverall,options).methods[0];
assert.equal(result.candidate,null);
assert.equal(result.recordFetchedAt,'2026-11-08T12:00:00Z');
assert.match(result.rows[0].reason,/fetched after/);
// A newly fetched pre-event method record is not dated by an unrelated later
// career-metric fetch timestamp.
const separateFetch=JSON.parse(JSON.stringify(overall));separateFetch[0].fetched_at='2026-11-08T12:00:00Z';
assert.equal(research(separateFetch,options).methods[0].candidate,'ko');
const emptyOverall=JSON.parse(JSON.stringify(overall));emptyOverall[0].method_record={};
assert.equal(research(emptyOverall,options).methods[0].rows[0].winCount,null);

// Odds never enter independent historical research or create method probabilities.
assert.deepEqual(research(records,{...options,odds:[-700,500]}),research(records,{...options,odds:[500,-700]}));
assert.ok(!JSON.stringify(research([{},{}],options)).includes('NaN'));
console.log('UFC prop research PASS: round thresholds, schedule compatibility, sample limits, duplicates, ambiguous results, method counts and odds independence');
