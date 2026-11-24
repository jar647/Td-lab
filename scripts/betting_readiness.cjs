/* Read-only NBA + NFL betting reliability gate.
 * Retrospective simulation samples and heuristic scores never certify bets.
 * The browser and CLI read the same published source snapshots. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PropShopBettingReadiness = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const num = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const count = value => Number.isInteger(value) && value >= 0 ? value : 0;
  const round = (value, digits = 3) => {
    const x = num(value);
    return x === null ? null : Number(x.toFixed(digits));
  };
  const missing = (value, label) => value === null ? label + ' missing' : null;
  const percent = value => value === null ? null : round(value * 100, 2);
  const evidence = (available, detail) => ({ pass: available === true, detail });

  function evaluate(sources = {}, now = Date.now()) {
    const { nbaReport, nbaAccuracy, nbaMarket, nflAudit, nflSummary, nflMarket } = sources;
    const p = nbaReport?.prospective || {};
    const n = nflAudit?.results || {};
    const nflHistorical = nflMarket?.results || {};
    const generated = Date.parse(nbaReport?.generated_at || '');
    const ageHours = Number.isFinite(generated) && Number.isFinite(now)
      ? round(Math.max(0, (now - generated) / 3600000), 1) : null;
    const nbaGames = count(p.games);
    const nflGames = count(nflAudit?.games);
    const totalBrier = round(p.brier);
    const baselineBrier = round(p.baseline_brier);
    const modelTotal = round(p.total_mae);
    const baselineTotal = round(p.baseline_total_mae);
    const modelMargin = round(p.margin_mae);
    const baselineMargin = round(p.baseline_margin_mae);
    const nflAtsBrier = round(n.home_cover?.brier);
    const nflTotalBrier = round(n.over?.brier);
    const nflMlBrier = round(n.home_win?.brier);
    const nflPrices = count(nflMarket?.coverage?.moneyline_prices);
    const nbaPriceVerified = nbaMarket?.status === 'ok' && nbaMarket?.live_price_verified === true;
    const nbaModelApproved = nbaReport?.promotion === 'APPROVED' && nbaReport?.calibration_approved === true;
    const nflModelApproved = nflSummary?.production_promotion_eligible === true &&
      nflAudit?.status === 'PROSPECTIVE_CALIBRATED' && nflSummary?.calibration_approved === true;
    // A retrospective comparison, even with hundreds of rows, cannot count as
    // independent forward validation or prove that any price is executable.
    const nflProspective = count(nflSummary?.independent_prospective_games);
    const nbaChecks = {
      sameModelForwardHistory: evidence(nbaGames >= 100, nbaGames + ' frozen games for current simulator; 100 minimum for score review'),
      betterMarginThanBaseline: evidence(modelMargin !== null && baselineMargin !== null && modelMargin < baselineMargin,
        'Margin MAE ' + String(modelMargin) + ' vs baseline ' + String(baselineMargin)),
      betterTotalThanBaseline: evidence(modelTotal !== null && baselineTotal !== null && modelTotal < baselineTotal,
        'Total MAE ' + String(modelTotal) + ' vs baseline ' + String(baselineTotal)),
      winnerBrierVsBaseline: evidence(totalBrier !== null && baselineBrier !== null && totalBrier < baselineBrier,
        'Winner Brier ' + String(totalBrier) + ' vs baseline ' + String(baselineBrier)),
      currentReport: evidence(ageHours !== null && ageHours <= 48, 'Current report age ' + String(ageHours) + ' hours'),
      livePrices: evidence(nbaPriceVerified, nbaPriceVerified ? 'Current NBA prices verified' : 'Live NBA sportsbook prices not verified (' + String(nbaMarket?.reason_code || 'unavailable') + ')'),
      independentBettingApproval: evidence(nbaModelApproved, 'No independently approved prospective calibration and betting-edge review')
    };
    const nflChecks = {
      independentForwardHistory: evidence(nflProspective >= 100, nflProspective + ' verified prospective games; historical audits are not a forward test'),
      winnerBrier: evidence(nflMlBrier !== null && nflMlBrier < .25,
        'Retrospective winner Brier ' + String(nflMlBrier) + ', not prospective calibration'),
      atsProbability: evidence(false, 'ATS Brier ' + String(nflAtsBrier) + '; uncalibrated (0.25 = uninformed 50/50 benchmark)'),
      totalProbability: evidence(false, 'Total Brier ' + String(nflTotalBrier) + '; uncalibrated (0.25 = uninformed 50/50 benchmark)'),
      historicalPrices: evidence(false, nflPrices + ' historical schedule moneyline quotes, not independently verified executable prices'),
      atsQuoteCoverage: evidence(false, count(nflMarket?.coverage?.home_spread_lines) + ' historical ATS lines with verified sign and settlement'),
      independentBettingApproval: evidence(nflModelApproved, 'No independent prospective calibration and betting-edge approval')
    };
    // A positive retrospective metric alone is not an approval and must not
    // override absent executable quotes, missing prospective data or a HOLD.
    const nbaValid = Object.values(nbaChecks).every(x => x.pass);
    const nflValid = Object.values(nflChecks).every(x => x.pass);
    const report = {
      schema: 'betting-readiness-v1',
      generatedAt: Number.isFinite(now) ? new Date(now).toISOString() : null,
      overall: 'RESEARCH ONLY',
      betReady: false,
      warning: 'Simulated frequencies and matchup scores are NOT validated betting probabilities. A green test or 100,000 draws cannot establish a sportsbook edge.',
      nba: {
        status: nbaValid ? 'REVIEW REQUIRED' : 'RESEARCH ONLY',
        betReady: false,
        model: nbaReport?.model || 'UNKNOWN',
        currentModelForwardGames: nbaGames,
        archivedAllModelGames: count(nbaAccuracy?.graded_games),
        marginMae: modelMargin,
        baselineMarginMae: baselineMargin,
        totalMae: modelTotal,
        baselineTotalMae: baselineTotal,
        winnerBrier: totalBrier,
        baselineWinnerBrier: baselineBrier,
        prices: nbaMarket?.status || 'unavailable',
        checks: nbaChecks
      },
      nfl: {
        status: nflValid ? 'REVIEW REQUIRED' : 'RESEARCH ONLY',
        betReady: false,
        model: nflSummary?.model_version || 'UNKNOWN',
        retrospectiveGames: nflGames,
        prospectiveGames: nflProspective,
        winnerBrier: nflMlBrier,
        atsBrier: nflAtsBrier,
        totalBrier: nflTotalBrier,
        baselineHistoricalMoneylineRoi: percent(num(nflHistorical.baseline?.moneyline_flat_stake?.roi)),
        challengerHistoricalMoneylineRoi: percent(num(nflHistorical.challenger?.moneyline_flat_stake?.roi)),
        checks: nflChecks
      }
    };
    return report;
  }

  if (typeof module === 'object' && module.exports && require.main === module) {
    const fs = require('node:fs');
    const path = require('node:path');
    const base = path.resolve(__dirname, '..', 'data');
    const read = filename => { try { return JSON.parse(fs.readFileSync(path.join(base, filename), 'utf8')); } catch (_) { return null; } };
    const result = evaluate({
      nbaReport: read('nba_simulator_report.json'),
      nbaAccuracy: read('nba_prospective_accuracy.json'),
      nbaMarket: read('nba_market_status.json'),
      nflAudit: read('game_picks_simulator_audit.json'),
      nflSummary: read('nfl_score_model_summary.json'),
      nflMarket: read('game_picks_market_comparison.json')
    });
    console.log(JSON.stringify(result, null, 2));
  }
  return { evaluate };
});
