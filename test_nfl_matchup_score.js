/* Run: node test_nfl_matchup_score.js */
'use strict';
const assert=require('node:assert/strict');
const score=require('./nfl_goal1.js');

assert.equal(score.MIN_SCORE,70);
for(const value of [70,70.001,84.999,85,100,'70'])assert.equal(score.qualifies(value),true);
for(const value of [69,69.99,69.999,100.001,-1,null,undefined,'',NaN,Infinity,'garbage',true,[70]])
 assert.equal(score.qualifies(value),false,'reject invalid or below-minimum score '+value);

const runner={defRushYardsAllowed:100,defRushAttemptsAllowed:20,playerRushYards:100,playerCarries:20};
assert.equal(score.matchupScore(runner,'RUSH'),100);
const averageRunner={defRushYardsAllowed:50,defRushAttemptsAllowed:10,playerRushYards:50,playerCarries:10};
assert.equal(score.matchupScore(averageRunner,'RUSH'),50);
assert.equal(score.matchupScore({...averageRunner,recent3Carries:20,snapShare:1},'RUSH'),59,
 'existing capped trend and snap role bonuses remain on the main-board scale');
assert.equal(score.matchupScore({...runner,recent3Carries:40,snapShare:1},'RUSH'),100,
 'bonuses never increase the bounded rating past 100');
assert.equal(score.matchupScore({...runner,defRushAttemptsAllowed:undefined},'RUSH'),null);
assert.equal(score.matchupScore({...runner,playerCarries:Infinity},'RUSH'),null);
assert.equal(score.matchupScore({...runner,playerRushYards:-1},'RUSH'),null);
assert.equal(score.matchupScore(runner,'unsupported'),null);
assert.equal(score.matchupScore(null,'RUSH'),null);
assert.equal(score.matchupScore({defRushYardsAllowed:0,defRushAttemptsAllowed:0,playerRushYards:0,playerCarries:0},'RUSH'),0);

const receiver={defRecYardsAllowed:65,defTargetsAllowed:6.5,playerRecYards:50,playerTargets:5};
assert.equal(score.matchupScore(receiver,'REC'),50);
assert.equal(score.matchupScore({...receiver,playerTargetShare:41,airYardsPerGame:125},'REC'),55,
 'receiving role and air-yard bonuses retain their existing caps');
assert.equal(score.matchupRating({...runner,scenarioRate:.01},'RUSH').score,
 score.matchupRating({...runner,scenarioRate:.99},'RUSH').score,
 'scenario frequency is independent of the matchup score');

const candidate=(id,researchScore,rawRank)=>({p:{player_id:id},d:{key:'rushYards'},researchScore,score:rawRank});
const candidates=[candidate('weak',69.99,999),candidate('boundary',70,100),candidate('strong',100,90),candidate('unrated',undefined,1000)];
assert.deepEqual(score.rankPlayers(candidates,3).map(c=>c.p.player_id),['boundary','strong'],
 'high raw rank cannot bypass the independent matchup-score requirement');
assert.deepEqual(score.buildTicket(candidates,10).map(c=>c.p.player_id),['boundary','strong']);
assert.equal(score.eligibleCandidate(null),false);
console.log('NFL shared matchup rating and minimum-score gate passed');
