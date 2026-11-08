import contextlib
import datetime
import importlib.util
import io
import json
import os
import pathlib
import tempfile
import unittest
from unittest import mock
import urllib.error


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


refresh = load("refresh_ufc", "scripts/refresh_ufc.py")
validator = load("validate_ufc", "scripts/validate_ufc_cache.py")


class UFCRefreshTests(unittest.TestCase):
    def setUp(self):
        self.rates = {"sig_landed_per_15": 60, "sig_absorbed_per_15": 45,
                      "sig_accuracy": .48, "sig_defense": .55, "td_per_15": 1.8,
                      "td_accuracy": .42, "td_defense": .72, "sub_attempts_per_15": .4}
        self.now = datetime.datetime(2026, 11, 7, tzinfo=datetime.timezone.utc)
        self.bout = {"bout_id": "bout1", "event_id": "event1", "card_segment": "main", "fighter_a": "a", "fighter_a_name": "Fighter A", "fighter_b": "b", "fighter_b_name": "Fighter B", "lines": [{"a": -150, "b": 130}]}

    def test_units_and_explicit_percentage(self):
        data = refresh.stats({"career_rates": self.rates})
        self.assertEqual(data["slpm"], 4)
        self.assertEqual(data["sapm"], 3)
        self.assertEqual(data["strAcc"], 48)
        self.assertEqual(data["tdAvg"], 1.8)
        self.rates["sig_accuracy"] = "1%"
        self.assertEqual(refresh.stats({"career_rates": self.rates})["strAcc"], 1)

    def test_partial_invalid_missing_not_zero(self):
        for value in (None, True, "", "nan", -1, float("inf"), 101):
            self.rates["sig_accuracy"] = value
            data = refresh.stats({"career_rates": self.rates})
            self.assertIsNone(data["strAcc"])
            self.assertEqual(data["slpm"], 4)
        self.rates["td_per_15"] = 0
        self.assertEqual(refresh.stats({"career_rates": self.rates})["tdAvg"], 0)

    def test_profile_extracts_actual_recent_outcome_and_physical_details(self):
        recent = dict(self.bout, status="final", winner="b", method_display="Decision", event_date="2026-10-01")
        data = {"fighter": {"height_in": 70, "reach_in": 72, "weight_lbs": 170, "stance": "Southpaw", "pro_record": "8-2-0"}, "career_rates": self.rates, "ufc_record": {"wins": 2, "losses": 1}, "recent_fights": [recent, dict(recent, bout_id="wrong", fighter_a="x", fighter_b="y")]}
        profile = refresh.profile_data(data, "a", "Fighter A", self.now)
        self.assertEqual(profile["height"], "70 in")
        self.assertEqual(profile["ufc_record"]["wins"], 2)
        self.assertEqual(len(profile["recent_fights"]), 1)
        self.assertEqual(profile["recent_fights"][0]["winner"], "b")
        self.assertNotIn("lines", profile["recent_fights"][0])

    def cache(self, profiles):
        pathlib.Path("ufc_fighter_data.json").write_text(json.dumps({"source": refresh.SOURCE, "fighters": profiles}))

    @contextlib.contextmanager
    def workspace(self):
        previous = os.getcwd()
        with tempfile.TemporaryDirectory() as directory:
            os.chdir(directory)
            try:
                yield
            finally:
                os.chdir(previous)

    def test_recent_complete_profiles_reused_and_only_missing_fetched(self):
        old = refresh.profile_data({"career_rates": self.rates}, "a", "Fighter A", self.now - datetime.timedelta(days=2))
        with self.workspace():
            self.cache({"fighter a": old})
            with mock.patch.object(refresh, "api", side_effect=[{"bouts": [self.bout]}, {"fighter": {"stance": "Orthodox"}, "career_rates": {"td_per_15": 0}}]) as calls:
                output = refresh.refresh_fighters(self.now, "private-test-key")
            self.assertEqual(calls.call_count, 2)
            self.assertEqual(calls.call_args.args[1]["fighter_id"], "b")
            self.assertEqual(output["fighters"]["fighter a"]["fetched_at"], old["fetched_at"])
            self.assertIsNone(output["fighters"]["fighter b"]["stats"]["slpm"])
            self.assertEqual(output["fighters"]["fighter b"]["stats"]["tdAvg"], 0)
            self.assertEqual(output["coverage"], {"profiles": 2, "complete_profiles": 1, "fighters_expected": 2, "complete": False})
            self.assertNotIn("lines", output["bouts"][0])
            self.assertEqual(validator.validate(output), (2, 1))

    def test_recent_partial_profile_also_reused_without_relabeling(self):
        profile = refresh.profile_data({}, "a", "Fighter A", self.now - datetime.timedelta(days=1))
        second = refresh.profile_data({}, "b", "Fighter B", self.now)
        with self.workspace():
            self.cache({"fighter a": profile, "fighter b": second})
            with mock.patch.object(refresh, "api", return_value={"bouts": [self.bout]}) as calls:
                output = refresh.refresh_fighters(self.now, "test")
            self.assertEqual(calls.call_count, 1)
            self.assertEqual(output["fighters"]["fighter a"]["fetched_at"], profile["fetched_at"])

    def test_two_day_old_incomplete_profile_is_refetched(self):
        partial = refresh.profile_data({}, "a", "Fighter A", self.now - datetime.timedelta(days=2))
        complete = refresh.profile_data({"career_rates": self.rates}, "b", "Fighter B", self.now)
        with self.workspace():
            self.cache({"fighter a": partial, "fighter b": complete})
            with mock.patch.object(refresh, "api", side_effect=[
                {"bouts": [self.bout]},
                {"career_rates": self.rates}
            ]) as calls:
                output = refresh.refresh_fighters(self.now, "test")
            self.assertEqual(calls.call_count, 2)
            self.assertEqual(calls.call_args.args[1]["fighter_id"], "a")
            self.assertTrue(refresh.valid_stats(output["fighters"]["fighter a"]["stats"]))
            self.assertEqual(output["coverage"]["complete_profiles"], 2)

    def test_incomplete_refresh_keeps_known_good_rates_and_original_source_time(self):
        old = refresh.profile_data({"career_rates": self.rates}, "a", "Fighter A", self.now - datetime.timedelta(days=8))
        other = refresh.profile_data({}, "b", "Fighter B", self.now)
        with self.workspace():
            self.cache({"fighter a": old, "fighter b": other})
            with mock.patch.object(refresh, "api", side_effect=[{"bouts": [self.bout]}, {"fighter": {"stance": "Southpaw"}}]):
                output = refresh.refresh_fighters(self.now, "test")
            saved = output["fighters"]["fighter a"]
            self.assertEqual(saved["stats"], old["stats"])
            self.assertEqual(saved["fetched_at"], old["fetched_at"])
            self.assertEqual(saved["checked_at"], self.now.isoformat())
            self.assertEqual(saved["stance"], "Southpaw")
            with mock.patch.object(refresh, "api", return_value={"bouts": [self.bout]}) as calls:
                refresh.refresh_fighters(self.now + datetime.timedelta(days=1), "test")
            self.assertEqual(calls.call_count, 1)

    def test_transient_profile_failure_preserves_recent_verified_profile(self):
        old = refresh.profile_data({"career_rates": self.rates}, "a", "Fighter A", self.now - datetime.timedelta(days=8))
        with self.workspace():
            self.cache({"fighter a": old})
            def response(method, args, key):
                if method == "get_schedule":
                    return {"bouts": [self.bout]}
                if args["fighter_id"] == "a":
                    raise TimeoutError("temporary")
                self.assertEqual(args["fighter_id"], "b")
                return {"career_rates": self.rates}

            with mock.patch.object(refresh, "api", side_effect=response):
                result = refresh.refresh_fighters(self.now, "test")
            self.assertEqual(result["fighters"]["fighter a"]["stats"], old["stats"])
            self.assertEqual(result["fighters"]["fighter a"]["fetched_at"], old["fetched_at"])
            self.assertTrue(refresh.valid_stats(result["fighters"]["fighter b"]["stats"]))
            self.assertEqual(result["coverage"]["complete_profiles"], 2)

    def test_empty_or_failed_response_preserves_previous_file(self):
        with self.workspace():
            self.cache({"fighter a": {"id": "a", "stats": {}}})
            original = pathlib.Path("ufc_fighter_data.json").read_text()
            with mock.patch.object(refresh, "api", return_value={"bouts": []}):
                with self.assertRaises(ValueError):
                    refresh.refresh_fighters(self.now, "test")
            self.assertEqual(pathlib.Path("ufc_fighter_data.json").read_text(), original)
            with mock.patch.object(refresh, "api", side_effect=[{"bouts": [self.bout]}, refresh.APIError(401)]):
                with self.assertRaises(ValueError):
                    refresh.refresh_fighters(self.now, "test")
            self.assertEqual(pathlib.Path("ufc_fighter_data.json").read_text(), original)

    def test_auth_failure_stops_calls_retains_existing_and_does_not_log_key(self):
        old = refresh.profile_data({"career_rates": self.rates}, "a", "Fighter A", self.now - datetime.timedelta(days=8))
        with self.workspace():
            self.cache({"fighter a": old})
            output = io.StringIO()
            with mock.patch.object(refresh, "api", side_effect=[{"bouts": [self.bout]}, refresh.APIError(402)]) as calls, contextlib.redirect_stdout(output):
                with self.assertRaises(refresh.APIError):
                    refresh.refresh_fighters(self.now, "do-not-log-private-key")
            self.assertEqual(calls.call_count, 2)
            saved = json.loads(pathlib.Path("ufc_fighter_data.json").read_text())
            self.assertEqual(saved["fighters"]["fighter a"]["fetched_at"], old["fetched_at"])
            self.assertNotIn("do-not-log-private-key", output.getvalue())
            self.assertIn("HTTP 402", output.getvalue())

    def test_http_errors_hide_response_and_retry_429_only(self):
        refresh._api_last_call = None
        refresh._api_remaining = None
        error = urllib.error.HTTPError("https://example.test", 401, "private-response", {}, None)
        with mock.patch.object(refresh.urllib.request, "urlopen", side_effect=error):
            with self.assertRaises(refresh.APIError) as caught:
                refresh.api("get_fighter", {}, "secret")
        self.assertEqual(str(caught.exception), "HTTP 401")
        throttle = urllib.error.HTTPError("https://example.test", 429, "private", {"Retry-After": "1"}, None)
        with mock.patch.object(refresh.urllib.request, "urlopen", side_effect=throttle) as calls, mock.patch.object(refresh.time, "sleep"):
            with self.assertRaises(refresh.APIError):
                refresh.api("get_fighter", {}, "secret")
        self.assertEqual(calls.call_count, 3)

    def test_low_credit_limit_checks_before_network(self):
        refresh._api_remaining = 4
        with mock.patch.object(refresh.urllib.request, "urlopen") as call:
            with self.assertRaises(refresh.APIError):
                refresh.api("get_fighter", {}, "secret")
        call.assert_not_called()
        refresh._api_remaining = None


if __name__ == "__main__":
    unittest.main()

