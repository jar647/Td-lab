# CoOk It Up

AI-powered NFL and NBA sports analytics research app (previously THE PROP VAULT).

Live app: https://jar647.github.io/Td-lab/
NFL game analyst: https://jar647.github.io/Td-lab/analyst.html
NBA edition: https://jar647.github.io/Td-lab/nba.html

Research outputs are not a guarantee of betting outcomes. The existing Github Pages URLs, model, data feeds, and browser storage keys are intentionally preserved during rebranding.

## Experimental two-sided player price audit

NFL and NBA player cards compare a manually entered Vegas line and optional Over/Under American odds with experimental probabilities estimated from **actual recorded player-game outcomes**. The current algorithm uses a historical game average and dispersion, conservative uncertainty floors, a matchup-projection adjustment shrunk 25% toward actual game production, and a normal predictive distribution with integer push handling. It reports Over/Under estimated rates, break-even odds, an unvalidated probability-gap calculation, and **hypothetical** return per dollar at the quoted price. At least five real player games are required to show an estimate; at least eight, favorable price math, and a conservative sensitivity check are required to label even a *research candidate*.

**Not a validated betting model:** independent out-of-sample probability calibration against outcomes and fresh verified sportsbook odds do not exist yet. All estimates are explicitly experimental, candidates are *not* PLAY calls, and every result includes NO VERIFIED PLAY. Missing game data, questionable/invalid availability, invalid odds and poor prices lead to PASS. User-entered odds are saved locally per player/game/market; no sportsbook odds are invented. A quoted market's no-vig probabilities are not the same as our modeled hit rate. The original simulations, forward-prediction tracking and verification gates remain unchanged.
