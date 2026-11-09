'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {describe} = require('../ufc_matchup_research.js');

function report(status) {
  const fight = {
    bout_id: 'historical-bout',
    fighter_a: 'a', fighter_b: 'other',
    winner: 'a', method_display: 'KO/TKO',
    event_date: '2024-01-01T00:00:00Z'
  };
  if (status !== undefined) fight.status = status;
  return describe({}, {}, {
    names: ['A', 'B'],
    asOf: '2025-01-01T00:00:00Z',
    profiles: [
      {id: 'a', recent_fights: [fight]},
      {id: 'b', recent_fights: []}
    ]
  }).recentEvidence[0];
}
test('missing fight status is not counted as verified recent result', () => {
  assert.equal(report(undefined).sample, 0);
});
test('scheduled fight status is not counted as a result', () => {
  assert.equal(report('scheduled').sample, 0);
});
test('explicit final fight status is counted', () => {
  assert.equal(report('final').sample, 1);
  assert.equal(report('final').koWins, 1);
});
test('explicit completed fight status is counted', () => {
  assert.equal(report('completed').sample, 1);
});
