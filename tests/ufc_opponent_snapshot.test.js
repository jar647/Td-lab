'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {describe} = require('../ufc_matchup_research.js');

function profile(id, recordAsOf) {
  return {
    id,
    fetched_at: '2025-01-01T00:00:00Z',
    recent_fights: [{
      bout_id: 'past-' + id,
      fighter_a: id,
      fighter_b: 'opponent-' + id,
      fighter_a_name: 'Fighter ' + id,
      fighter_b_name: 'Opponent ' + id,
      winner: id,
      status: 'final',
      method_display: 'Decision',
      event_date: '2024-01-01T00:00:00Z',
      opponent_record: {wins: 15, losses: 2},
      opponent_record_source: 'Verified source',
      ...(recordAsOf ? {opponent_record_as_of: recordAsOf} : {})
    }]
  };
}
const options = recordAsOf => ({
  names: ['Alpha', 'Bravo'],
  asOf: '2025-06-01T00:00:00Z',
  profiles: [profile('alpha', recordAsOf), profile('bravo', recordAsOf)]
});
test('historical opponent quality excludes records with no snapshot timestamp', () => {
  const report = describe({}, {}, options(null));
  assert.deepEqual(report.opponentQuality.map(x => x.verified), [0, 0]);
});
test('historical opponent quality excludes records captured after prediction', () => {
  const report = describe({}, {}, options('2025-07-01T00:00:00Z'));
  assert.deepEqual(report.opponentQuality.map(x => x.verified), [0, 0]);
});
test('historical opponent quality admits sourced records frozen before prediction', () => {
  const report = describe({}, {}, options('2023-12-01T00:00:00Z'));
  assert.deepEqual(report.opponentQuality.map(x => x.verified), [1, 1]);
});
test('live scouting may display sourced records without historical snapshot date', () => {
  const opts = options(null);
  delete opts.asOf;
  const report = describe({}, {}, opts);
  assert.deepEqual(report.opponentQuality.map(x => x.verified), [1, 1]);
});

test('historical opponent quality rejects a record captured after the opponent bout even if before prediction', () => {
  const report = describe({}, {}, options('2025-05-01T00:00:00Z'));
  assert.deepEqual(report.opponentQuality.map(x => x.verified), [0, 0]);
});

test('opponent quality rejects scheduled and status-unknown bouts even with sourced records', () => {
  for (const status of ['scheduled', 'cancelled', undefined]) {
    const opts = options('2023-12-01T00:00:00Z');
    for (const profile of opts.profiles) {
      if (status === undefined) delete profile.recent_fights[0].status;
      else profile.recent_fights[0].status = status;
    }
    const report = describe({}, {}, opts);
    assert.deepEqual(report.opponentQuality.map(x => x.verified), [0, 0]);
  }
});
test('opponent quality accepts completed bouts with sourced pre-bout records', () => {
  const opts = options('2023-12-01T00:00:00Z');
  for (const profile of opts.profiles) profile.recent_fights[0].status = 'completed';
  assert.deepEqual(describe({}, {}, opts).opponentQuality.map(x => x.verified), [1, 1]);
});
