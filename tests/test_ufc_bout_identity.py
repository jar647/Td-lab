"""Incomplete scheduled UFC bouts must never replace the verified fighter cache."""
import datetime
import importlib.util
import os
import pathlib
import tempfile
import unittest
from unittest import mock

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "refresh_ufc.py"
spec = importlib.util.spec_from_file_location("ufc_refresh_identity_test", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BoutIdentityTests(unittest.TestCase):
    def assert_preserves_cache(self, bouts, expected_error):
        now = datetime.datetime(2026, 11, 8, tzinfo=datetime.timezone.utc)
        with tempfile.TemporaryDirectory() as temp:
            original = os.getcwd()
            try:
                os.chdir(temp)
                cache = pathlib.Path("ufc_fighter_data.json")
                original_bytes = b'{"previous":"verified"}\n'
                cache.write_bytes(original_bytes)
                with mock.patch.object(module, "api", return_value={"bouts": bouts}) as api:
                    with self.assertRaisesRegex(ValueError, expected_error):
                        module.refresh_fighters(now, "fake-key")
                    api.assert_called_once()
                self.assertEqual(cache.read_bytes(), original_bytes)
            finally:
                os.chdir(original)

    def test_missing_second_fighter(self):
        self.assert_preserves_cache(
            [{"fighter_a": "101", "fighter_a_name": "Alpha"}],
            "Incomplete scheduled bout identities")

    def test_missing_fighter_name(self):
        self.assert_preserves_cache(
            [{"fighter_a": "101", "fighter_a_name": "Alpha",
              "fighter_b": "102", "fighter_b_name": " "}],
            "Incomplete scheduled bout identities")

    def test_duplicate_fighter_ids(self):
        self.assert_preserves_cache(
            [{"fighter_a": "101", "fighter_a_name": "Alpha",
              "fighter_b": "101", "fighter_b_name": "Beta"}],
            "Duplicate fighter IDs")

    def test_distinct_ids_with_colliding_lookup_names(self):
        self.assert_preserves_cache(
            [{"fighter_a": "101", "fighter_a_name": "Alpha",
              "fighter_b": "102", "fighter_b_name": "ALPHA"}],
            "Ambiguous scheduled fighter names")

    def test_malformed_bout(self):
        self.assert_preserves_cache([None], "Malformed scheduled bout")


if __name__ == "__main__":
    unittest.main()
