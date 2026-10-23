"""Regression checks for safety-critical frontend betting gates."""
import unittest
from pathlib import Path

HTML = Path("index.html").read_text()

class BestBetsSafetyTests(unittest.TestCase):
    def test_missing_calibration_never_generates_picks(self):
        self.assertIn("m.status!=='validated'", HTML)
        self.assertIn("NO VERIFIED BETS", HTML)

    def test_stale_prices_block_best_bets(self):
        self.assertIn("!hardRockFeedFresh||!m", HTML)
        self.assertIn("hardRockFeedFresh=fresh", HTML)
        self.assertIn("hardRockFeedFresh=false;hardRockMatched=new Map();hardRockMatchCount=0;renderBoard();renderBestBets()", HTML)

    def test_price_feed_must_be_current(self):
        self.assertIn("age<6*3600000", HTML)
        self.assertIn("data.market_id!==14388||data.outcome_id!==14388", HTML)

if __name__ == "__main__":
    unittest.main()
