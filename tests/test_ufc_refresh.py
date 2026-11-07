import importlib.util
import unittest

spec = importlib.util.spec_from_file_location("refresh_ufc", "scripts/refresh_ufc.py")
refresh = importlib.util.module_from_spec(spec)
spec.loader.exec_module(refresh)


class UFCRefreshTests(unittest.TestCase):
    def setUp(self):
        self.rates = {"sig_landed_per_15": 60, "sig_absorbed_per_15": 45,
                      "sig_accuracy": .48, "sig_defense": .55, "td_per_15": 1.8,
                      "td_accuracy": .42, "td_defense": .72, "sub_attempts_per_15": .4}

    def test_units(self):
        data = refresh.stats({"career_rates": self.rates})
        self.assertEqual(data["slpm"], 4)
        self.assertEqual(data["sapm"], 3)
        self.assertEqual(data["strAcc"], 48)
        self.assertEqual(data["tdAvg"], 1.8)

    def test_explicit_percent_is_not_fraction(self):
        self.rates["sig_accuracy"] = "1%"
        self.assertEqual(refresh.stats({"career_rates": self.rates})["strAcc"], 1)

    def test_missing_or_invalid_never_becomes_zero(self):
        for value in (None, True, "", "nan", -1, float("inf")):
            self.rates["sig_accuracy"] = value
            self.assertIsNone(refresh.stats({"career_rates": self.rates}))


if __name__ == "__main__":
    unittest.main()
