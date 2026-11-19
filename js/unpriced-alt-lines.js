/* Issue #130: unpriced alternate OVER research, independent of sportsbook quotes. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PropShopAltLines = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function overResearch(samples, thresholds, opts) {
    opts = opts || {};
    if (!Array.isArray(samples) || !samples.length || !samples.every(Number.isFinite))
      return { status: 'unavailable', reason: 'Missing or invalid simulation samples', lines: [] };
    if (opts.stale || opts.injuryUnresolved)
      return { status: 'unavailable', reason: opts.stale ? 'Stale data' : 'Unresolved availability', lines: [] };
    const minSamples = opts.minSamples == null ? 100 : opts.minSamples;
    if (!Number.isInteger(minSamples) || minSamples < 1 || samples.length < minSamples)
      return { status: 'unavailable', reason: 'Insufficient simulation samples', lines: [] };
    if (!Array.isArray(thresholds) || !thresholds.every(Number.isFinite))
      return { status: 'unavailable', reason: 'Invalid alternate lines', lines: [] };
    const unique = [...new Set(thresholds)].sort((a, b) => a - b);
    return {
      status: 'research-only',
      priced: false,
      calibrated: false,
      sampleSize: samples.length,
      rating: Number.isFinite(opts.rating) ? opts.rating : null,
      ratingIsProbability: false,
      sourceUpdatedAt: opts.sourceUpdatedAt || null,
      lines: unique.map(line => ({
        line,
        direction: 'OVER',
        // Strict greater-than correctly handles whole-number pushes.
        probability: samples.filter(value => value > line).length / samples.length,
        pushProbability: samples.filter(value => value === line).length / samples.length,
        label: 'Unpriced research target',
        expectedValue: null,
        sportsbookAvailable: null
      }))
    };
  }
  return { overResearch };
});
