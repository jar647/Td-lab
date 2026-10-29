(function (root) {
  'use strict';

  // Keep Josh Jacobs visible during the small, verified sample immediately
  // after his 2026 Week 7 return. The box score itself must prove the return.
  function isJacobsLimitedReturnSample(row) {
    if (!row || String(row.player || '').trim().toLowerCase() !== 'josh jacobs'
      || String(row.team || '').toUpperCase() !== 'GB'
      || String(row.pos || '').toUpperCase() !== 'RB'
      || row.playerAppearancesVerified !== true
      || Number(row.games) < 1 || Number(row.games) >= 3
      || !Array.isArray(row.seasonGameStats)) return false;

    return row.seasonGameStats.some(game => Number(game.week) === 7
      && Number(game.rushAttempts) > 0);
  }

  const api = { isJacobsLimitedReturnSample };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CookItUpNFLReturns = api;
})(globalThis);
