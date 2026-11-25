/* Outcome-only chronological scoring distribution audit. */
'use strict';

const assert = require('node:assert/strict');
const engine = require('../nba_possession_engine.js');
const strength = require('../nba_spread_strength.js');
const efficiency = require('./nba_opponent_possession_research.cjs');
const {outcomeMetrics, summarize} = require('./nba_margin_variance_research.cjs');

const candidates = {
  current: {},
  fixedPace: {fixedPace: true},
  noTeamHeat: {noTeamHeat: true},
  noSharedHeat: {noSharedHeat: true},
  noBlowoutRotation: {noBlowoutRotation: true},
  possessionAccounting: {distributePace: true, continueAfterFTRebound: true},
  opponentEfficiency: {noTeamHeat: true},
  opponentRebounds: {},
};
const RUNS = 1000;
const SEED = 6472026;
const DAY = 86400000;
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const variance = values => {
  const center = mean(values);
  return mean(values.map(value => (value - center) ** 2));
};

function evaluate(draw, game) {
  assert.equal(draw.home.length, RUNS);
  assert.equal(draw.away.length, RUNS);
  assert.ok(draw.home.every((score, i) =>
    Number.isInteger(score) && Number.isInteger(draw.away[i]) && score !== draw.away[i]));
  for (const [team, scores] of [[game.home, draw.home], [game.away, draw.away]]) {
    const playerPoints = draw.players.filter(p => p.team === team).reduce((sum, p) => sum + p.points, 0);
    assert.ok(Math.abs(playerPoints - mean(scores)) < 1e-7, 'Player points must reconcile');
  }
  const actualTotal = game.h.pts + game.a.pts;
  const metrics = outcomeMetrics(draw, game.h.pts - game.a.pts, actualTotal);
  const totalVariance = variance(draw.home.map((score, i) => score + draw.away[i]));
  const totals = draw.home.map((score, i) => score + draw.away[i]).sort((a, b) => a - b);
  return {
    ...metrics,
    totalError: metrics.total - actualTotal,
    totalVariance,
    totalCoverage80: Number(actualTotal >= totals[Math.floor((RUNS - 1) * .1)] &&
      actualTotal <= totals[Math.floor((RUNS - 1) * .9)]),
    scoreCovariance: (totalVariance - metrics.variance) / 4,
  };
}

function report(rows, id) {
  const avg = key => mean(rows.map(row => row.models[id][key]));
  const summary = summarize(rows, id);
  return {
    ...summary,
    margin_variance_change: avg('variance') - mean(rows.map(row => row.models.current.variance)),
    total_residual_sd: Math.sqrt(avg('totalVariance')),
    actual_total_rmse: Math.sqrt(mean(rows.map(row => row.models[id].totalError ** 2))),
    total_coverage80: avg('totalCoverage80'),
    score_covariance: avg('scoreCovariance'),
  };
}

function variant(id, model, history, game, pilot) {
  const home = game.home, away = game.away;
  if (id === 'opponentEfficiency') {
    const fit = efficiency.fit(history);
    const expected = (off, def, venue) => model.pace * (fit.league + fit.off[off] + fit.def[def]) + venue;
    const venue = String(game.neutralSite) === 'true' ? 0 : strength.fit(history).home / 2;
    // Convert half the discrepancy to a bounded shot offset. This predeclared
    // partial adjustment leaves room for rotation and individual shooting inputs.
    const shotOffset = (target, draws) =>
      Math.max(-.025, Math.min(.025, (target - mean(draws)) / (model.pace * 4)));
    return {...model, strengthAnchor: {shotOffsets: {
      [home]: shotOffset(expected(home, away, venue), pilot.home),
      [away]: shotOffset(expected(away, home, -venue), pilot.away),
    }}};
  }
  if (id === 'opponentRebounds') {
    // Blend offensive rebound tendencies with the opponent's recent allowance.
    // Center on league rates to shrink samples with only a few prior games.
    const teams = Object.fromEntries([home, away].map(team => {
      const other = team === home ? away : home;
      const relevant = history.filter(row => row.home === other || row.away === other).slice(0, 12);
      let allowed = 0, opportunities = 0;
      for (const row of relevant) {
        const [defense, offense] = row.home === other ? [row.h, row.a] : [row.a, row.h];
        allowed += offense.orb;
        opportunities += offense.orb + defense.drb;
      }
      const allowance = (allowed + 240 * model.league.orb) / (opportunities + 240);
      const teamModel = model.teams[team];
      return [team, {...teamModel, orb: (teamModel.orb + allowance) / 2}];
    }));
    return {...model, teams};
  }
  return model;
}

function boxScoreRates(game, model) {
  const [home, away] = [model.teams[game.home], model.teams[game.away]];
  const efficiencyRates = box => [
    (box.fgm - box.tpm) / Math.max(1, box.fga - box.tpa),
    box.tpm / Math.max(1, box.tpa),
  ];
  const gamesPossessions = game.poss * game.duration / 48;
  const averageRate = (stat, denominator) => (game.h[stat] + game.a[stat]) / denominator;
  const weighted = (team, weight, value) => {
    const weights = team.players.map(p => team.minutes[p.id] * weight(p));
    return team.players.reduce((sum, p, i) => sum + weights[i] * value(p), 0) /
      Math.max(.001, weights.reduce((sum, x) => sum + x, 0));
  };
  const turnovers = team => {
    const rotation = team.players.reduce((sum, p) => sum + team.minutes[p.id] * p.to, 0) / team.pace;
    return Math.max(.05, Math.min(.25, (team.turnover + rotation) / 2));
  };
  const profile = (team, opponent, zone) => {
    const shots = zone === 'three' ? p => p.tpa : p => p.fga - p.tpa;
    return weighted(team, shots, p => p[zone]) + opponent[zone + 'Defense'];
  };
  return {
    pace: [model.pace, game.poss],
    turnover_rate: [mean([turnovers(home), turnovers(away), home.forceTurnover, away.forceTurnover]),
      averageRate('to', 2 * gamesPossessions)],
    two_point_accuracy: [mean([profile(home, away, 'two'), profile(away, home, 'two')]),
      mean([efficiencyRates(game.h)[0], efficiencyRates(game.a)[0]])],
    three_point_accuracy: [mean([profile(home, away, 'three'), profile(away, home, 'three')]),
      mean([efficiencyRates(game.h)[1], efficiencyRates(game.a)[1]])],
    offensive_rebound_share: [mean([home.orb, away.orb]),
      averageRate('orb', game.h.orb + game.a.orb + game.h.drb + game.a.drb)],
  };
}

function summarizeRates(rows) {
  return Object.fromEntries(Object.keys(rows[0].rates).map(key => {
    const pairs = rows.map(row => row.rates[key]);
    return [key, {
      input_mean: mean(pairs.map(([input]) => input)),
      observed_mean: mean(pairs.map(([, actual]) => actual)),
      input_error_rmse: Math.sqrt(mean(pairs.map(([input, actual]) => (input - actual) ** 2))),
    }];
  }));
}

function replay(feed, ids = Object.keys(candidates)) {
  const rows = [];
  const skipped = [];
  for (const game of engine.records(feed, Infinity).reverse()) {
    const tip = Date.parse(game.date);
    const now = tip - 1;
    const earlier = {...feed, games: feed.games.filter(row => Date.parse(row.date) < now - DAY)};
    let model, rating;
    try {
      rating = strength.prepare(game, earlier, engine, now);
      model = engine.build(game, earlier, {injuries: []}, {}, now, {historical: true});
    } catch (error) {
      skipped.push({id: game.id, reason: error.message});
      continue;
    }
    const pilot = engine.draws(model, RUNS, SEED);
    const correction = Math.max(-8, Math.min(8, rating.margin - (mean(pilot.home) - mean(pilot.away))));
    const offset = Math.max(-.025, Math.min(.025, correction / (model.pace * 4)));
    model.strengthAnchor = {shotOffsets: {[game.home]: offset, [game.away]: -offset}};
    const history = engine.records(earlier, now - DAY);
    const models = Object.fromEntries(ids.map(id => [id, evaluate(
      engine.draws(variant(id, model, history, game, pilot), RUNS, SEED,
        {researchDistribution: candidates[id]}), game)]));
    rows.push({id: game.id, date: game.date, actual: game.h.pts - game.a.pts, rates: boxScoreRates(game, model), models});
  }

  const dates = [...new Set(rows.map(row => row.date.slice(0, 10)))];
  const cutoff = dates[Math.floor(dates.length * 2 / 3)];
  const development = rows.filter(row => row.date.slice(0, 10) < cutoff);
  const holdout = rows.filter(row => row.date.slice(0, 10) >= cutoff);
  assert.ok(development.length >= 30 && holdout.length >= 20, 'Insufficient chronological games');
  const summarizeSplit = split => Object.fromEntries(ids.map(id => [id, report(split, id)]));
  const training = summarizeSplit(development);
  const testing = summarizeSplit(holdout);
  const improves = (candidate, baseline) =>
    candidate.margin_mae < baseline.margin_mae &&
    candidate.moneyline_brier <= baseline.moneyline_brier &&
    candidate.spread_brier <= baseline.spread_brier &&
    candidate.total_mae <= baseline.total_mae &&
    Math.abs(candidate.coverage80 - .8) <= Math.abs(baseline.coverage80 - .8) &&
    Math.abs(candidate.total_coverage80 - .8) <= Math.abs(baseline.total_coverage80 - .8);
  const selected = ids.filter(id => improves(training[id], training.current))
    .sort((a, b) => training[a].margin_mae - training[b].margin_mae)[0] ?? 'current';
  return {
    status: 'RESEARCH_ONLY',
    cutoff,
    draws_per_game: RUNS,
    development: training,
    holdout: testing,
    selected,
    pregame_rate_audit: {development: summarizeRates(development), holdout: summarizeRates(holdout)},
    limits: 'Same-season replay with a 24-hour embargo and no archived lineup snapshots. ' +
      'Dates overlap previous research. Rate audit compares simplified model inputs to box-score rates. ' +
      'Shot rates exclude venue, shooting shifts, shot-zone and strength adjustments. ' +
      'Possessions are box-score estimates, and the engine does not model intentional late-game fouls.',
    improves_holdout: selected !== 'current' && improves(testing[selected], testing.current),
    reaches_margin_target: testing[selected].margin_mae <= 7,
    skipped,
    rows,
  };
}

if (require.main === module) {
  const fs = require('node:fs');
  const feed = JSON.parse(fs.readFileSync(process.argv[2] ?? 'data/nba_games.json', 'utf8'));
  const ids = process.argv.slice(3);
  assert.ok(!ids.length || (ids.includes('current') && ids.every(id => Object.hasOwn(candidates, id))));
  console.log(JSON.stringify(replay(feed, ids.length ? ids : undefined), null, 2));
}
