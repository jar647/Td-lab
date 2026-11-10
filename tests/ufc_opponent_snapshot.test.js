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

test('invalid duplicate does not hide a later sourced snapshot for the same bout', () => {
  const opts = options('2023-12-01T00:00:00Z');
  for (const p of opts.profiles) {
    const valid = p.recent_fights[0];
    p.recent_fights.unshift({...valid, bout_id: '  '+valid.bout_id+'  ', opponent_record_source: ''});
  }
  const report = describe({}, {}, opts);
  assert.deepEqual(report.opponentQuality.map(x => x.verified), [1, 1]);
});

test('duplicate valid snapshots with whitespace count as only one opponent', () => {
  const opts = options('2023-12-01T00:00:00Z');
  for (const p of opts.profiles) {
    const valid = p.recent_fights[0];
    p.recent_fights.push({...valid, bout_id: ' '+valid.bout_id+' '});
  }
  const report = describe({}, {}, opts);
  assert.deepEqual(report.opponentQuality.map(x => x.verified), [1, 1]);
});

test('recent-form evidence counts duplicate bout IDs with whitespace only once', () => {
  const opts = options('2023-12-01T00:00:00Z');
  delete opts.asOf;
  for (const p of opts.profiles) {
    const fight = p.recent_fights[0];
    p.recent_fights.push({...fight, bout_id: '  ' + fight.bout_id + '  '});
  }
  const report = describe({}, {}, opts);
  assert.deepEqual(report.recentEvidence.map(x => x.sample), [1, 1]);
  assert.deepEqual(report.recentEvidence.map(x => x.wins), [1, 1]);
});

test('recent form selects five most recent results regardless of feed order', () => {
  const opts = options('2023-12-01T00:00:00Z');
  delete opts.asOf;
  for (const p of opts.profiles) {
    const template = p.recent_fights[0];
    p.recent_fights = [1, 6, 2, 5, 3, 4].map(n => ({
      ...template,
      bout_id: 'bout-' + p.id + '-' + n,
      event_date: '2024-01-' + String(n).padStart(2, '0') + 'T00:00:00Z',
      winner: n === 1 ? 'opponent-' + p.id : p.id
    }));
  }
  const report = describe({}, {}, opts);
  assert.deepEqual(report.recentEvidence.map(x => x.sample), [5, 5]);
  assert.deepEqual(report.recentEvidence.map(x => x.wins), [5, 5]);
});
test('newer duplicate of same bout wins independently of input ordering', () => {
  const opts = options('2023-12-01T00:00:00Z');
  delete opts.asOf;
  for (const p of opts.profiles) {
    const f = p.recent_fights[0];
    p.recent_fights = [
      {...f, event_date: '2024-01-01T00:00:00Z', winner: 'opponent-' + p.id},
      {...f, event_date: '2024-01-02T00:00:00Z', winner: p.id}
    ];
  }
  const report = describe({}, {}, opts);
  assert.deepEqual(report.recentEvidence.map(x => x.sample), [1, 1]);
  assert.deepEqual(report.recentEvidence.map(x => x.wins), [1, 1]);
});

test('recent form excludes undated results even when marked final', () => {
  const opts = options('2023-12-01T00:00:00Z');
  delete opts.asOf;
  for (const p of opts.profiles) {
    delete p.recent_fights[0].event_date;
    delete p.recent_fights[0].starts_at;
  }
  assert.deepEqual(describe({}, {}, opts).recentEvidence.map(x => x.sample), [0, 0]);
});
test('recent form excludes implausible future results', () => {
  const opts = options('2023-12-01T00:00:00Z');
  delete opts.asOf;
  for (const p of opts.profiles) p.recent_fights[0].event_date = '2099-01-01T00:00:00Z';
  assert.deepEqual(describe({}, {}, opts).recentEvidence.map(x => x.sample), [0, 0]);
});
