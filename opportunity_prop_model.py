"""Opportunity-aware research candidate for NFL player props.

Only uses previously completed player games. Not a fitted probability distribution:
historical game outcomes are rescaled by the expected opportunity share.
Calibrate against out-of-sample seasons before any live deployment.
"""
MARKET_OPPORTUNITY = {
    "passing_yards": "attempts",
    "rushing_yards": "carries",
    "receiving_yards": "targets",
    "receptions": "targets",
}

def opportunity_probability(stats, opportunities, threshold, recent_weight=0.35):
    """Smoothed empirical P(stat > threshold), accounting for usage changes.

    Pre-game candidate expected volume blends full prior season and recent five.
    Earlier observed games are rescaled in bounded fashion; no future data.
    """
    if len(stats) != len(opportunities) or len(stats) < 5:
        raise ValueError("Five aligned prior games required")
    if not 0 <= recent_weight <= 1:
        raise ValueError("recent_weight must be between zero and one")
    if any(s < 0 for s in stats) or any(o < 0 for o in opportunities):
        raise ValueError("Negative statistics/opportunities are invalid")
    avg = sum(opportunities) / len(opportunities)
    latest = sum(opportunities[-5:]) / 5
    expected = (1 - recent_weight) * avg + recent_weight * latest
    adjusted = []
    for stat, volume in zip(stats, opportunities):
        # Zero opportunity cannot support a nonzero output. Preserve zero
        # outcome games, but avoid divide-by-zero when rescaling.
        if volume == 0:
            adjusted.append(0.0)
        else:
            factor = max(0.5, min(1.5, expected / volume))
            adjusted.append(stat * factor)
    return (1 + sum(v > threshold for v in adjusted)) / (len(adjusted) + 2)
