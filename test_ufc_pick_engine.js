const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {choose,policy,policyDescription,thresholds} = require('./ufc_pick_engine.js');
const {describe} = require('./ufc_matchup_research.js');
const {research} = require('./ufc_prop_research.js');
const names=['Alpha','Bravo'];
const eventDate='2026-11-07T22:00:00Z', now='2026-11-07T20:00:00Z';
const base={slpm:4.2,sapm:3.1,strAcc:48,strDef:55,tdAvg:1.8,tdAcc:42,tdDef:72,subAvg:0.4};
const strong={slpm:6.5,sapm:2,strAcc:55,strDef:65,tdAvg:3.5,tdAcc:55,tdDef:80,subAvg:1.1};
const winner=describe(strong,base,{names});
assert.equal(winner.status,'experimental');
assert.equal(winner.leanSide,0);
const balanced=describe(base,base,{names});
const incomplete=describe({...strong,tdAcc:null},base,{names});
const defaults={names,matchup:winner,propReports:[],rounds:3,status:'pre',eventDate,now};
const select=changes=>choose({...defaults,...changes});
const recordPair=[
 {id:'a',ufc_record:{wins:10,losses:4,wins_ko:7,wins_sub:2,wins_dec:1,losses_ko:1,losses_sub:2,losses_dec:1}},
 {id:'b',ufc_record:{wins:8,losses:5,wins_ko:3,wins_sub:4,wins_dec:1,losses_ko:4,losses_sub:1,losses_dec:0}}
];
const propOptions={names,rounds:3,line:2.5,boutId:'current',eventDate};
const methodReport=research(recordPair,propOptions);
const fight=(id,profileId,over=true,rounds=3)=>({bout_id:id,event_id:'event-'+id,event_date:'2026-01-01',starts_at:'2026-01-01T12:00:00Z',scheduled_rounds:rounds,status:'final',fighter_a:profileId,fighter_a_name:profileId==='a'?'Alpha':'Bravo',fighter_b:'opponent-'+id,fighter_b_name:'Opponent '+id,winner:profileId,method:'kotko',method_display:'KO/TKO',end_round:over?rounds:1,end_clock:over?'3:00':'2:00'});
const histories=(over=true,rounds=3)=>[0,1].map(side=>({id:side?'b':'a',recent_fights:[0,1,2].map(i=>fight(side+'-'+i,side?'b':'a',over,rounds))}));
const totalReport=(over=true,rounds=3,line=rounds===3?2.5:4.5)=>research(histories(over,rounds),{...propOptions,rounds,line});
const clone=value=>JSON.parse(JSON.stringify(value));

// Winner selection is independent of supplied prices, including prop prices.
const fighter=select({});
assert.equal(fighter.label,'Alpha to win');
assert.equal(fighter.market,'winner');
assert.equal(fighter.dataQuality,'complete');
assert.deepEqual(select({odds:[-700,500],propOdds:{ko:-1000}}),select({odds:[500,-700],propOdds:{ko:1000}}));
assert.equal(policy,'Unvalidated evidence rule');
assert.match(policyDescription,/not fitted probabilities or expected-value rankings/);
assert.equal(thresholds.methodShare,.6);

// A concentrated, matching-scope method may refine an independently supported
// winner. Neither its 7/10 share nor 4/5 share is a matchup probability.
const method=select({propReports:[methodReport]});
assert.equal(method.status,'pick');
assert.equal(method.label,'Alpha by KO/TKO');
assert.equal(method.market,'method');
assert.equal(method.side,0);
assert.match(method.reason,/7 of 10 recorded wins and 4 of 5 opposing losses/);
assert.match(method.risk,/wins another way/);
assert.match(method.basis.join(' '),/not this matchup’s method probability/);
assert.ok(!Object.keys(method).some(key=>/probability|confidence|value|edge/i.test(key)));
const reverse=describe(base,strong,{names});
assert.equal(reverse.leanSide,1);
assert.equal(select({matchup:reverse,propReports:[methodReport]}).market,'winner','An opposing fighter’s KO record cannot override the independent winner');
assert.equal(select({matchup:incomplete,propReports:[methodReport]}).status,'pass','Method shares alone cannot establish a winner');

// The selector requires both the upstream candidate validation and stronger
// concentration/sample conditions; it cannot rescue an invalid row.
for (const change of [
 row=>{row.candidate=false;},
 row=>{row.recordScope='overall_professional';},
 row=>{row.opponentRecordScope='unknown';},
 row=>{row.totalOpponentLosses=4;row.opponentLossCount=2;row.opponentLossShare=.5;},
 row=>{row.totalWins=4;row.winCount=3;row.winShare=.75;row.totalOpponentLosses=4;row.opponentLossCount=3;row.opponentLossShare=.75;},
 row=>{row.winShare=.99;},
 row=>{row.recordFetchedAt='2026-11-08T00:00:00Z';},
 row=>{row.recordFetchedAt='2026-11-07T21:00:00Z';},
 row=>{row.recordFetchedAt='not-a-date';},
 row=>{row.opponentRecordFetchedAt='not-a-date';},
 row=>{row.recordFetchedAt=eventDate;}
]) {
 const report=clone(methodReport);change(report.methods[0].rows[0]);
 assert.equal(select({propReports:[report]}).market,'winner');
}
const validSnapshot=clone(methodReport);
validSnapshot.methods[0].rows[0].recordFetchedAt='2026-11-07T19:00:00Z';
assert.equal(select({propReports:[validSnapshot]}).market,'method');
const boundaryMethod=clone(methodReport);
Object.assign(boundaryMethod.methods[0].rows[0],{totalWins:5,winCount:3,winShare:.6,totalOpponentLosses:5,opponentLossCount:3,opponentLossShare:.6});
assert.equal(select({propReports:[boundaryMethod]}).market,'method','Exactly 60% in both records and ten combined observations qualify');
for (const key of ['submission','decision']) {
 const report=clone(boundaryMethod);report.methods[0].candidate=key;
 report.methods[0].rows[0].key=key;
 assert.equal(select({propReports:[report]}).method,key);
}
const neitherWinner=clone(winner);neitherWinner.modelProbability=.5;
assert.equal(select({matchup:neitherWinner,propReports:[methodReport]}).status,'pass');
const wrongSide=clone(winner);wrongSide.leanSide=1;
assert.equal(select({matchup:wrongSide,propReports:[methodReport]}).status,'pass');
const inconsistentAreas=clone(winner);
inconsistentAreas.areas.forEach(area=>{area.side=1;area.contribution=-1;});
assert.equal(select({matchup:inconsistentAreas,propReports:[methodReport]}).status,'pass');

// Standard totals are separate from winner selection. Missing fighter rates
// do not erase valid, independently verified same-format duration evidence.
const over=totalReport();
assert.equal(over.totals.pooled.sample,6);
const overPick=select({matchup:incomplete,propReports:[over]});
assert.equal(overPick.label,'Over 2.5 rounds');
assert.equal(overPick.market,'total');
assert.equal(overPick.side,null);
assert.equal(overPick.dataQuality,'limited');
assert.equal(select({matchup:balanced,propReports:[totalReport(false)]}).label,'Under 2.5 rounds');
assert.equal(select({matchup:balanced,rounds:5,propReports:[totalReport(true,5)]}).label,'Over 4.5 rounds');
assert.equal(select({matchup:balanced,rounds:'5',propReports:[totalReport(false,5)]}).label,'Under 4.5 rounds');
assert.equal(select({matchup:incomplete,propReports:[totalReport(true,3,.5)]}).status,'pass','A trivial Over 0.5 is never automatically selected');
assert.equal(select({matchup:incomplete,propReports:[totalReport(true,3,1.5)]}).status,'pass');
assert.equal(select({matchup:incomplete,rounds:5,propReports:[over]}).status,'pass','Three-round evidence cannot support a five-round total');
assert.equal(select({matchup:incomplete,rounds:null,propReports:[over]}).status,'pass');
assert.equal(select({matchup:incomplete,propReports:[over,totalReport(false)]}).status,'pass','Conflicting verified reports are withheld');

// The strong-total cutoffs are stricter than the exploratory prop module.
const totalFixture=(a,b)=>({totals:{status:'historical_lean',rounds:3,line:2.5,lean:'over',fighters:[a,b].map(([over,under],side)=>({side,over,under,sample:over+under})),pooled:{over:a[0]+b[0],under:a[1]+b[1],sample:a[0]+a[1]+b[0]+b[1]}},methods:[]});
assert.equal(select({matchup:balanced,propReports:[totalFixture([3,1],[3,1])]}).market,'total','Exactly 75% support qualifies');
assert.equal(select({matchup:balanced,propReports:[totalFixture([2,1],[4,1])]}).market,'total','Exactly two-thirds support on one side qualifies when pooled support reaches 75%');
assert.equal(select({matchup:balanced,propReports:[totalFixture([2,1],[2,1])]}).status,'pass','Two-thirds pooled does not reach 75%');
assert.equal(select({matchup:balanced,propReports:[totalFixture([3,2],[6,0])]}).status,'pass','Pooled support cannot hide weak support on one side');
assert.equal(select({matchup:balanced,propReports:[totalFixture([2,0],[6,0])]}).status,'pass','At least three independent history rows per fighter are required');
const unvalidated=clone(over);unvalidated.totals.status='mixed_history';
assert.equal(select({matchup:balanced,propReports:[unvalidated]}).status,'pass');

// Fixed hierarchy: a broad winner with coherent area support takes priority
// over a total; competing area evidence lets the strong total take priority.
assert.equal(select({propReports:[over]}).market,'winner');
assert.equal(select({propReports:[over,methodReport]}).market,'method');
const contested=clone(winner);
contested.areas[0].side=0;contested.areas[0].contribution=.8;
contested.areas[1].side=1;contested.areas[1].contribution=-.6;
contested.areas[2].side=0;contested.areas[2].contribution=.4;
contested.areas[3].side=null;contested.areas[3].contribution=0;
contested.counterargument={side:1,title:'Defense and damage absorbed',summary:'Bravo absorbs fewer significant strikes per minute.'};
assert.equal(select({matchup:contested,propReports:[over,methodReport]}).market,'total');
const contestedWinner=select({matchup:contested});
assert.equal(contestedWinner.market,'winner');
assert.equal(contestedWinner.risk,'Bravo leads the defense and damage absorbed comparison and could overturn this lean.');
assert.ok(contestedWinner.basis.includes(contested.counterargument.summary),'Detailed opposing facts remain in expandable evidence');
const contestedMethod=select({matchup:contested,propReports:[methodReport]});
assert.equal(contestedMethod.market,'method');
assert.equal(contestedMethod.risk,'This narrower pick loses if Alpha wins another way. '+contestedWinner.risk);
assert.ok(contestedMethod.basis.includes(contested.counterargument.summary));
const lengthyCounter=clone(contested);
lengthyCounter.counterargument.summary='Bravo: 3.1 significant strikes absorbed/min. Alpha: 4.5 significant strikes absorbed/min. These are career observations. '.repeat(4);
assert.equal(select({matchup:lengthyCounter}).risk,contestedWinner.risk,'Primary risk never repeats the full statistics paragraph');
const areaFallback=clone(contested);areaFallback.counterargument=null;
assert.equal(select({matchup:areaFallback}).risk,contestedWinner.risk);
const conditional=clone(winner);conditional.missing=[['Takedown accuracy'],[]];
assert.equal(select({matchup:conditional}).market,'winner');
assert.equal(select({matchup:conditional}).dataQuality,'limited','An upstream conditional-valid report must retain missing-data disclosure');

// No evidence, equal stats and tiny or invalid prop samples do not force picks.
assert.equal(select({matchup:incomplete}).status,'pass');
assert.equal(select({matchup:balanced}).status,'pass');
assert.equal(select({matchup:null,propReports:null}).status,'pass');
assert.equal(choose().status,'unavailable');
for (const status of ['in','STATUS_IN_PROGRESS','live',{type:{state:'in'}}]) {
 const result=select({status,propReports:[over,methodReport]});
 assert.equal(result.status,'unavailable');assert.match(result.label,/Live fight/);
}
for (const status of ['post','STATUS_FINAL','completed',{type:{completed:true}}]) {
 assert.equal(select({status}).label,'Fight completed');
}
for (const status of ['cancelled','postponed','unknown',null]) assert.equal(select({status}).status,'unavailable');
assert.equal(select({status:{type:{state:'pre'}}}).status,'pick');
assert.equal(select({now:'2026-11-08T09:00:00Z'}).status,'pick','An 11-hour-old card date alone does not establish that a bout is live');
assert.equal(select({now:'2026-11-08T10:00:00.001Z'}).label,'Refresh fight status');
assert.equal(select({now:'bad-clock'}).status,'unavailable');
assert.deepEqual(select({}),select({}), 'A supplied evaluation time makes repeated decisions deterministic');
assert.deepEqual(select({propReports:[over,methodReport]}),select({propReports:[methodReport,over]}));
assert.deepEqual(select({propReports:[methodReport,methodReport]}),method,'Duplicate reports do not amplify evidence');
for (const result of [fighter,method,overPick,contestedWinner,select({matchup:balanced}),select({status:'in'})]) {
 assert.deepEqual(Object.keys(result).sort(),['status','label','market','side','line','method','reason','risk','basis','policy','dataQuality'].sort());
 assert.ok(!JSON.stringify(result).includes('NaN'));
 assert.equal(result.policy,policy);
}
// Browser registration uses the same implementation and requires no Node API.
const browser={};vm.createContext(browser);
vm.runInContext(fs.readFileSync(require.resolve('./ufc_pick_engine.js'),'utf8'),browser);
assert.equal(browser.UFCPickEngine.choose(defaults).label,fighter.label);
console.log('UFC top pick: independent winner, aligned method, standard total hierarchy, evidence gates, counterrisk, state/time gates, odds independence, determinism and browser export PASS');
