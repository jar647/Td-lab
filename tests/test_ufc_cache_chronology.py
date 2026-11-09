"""Regression tests for UFC cache timestamp integrity."""
import copy
import unittest
from scripts.validate_ufc_cache import validate


class TestUFCCacheChronology(unittest.TestCase):
    def setUp(self):
        self.data = {
            "generated_at": "2026-11-08T20:00:00+00:00",
            "fighters": {
                "test fighter": {
                    "id": "fighter-1", "name": "Test Fighter",
                    "stats": {"slpm": None, "sapm": None, "strAcc": None,
                              "strDef": None, "tdAvg": None, "tdAcc": None,
                              "tdDef": None, "subAvg": None},
                    "fetched_at": "2026-11-07T12:00:00+00:00",
                    "checked_at": "2026-11-08T12:00:00+00:00",
                }
            },
        }

    def test_valid_chronology(self):
        self.assertEqual(validate(copy.deepcopy(self.data)), (1, 0))

    def test_future_fetch_rejected(self):
        data = copy.deepcopy(self.data)
        data["fighters"]["test fighter"]["fetched_at"] = "2026-11-09T12:00:00+00:00"
        with self.assertRaises(AssertionError):
            validate(data)

    def test_future_check_rejected(self):
        data = copy.deepcopy(self.data)
        data["fighters"]["test fighter"]["checked_at"] = "2026-11-09T12:00:00+00:00"
        with self.assertRaises(AssertionError):
            validate(data)

    def test_check_before_fetch_rejected(self):
        data = copy.deepcopy(self.data)
        data["fighters"]["test fighter"]["checked_at"] = "2026-11-06T12:00:00+00:00"
        with self.assertRaises(AssertionError):
            validate(data)

    def test_naive_cache_timestamp_rejected(self):
        data = copy.deepcopy(self.data)
        data["generated_at"] = "2026-11-08T20:00:00"
        with self.assertRaises(AssertionError):
            validate(data)


if __name__ == "__main__":
    unittest.main()
