"""Regression coverage for published UFC cache identity integrity."""
import importlib.util
import unittest

spec = importlib.util.spec_from_file_location("ufc_cache_validator", "scripts/validate_ufc_cache.py")
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class CacheIdentityTests(unittest.TestCase):
    def setUp(self):
        self.data = {
            "scheduled_bouts": 1,
            "bouts": [{"bout_id": "bout-1", "fighter_a": "1", "fighter_a_name": "Alpha",
                       "fighter_b": "2", "fighter_b_name": "Bravo"}],
            "fighters": {
                "alpha": {"id": "1", "name": "Alpha", "stats": {}},
                "bravo": {"id": "2", "name": "Bravo", "stats": {}},
            },
            "coverage": {"profiles": 2, "fighters_expected": 2,
                         "complete_profiles": 0, "complete": False},
        }

    def test_matching_profiles_pass(self):
        self.assertEqual(validator.validate(self.data), (2, 0))

    def test_wrong_fighter_id_rejected(self):
        self.data["fighters"]["alpha"]["id"] = "other"
        with self.assertRaisesRegex(AssertionError, "missing or mismatched"):
            validator.validate(self.data)

    def test_missing_scheduled_fighter_rejected(self):
        del self.data["fighters"]["bravo"]
        self.data["coverage"] = {}
        with self.assertRaisesRegex(AssertionError, "coverage mismatch"):
            validator.validate(self.data)

    def test_duplicate_source_id_rejected(self):
        self.data["bouts"][0]["fighter_b"] = "1"
        self.data["bouts"][0]["fighter_b_name"] = "Alpha"
        with self.assertRaisesRegex(AssertionError, "Duplicate fighter IDs"):
            validator.validate(self.data)

    def test_conflicting_name_to_id_rejected(self):
        self.data["bouts"].append({
            "bout_id": "bout-2", "fighter_a": "3", "fighter_a_name": "Alpha",
            "fighter_b": "2", "fighter_b_name": "Bravo",
        })
        self.data["scheduled_bouts"] = 2
        with self.assertRaisesRegex(AssertionError, "Ambiguous scheduled fighter name"):
            validator.validate(self.data)

    def test_bout_count_mismatch_rejected(self):
        self.data["scheduled_bouts"] = 2
        with self.assertRaisesRegex(AssertionError, "bout count mismatch"):
            validator.validate(self.data)

    def test_betting_lines_not_published(self):
        self.data["bouts"][0]["lines"] = [{"a": -150}]
        with self.assertRaisesRegex(AssertionError, "Invalid public bout metadata"):
            validator.validate(self.data)


if __name__ == "__main__":
    unittest.main()
