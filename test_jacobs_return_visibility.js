'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const returns = require('./nfl_roster_overrides.js');
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
assert(html.includes("['RUSH','REC','CATCH'].includes(propCategory)"), 'verified one-game return should appear in rushing/receiving categories');
assert(html.includes('LIMITED SAMPLE · RESEARCH ONLY'), 'the one-game result must not be shown as a normal matchup signal');
assert(html.includes('SIMULATION UNAVAILABLE · only one verified game since return'), 'do not invent a scenario percentage from one game');

console.log('Josh Jacobs verified return visibility and limited-sample safeguards passed');
