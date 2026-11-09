"""Regression: unexpected provider failures cannot replace the UFC fighter cache."""
import datetime
import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest import mock

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "refresh_ufc.py"
spec = importlib.util.spec_from_file_location("ufc_refresh_under_test", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RefreshFailClosedTests(unittest.TestCase):
    def test_unexpected_fighter_error_preserves_cache(self):
        now = datetime.datetime(2026, 11, 8, tzinfo=datetime.timezone.utc)
        with tempfile.TemporaryDirectory() as temp:
            # chdir is required because the production refresh uses a relative path.
            import os
            original = os.getcwd()
            try:
                os.chdir(temp)
                cache = pathlib.Path("ufc_fighter_data.json")
                original_bytes = b'{"previous":"verified"}\n'
                cache.write_bytes(original_bytes)
                schedule = {"bouts": [{"fighter_a": "1", "fighter_a_name": "Test A",
                                       "fighter_b": "2", "fighter_b_name": "Test B"}]}
                def fake_api(method, args, key):
                    if method == "get_schedule":
                        return schedule
                    raise ValueError("malformed provider envelope")
                with mock.patch.object(module, "api", side_effect=fake_api):
                    with self.assertRaisesRegex(RuntimeError, "refresh incomplete"):
                        module.refresh_fighters(now, "fake-key")
                self.assertEqual(cache.read_bytes(), original_bytes)
            finally:
                os.chdir(original)

    def test_network_error_preserves_cache(self):
        now = datetime.datetime(2026, 11, 8, tzinfo=datetime.timezone.utc)
        import os
        with tempfile.TemporaryDirectory() as temp:
            original = os.getcwd()
            try:
                os.chdir(temp)
                cache = pathlib.Path("ufc_fighter_data.json")
                original_bytes = b'{"previous":"verified"}\n'
                cache.write_bytes(original_bytes)
                def fake_api(method, args, key):
                    if method == "get_schedule":
                        return {"bouts": [{"fighter_a": "1", "fighter_a_name": "Test A",
                                           "fighter_b": "2", "fighter_b_name": "Test B"}]}
                    raise TimeoutError("timeout")
                with mock.patch.object(module, "api", side_effect=fake_api):
                    with self.assertRaises(RuntimeError):
                        module.refresh_fighters(now, "fake-key")
                self.assertEqual(cache.read_bytes(), original_bytes)
            finally:
                os.chdir(original)


if __name__ == "__main__":
    unittest.main()
