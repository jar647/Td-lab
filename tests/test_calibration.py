import unittest
from scripts.calibrate_td import fit, score_to_bucket

class CalibrationTests(unittest.TestCase):
    def test_bucket_bounds(self):
        self.assertEqual(score_to_bucket(0), 0)
        self.assertEqual(score_to_bucket(99), 9)
        self.assertEqual(score_to_bucket(100), 9)

    def test_monotonic_probabilities(self):
        rows = [(0, 1)] * 10 + [(1, 0)] * 10 + [(9, 1)] * 10
        probabilities = fit(rows)
        self.assertEqual(len(probabilities), 10)
        self.assertTrue(all(0 < p < 1 for p in probabilities))
        self.assertTrue(all(a <= b for a, b in zip(probabilities, probabilities[1:])))

    def test_empty_rows_do_not_claim_certainty(self):
        probabilities = fit([])
        self.assertTrue(all(0 < p < 1 for p in probabilities))

if __name__ == "__main__":
    unittest.main()
