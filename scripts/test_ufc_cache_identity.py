"""Regression checks for scheduled fighter/profile ID normalization.

Run: python -m unittest discover -s scripts -p 'test_ufc_cache_identity.py'
"""
import copy
import unittest

from validate_ufc_cache import validate


def fixture():
    stats = {
        "slpm": 3.1, "sapm": 2.2, "strAcc": 50, "strDef": 55,
        "tdAvg": 1.2, "tdAcc": 40, "tdDef": 60, "subAvg": 0.2,
    }
    return {
        "generated_at": "2026-11-09T00:00:00Z",
        "fighters": {
            "fighter one": {"id": " 101 ", "name": "Fighter One", "stats": copy.deepcopy(stats)},
            "fighter two": {"id": "202", "name": "Fighter Two", "stats": copy.deepcopy(stats)},
        },
        "bouts": [{
            "bout_id": "bout-1", "fighter_a": "101",
            "fighter_a_name": "Fighter One", "fighter_b": "202",
            "fighter_b_name": "Fighter Two",
        }],
        "scheduled_bouts": 1,
    }


class FighterCacheIdentityTests(unittest.TestCase):
    def test_profile_id_surrounding_whitespace_is_normalized(self):
        self.assertEqual(validate(fixture()), (2, 2))

    def test_different_profile_id_is_rejected(self):
        data = fixture()
        data["fighters"]["fighter one"]["id"] = "999"
        with self.assertRaisesRegex(AssertionError, "Scheduled fighter profile missing or mismatched"):
            validate(data)

    def test_duplicate_normalized_profile_ids_are_rejected(self):
        data = fixture()
        data["fighters"]["fighter two"]["id"] = "101 "
        with self.assertRaisesRegex(AssertionError, "Duplicate profile fighter ID"):
            validate(data)


if __name__ == "__main__":
    unittest.main()
