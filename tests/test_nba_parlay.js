/* Research drafts use the existing engine's aligned outcomes, never score products. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const api=require('../nba_parlay'),lines=require('../nba_prop_lines');
const now=Date.parse('2026-11-18T12:00:00Z'),iso=offset=>new Date(now+offset).toISOString();
const outcomes=(wins=750,start=0)=>Array.from({length:1000},(_,i)=>(i-start+1000)%1000<wins?20:5);
function candidate(player,game='g1',options={}){
 const inputTimes={games:iso(0),injuries:iso(0),rosters:iso(0)};
 return {key:player+'|points',playerId:player,name:'Player '+player,gameId:game,
  game:{id:game,home:game+'H',away:game+'A',date:iso(6*3600000),status:'STATUS_SCHEDULED'},
  team:game+'A',opponent:game+'H',market:'points',side:'over',eligible:true,reviewRequired:false,
  score:90,line:14.5,samples:outcomes(),outcomeSetId:game+'|engine-batch',inputTimes,
  roleEvidence:{playerId:player,team:game+'A',eligible:true,roleStatus:'SUPPORTED',status:'ACTIVE',
   projectedMinutes:30,minutesLow:30,minutesHigh:30,historyGames:10,holdReasons:[],inputTimes:{...inputTimes}},
  ...options};
}
const generate=(rows,options={})=>api.generate(rows,{now,...options});
const evaluate=rows=>api.evaluate(rows,{now});
const leg=row=>api.evaluateLeg(row,{now});
const near=(actual,expected,message)=>assert(Math.abs(actual-expected)<1e-12,message||`${actual} != ${expected}`);
function mustPass(result,message){assert.equal(result.available,false,message);assert.equal(result.status,'PASS');assert.equal(result.jointFrequency,null);assert.equal(result.play,false)}

// A high matchup score is not permission to always select the easiest threshold.
const ranked=[];
for(let i=1;i<=3;i++){
 const easy=candidate('easy'+i,'g'+i,{score:100,samples:outcomes(940)});
 Object.assign(easy.roleEvidence,{minutesLow:27,minutesHigh:33});
 ranked.push(easy,candidate('balanced'+i,'g'+i));
}
const balanced=generate(ranked);
assert(balanced.available,balanced.reason);assert.equal(balanced.legs.length,3);
assert.deepEqual(balanced.legs.map(p=>p.playerId).sort(),['balanced1','balanced2','balanced3']);
assert.equal(new Set(balanced.legs.map(p=>p.gameId)).size,3);
near(balanced.jointFrequency,.75**3);assert.equal(balanced.independentGames,true);
assert.match(balanced.limits.join(' '),/independence assumption/);assert.equal(balanced.calibrated,false);assert.equal(balanced.play,false);
assert.match(balanced.objective.definition,/not a hit probability/);

// Same-game legs are paired by outcome index, not multiplied as independent bets.
const same=[candidate('positive-a'),candidate('positive-b')];
const positive=evaluate(same);assert(positive.available,positive.reason);
near(positive.jointFrequency,.75);near(positive.correlations[0].independentHitFrequency,.5625);
near(positive.correlations[0].sharedHitFrequency,.75);near(positive.correlations[0].coefficient,1);
assert.equal(positive.independentGames,false);assert.equal(positive.gameGroups[0].sampleCount,1000);
assert(generate(same,{count:2,mode:'sgp',gameId:'g1'}).available);

const negativeA=candidate('negative-a','negative',{samples:outcomes(650),score:92});
const negativeB=candidate('negative-b','negative',{samples:outcomes(650,350),score:100});
const negative=evaluate([negativeA,negativeB]);assert(negative.available,negative.reason);
near(negative.jointFrequency,.3);near(negative.correlations[0].independentHitFrequency,.65**2);
assert(negative.correlations[0].coefficient<0);
mustPass(generate([negativeA,negativeB],{count:2,mode:'sgp',gameId:'negative'}),'Do not fill a draft with heavily conflicting legs');
const compatible=candidate('compatible','negative',{samples:outcomes(650),score:89});
const screened=generate([negativeA,negativeB,compatible],{count:2,mode:'sgp',gameId:'negative'});
assert(screened.available,screened.reason);assert.deepEqual(screened.legs.map(p=>p.playerId).sort(),['compatible','negative-a']);

// Mixed game groups preserve within-game dependence and declare the outer product.
const mixed=evaluate([...same,candidate('separate','g2',{samples:outcomes(600)})]);
assert(mixed.available,mixed.reason);near(mixed.jointFrequency,.75*.6);
assert.equal(mixed.gameGroups.length,2);assert.equal(mixed.independentGames,true);assert.equal(mixed.correlations.length,1);

// An edited integer book line has pushes, unlike a milestone's half-point line.
const pushSamples=Array.from({length:1000},(_,i)=>i<500?10:i<750?11:9);
const pushA=candidate('push-a','push',{samples:pushSamples,line:10,probability:.99});
const pushB=candidate('push-b','push',{samples:pushSamples,line:10,probability:.99});
const exact=leg(pushA);assert(exact.available,exact.reason);
near(exact.winFrequency,.25);near(exact.pushFrequency,.5);near(exact.lossFrequency,.25);
near(exact.leg.probability,.25);near(exact.leg.pushProbability,.5);near(exact.leg.lossProbability,.25);
const sharedPush=evaluate([pushA,pushB]);assert(sharedPush.available,sharedPush.reason);
near(sharedPush.jointFrequency,.25);near(sharedPush.nonLossFrequency,.75);
near(sharedPush.pushFrequency,.5);near(sharedPush.lossFrequency,.25);
assert.deepEqual(sharedPush.legFrequencies.map(p=>[p.winFrequency,p.pushFrequency,p.lossFrequency,p.count]),[[.25,.5,.25,1000],[.25,.5,.25,1000]]);
const independentPush=evaluate([pushA,candidate('push-other','push-other',{samples:pushSamples,line:10})]);
near(independentPush.jointFrequency,.25**2);near(independentPush.nonLossFrequency,.75**2);
near(independentPush.pushFrequency,.5);near(independentPush.lossFrequency,1-.75**2);
near(independentPush.jointFrequency+independentPush.pushFrequency+independentPush.lossFrequency,1);
const hard=evaluate([candidate('hard-a','hard-a',{line:399}),candidate('hard-b','hard-b',{line:399})]);
assert(hard.available,hard.reason);near(hard.jointFrequency,0);near(hard.lossFrequency,1);assert.equal(hard.play,false);
mustPass(generate([pushA,pushB],{count:2,mode:'sgp',gameId:'push'}),'The generator must not use low-frequency exact edits as research filler');

// A matching game label cannot prove that separately sampled batches are aligned.
for(const mutate of [
 p=>{p.outcomeSetId='different-batch'},
 p=>{delete p.outcomeSetId},
 p=>{p.samples.push(20)},
 p=>{p.inputTimes.games=iso(-60000);p.roleEvidence.inputTimes.games=iso(-60000)}
]){
 const changed=structuredClone(same[1]);mutate(changed);
 mustPass(evaluate([same[0],changed]));
 mustPass(generate([same[0],changed],{count:2,mode:'sgp',gameId:'g1'}));
}
const soloNoBatch=candidate('solo-no-batch','g2');delete soloNoBatch.outcomeSetId;
assert(leg(soloNoBatch).available,'One leg per game needs no artificial shared-batch claim');
assert(evaluate([same[0],soloNoBatch]).available);

// Source timestamps, supported roles and fixture status remain hard gates.
const invalid=[
 ['minimum matchup rating',p=>{p.score=84}],
 ['rating consistency',p=>{p.matchupRating={score:99}}],
 ['OVER only',p=>{p.side='under'}],
 ['eligibility',p=>{p.eligible=false}],
 ['review required',p=>{p.reviewRequired=true}],
 ['parlay held',p=>{p.parlayEligible=false}],
 ['missing role',p=>{delete p.roleEvidence}],
 ['uncertain role',p=>{p.roleEvidence.roleStatus='HELD'}],
 ['questionable player',p=>{p.roleEvidence.status='QUESTIONABLE'}],
 ['known out',p=>{p.status='OUT'}],
 ['role identity',p=>{p.roleEvidence.playerId='wrong'}],
 ['role team',p=>{p.roleEvidence.team='wrong'}],
 ['role held',p=>{p.roleEvidence.eligible=false}],
 ['role hold reason',p=>{p.roleEvidence.holdReasons=['unconfirmed opportunity']}],
 ['unstable minutes',p=>{p.roleEvidence.minutesLow=26;p.roleEvidence.minutesHigh=33}],
 ['low minutes',p=>{p.roleEvidence.minutesLow=19}],
 ['impossible minutes',p=>{p.roleEvidence.minutesHigh=49}],
 ['projection outside supported bounds',p=>{p.roleEvidence.projectedMinutes=35}],
 ['sparse history',p=>{p.roleEvidence.historyGames=4}],
 ['fractional history',p=>{p.roleEvidence.historyGames=5.5}],
 ['stale games',p=>{p.inputTimes.games=iso(-12*3600000-1)}],
 ['stale injuries',p=>{p.inputTimes.injuries=iso(-12*3600000-1)}],
 ['stale roster',p=>{p.inputTimes.rosters=iso(-72*3600000-1)}],
 ['future source',p=>{p.inputTimes.games=iso(300001)}],
 ['missing source',p=>{delete p.inputTimes.injuries}],
 ['role-source disagreement',p=>{p.roleEvidence.inputTimes.injuries=iso(-60000)}],
 ['malformed role source',p=>{p.roleEvidence.inputTimes=null}],
 ['timezone missing',p=>{p.inputTimes.games='2026-11-18T12:00:00'}],
 ['already tipped',p=>{p.game.date=iso(0)}],
 ['far future fixture',p=>{p.game.date=iso(7*86400000+1)}],
 ['unknown game status',p=>{p.game.status='STATUS_IN_PROGRESS'}],
 ['mismatched game identity',p=>{p.game.id='other'}],
 ['mismatched opponent',p=>{p.opponent='other'}],
 ['ambiguous team',p=>{p.team='other'}],
 ['non-finite outcomes',p=>{p.samples[0]=NaN}],
 ['negative outcomes',p=>{p.samples[0]=-1}],
 ['sparse outcomes',p=>{delete p.samples[0]}],
 ['missing outcomes',p=>{delete p.samples}],
 ['insufficient simulation draws',p=>{p.samples=p.samples.slice(0,999)}],
 ['non-numeric line',p=>{p.line='14.5'}],
 ['negative line',p=>{p.line=-.5}],
 ['unknown market',p=>{p.market='stocks'}]
];
for(const [name,mutate] of invalid){
 const changed=candidate('invalid','g2');mutate(changed);
 assert.equal(leg(changed).available,false,name);mustPass(evaluate([same[0],changed]),name);
 mustPass(generate([same[0],changed],{count:2}),name);
}
const nearTip=candidate('near-tip','near-tip');nearTip.game.date=iso(3600000);
nearTip.inputTimes.injuries=iso(-16*60000);nearTip.roleEvidence.inputTimes.injuries=nearTip.inputTimes.injuries;
assert.equal(leg(nearTip).available,false,'Injury evidence tightens to 15 minutes close to tip');
nearTip.inputTimes.injuries=iso(-15*60000);nearTip.roleEvidence.inputTimes.injuries=nearTip.inputTimes.injuries;
assert(leg(nearTip).available);
for(const line of [.5,400])assert(leg(candidate('line-edge','edge',{line})).available);
assert(leg(candidate('real-zeros','zero',{samples:Array(1000).fill(0)})).available,'Recorded zero outcomes remain valid');

// Never duplicate one player through combo markets or conflicting identities.
const duplicatePlayer=candidate('positive-a','g2',{key:'positive-a|assists',market:'assists',line:2.5});
mustPass(evaluate([same[0],duplicatePlayer]));
const whitespacePlayer={...duplicatePlayer,playerId:' positive-a ',roleEvidence:{...duplicatePlayer.roleEvidence,playerId:' positive-a '}};
mustPass(evaluate([same[0],whitespacePlayer]),'Whitespace may not disguise an overlapping player');
mustPass(evaluate([same[0],candidate('duplicate-key','g2',{key:same[0].key})]));
const aliasFixture=candidate('same-physical','alias',{game:{...same[0].game,id:'alias'},team:'g1A',opponent:'g1H'});
aliasFixture.roleEvidence.team='g1A';
mustPass(evaluate([same[0],aliasFixture]),'One physical game cannot be relabeled as independent games');
const contradictory=candidate('contradiction');contradictory.game.date=iso(7*3600000);
mustPass(evaluate([same[0],contradictory]),'Conflicting fixture dates are not independent support');
const ambiguousKey=structuredClone(same[0]);ambiguousKey.samples=outcomes(700);
mustPass(generate([same[0],ambiguousKey,candidate('other','g2')],{count:2}));

// A crowded fixture may not remove distinct-game candidates before search starts.
const crowded=Array.from({length:125},(_,i)=>candidate('crowded-'+String(i).padStart(3,'0'),'crowded',{score:100}));
const diverse=generate([...crowded,candidate('other-1','other-1',{score:85}),candidate('other-2','other-2',{score:85})]);
assert(diverse.available,diverse.reason);assert.equal(new Set(diverse.legs.map(p=>p.gameId)).size,3);
const missingGame=generate([same[0],same[1],candidate('only-other','g2')]);
mustPass(missingGame);assert.equal(missingGame.legs.length,2);assert.equal(missingGame.shortfall,1);
assert.equal(missingGame.legFrequencies.length,2);assert.match(missingGame.reason,/no filler/);
mustPass(generate([candidate('tiny','tiny',{line:.5}),candidate('normal','normal')],{count:2}),'No artificially low market floors');
for(const options of [{count:1},{count:5},{count:2.5},{mode:'unknown'},{mode:'sgp'},{now:NaN}])mustPass(generate(ranked,options));
for(const rows of [[],[same[0]],Array(5).fill(same[0]),null])mustPass(evaluate(rows));

// Uncertain teammate scenarios are explicitly sensitivity tests, not injury forecasts.
const withSensitivity=candidate('sensitivity','sensitivity',{availabilitySensitivity:{type:'equal_weight_in_out',players:['Uncertain Teammate']}});
const disclosed=evaluate([same[0],withSensitivity]);assert(disclosed.available,disclosed.reason);
assert.equal(disclosed.availabilitySensitivity.used,true);assert.equal(disclosed.availabilitySensitivity.probabilityValidated,false);
assert.deepEqual(disclosed.availabilitySensitivity.players,['Uncertain Teammate']);
assert.match(disclosed.limits.join(' '),/equally weighted in\/out sensitivity for Uncertain Teammate/);
assert.match(disclosed.limits.join(' '),/not estimated real-world participation probabilities/);

// Pure deterministic selection and settlement: odds cannot alter matchup research.
const before=JSON.stringify(ranked),again=generate([...ranked].reverse());
assert.equal(JSON.stringify(ranked),before);assert.deepEqual(again,balanced,'Input ordering cannot change the draft');
assert.deepEqual(generate([...ranked,...ranked]),balanced,'Identical source duplicates cannot increase support');
const withOdds=ranked.map(p=>({...p,odds:-10000,impliedWinProbability:.99,expectedValue:999}));
const priced=generate(withOdds);
assert.deepEqual(priced.legs.map(p=>p.key),balanced.legs.map(p=>p.key));near(priced.objective.score,balanced.objective.score);
const settleBefore=JSON.stringify([pushA,pushB]);evaluate([pushA,pushB]);assert.equal(JSON.stringify([pushA,pushB]),settleBefore);
const sandbox={CookNBAPropLines:lines};vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(require.resolve('../nba_parlay'),'utf8'),sandbox);
assert.deepEqual(JSON.parse(JSON.stringify(sandbox.PropShopNBAParlay.generate(ranked,{now}))),balanced);
console.log('NBA parlay: balanced selection, role/source gates, strict book-line pushes, shared-outcome correlations, explicit cross-game independence, diversity and deterministic odds-independent research PASS');
