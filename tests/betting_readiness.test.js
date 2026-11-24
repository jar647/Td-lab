'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate } = require('../betting_readiness.js');
const now = Date.parse('2026-11-24T12:00:00Z');
const input = () => ({
  nbaReport: { model: 'nba-prospective-v1', generated_at: new Date(now - 60000).toISOString(),
    prospective: { games: 23, margin_mae: 8.54, baseline_margin_mae: 8.36, total_mae: 20.16,
      baseline_total_mae: 19.52, brier: .212, baseline_brier: .230 }, promotion: 'OFF' },
  nbaAccuracy: { graded_games: 118, validated_for_betting: false },
  nbaMarket: { status: 'unavailable', live_price_verified: false, reason_code: 'provider_rate_limit' },
  nflAudit: { status: 'CURRENT_BOOTSTRAP_AUDIT_NOT_CALIBRATED', games: 280,
    results: { home_win: { games: 279, brier: .229 }, home_cover: { games: 278, brier: .271 },
      over: { games: 280, brier: .269 } } },
  nflSummary: { model_version: 'ridge-v1', production_promotion_eligible: false },
  nflMarket: { status: 'HISTORICAL_RESEARCH_ONLY', coverage: { moneyline_prices: 446, home_spread_lines: 0 },
    results: { baseline: { moneyline_flat_stake: { roi: -.0197 } },
      challenger: { moneyline_flat_stake: { roi: -.0462 } } } }
});
test('current-model forward sample cannot borrow older-model forecast counts', () => {
  const r = evaluate(input(), now);
  assert.equal(r.betReady, false);
  assert.equal(r.nba.currentModelForwardGames, 23);
  assert.equal(r.nba.archivedAllModelGames, 118);
  assert.equal(r.nba.checks.sameModelForwardHistory.pass, false);
  assert.equal(r.nba.checks.betterMarginThanBaseline.pass, false);
  assert.equal(r.nba.checks.betterTotalThanBaseline.pass, false);
  assert.equal(r.nba.checks.winnerBrierVsBaseline.pass, true);
});
test('retrospective NFL records, market proxies and 100,000 draws never approve bets', () => {
  const r = evaluate(input(), now);
  assert.equal(r.nfl.retrospectiveGames, 280);
  assert.equal(r.nfl.prospectiveGames, 0);
  assert.equal(r.nfl.atsBrier, .271);
  assert.equal(r.nfl.totalBrier, .269);
  assert.equal(r.nfl.checks.atsProbability.pass, false);
  assert.equal(r.nfl.checks.historicalPrices.pass, false);
  assert.equal(r.nfl.status, 'RESEARCH ONLY');
});
test('missing, null, malformed and stale data fail closed, not green', () => {
  const a = evaluate({}, now);
  assert.equal(a.betReady, false);
  assert.equal(a.nba.checks.currentReport.pass, false);
  assert.equal(a.nfl.checks.winnerBrier.pass, false);
  const s = input();
  s.nbaReport.generated_at = new Date(now - 72 * 3600000).toISOString();
  s.nbaReport.prospective.games = '500';
  s.nbaMarket.status = 'ok';
  s.nbaMarket.live_price_verified = false;
  assert.equal(evaluate(s, now).nba.checks.currentReport.pass, false);
  assert.equal(evaluate(s, now).nba.checks.sameModelForwardHistory.pass, false);
  assert.equal(evaluate(s, now).nba.checks.livePrices.pass, false);
});
test('passing numerical checks alone cannot grant betting approval', () => {
  const s = input();
  s.nbaReport.prospective = { games: 200, margin_mae: 7, baseline_margin_mae: 8,
    total_mae: 18, baseline_total_mae: 20, brier: .2, baseline_brier: .25 };
  s.nbaReport.promotion = 'APPROVED';
  s.nbaMarket.status = 'ok';
  s.nbaMarket.live_price_verified = true;
  const report = evaluate(s, now);
  assert.equal(report.nba.checks.independentBettingApproval.pass, false);
  assert.equal(report.nba.betReady, false);
  assert.equal(report.betReady, false);
});
test('unknown probability or score errors are not misrepresented as zero', () => {
  const s = input();
  s.nbaReport.prospective.brier = null;
  s.nflAudit.results.home_cover.brier = Infinity;
  const report = evaluate(s, now);
  assert.equal(report.nba.winnerBrier, null);
  assert.equal(report.nba.checks.winnerBrierVsBaseline.pass, false);
  assert.equal(report.nfl.atsBrier, null);
});
