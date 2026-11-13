'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const returns = require('./nfl_roster_overrides.js');
const board = require('./nfl_player_board.js');
const html = fs.readFileSync('index.html', 'utf8');

const jacobs = {
  player: 'Josh Jacobs', team: 'GB', pos: 'RB', games: 1,
  playerAppearancesVerified: true,
  seasonGameStats: [{ week: 7, rushAttempts: 11, rushYards: 36 }]
};
assert.equal(returns.isJacobsLimitedReturnSample(jacobs), true);
assert.equal(returns.isJacobsLimitedReturnSample({ ...jacobs, team: 'LV' }), false);
assert.equal(returns.isJacobsLimitedReturnSample({ ...jacobs, games: 3 }), false);
assert.equal(returns.isJacobsLimitedReturnSample({ ...jacobs, playerAppearancesVerified: false }), false);
assert.equal(returns.isJacobsLimitedReturnSample({ ...jacobs, seasonGameStats: [{ week: 7, rushAttempts: 0 }] }), false);

assert(html.includes('src="./nfl_roster_overrides.js"'), 'NFL return sample helper must load before the app');
const rosterRecord={...jacobs,player_id:'jacobs',opp:'CHI',market:'ATD',availability:'ROSTER_ACTIVE'};
for(const category of ['RUSH','REC','CATCH']){
 const rows=board.rows([rosterRecord],category,{ratingFor:()=>({score:95,performanceScore:90,opponentScore:100})});
 assert.equal(rows.length,1,'the complete '+category+' board includes a verified one-game return');
 assert.equal(rows[0].record.player,'Josh Jacobs');
 assert.equal(rows[0].recommendable,false,'one verified game cannot qualify as a normal recommendation');
 assert.match(rows[0].statusLabel,/Limited sample.*research only/);
 assert.match(rows[0].reasons.join(' '),/1 verified game.*3 required/);
}
assert(html.includes('const limitedSample=CookItUpNFLReturns.isJacobsLimitedReturnSample(x.r)'), 'the renderer must still apply the one-game return simulation safeguard');
assert(html.includes('SIMULATION UNAVAILABLE · only one verified game since return'), 'do not invent a scenario percentage from one game');

console.log('Josh Jacobs verified return visibility and limited-sample safeguards passed');
