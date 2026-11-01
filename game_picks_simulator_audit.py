#!/usr/bin/env python3
"""Compatibility entry point: audit the production JS engine, not a normal CDF."""
import subprocess
from pathlib import Path

if __name__ == "__main__":
    root = Path(__file__).resolve().parent
    subprocess.run(["node", "game_odds_backtest.js", "data/game_picks_backtest.json",
                    "data/game_picks_market_comparison.json", "data/game_picks_simulator_audit.json"],
                   cwd=root, check=True)
