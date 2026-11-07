import datetime
import importlib.util
import json
import pathlib
import tempfile
import threading
import unittest

spec = importlib.util.spec_from_file_location("refresh_ufc_history", "scripts/refresh_ufc_history.py")
history = importlib.util.module_from_spec(spec)
spec.loader.exec_module(history)
NOW = datetime.datetime(2026, 11, 7, tzinfo=datetime.timezone.utc)


def event(bout="101", outcome="W", method="kotko", league="3321", when="2025-01-01T00:00Z"):
    return {"uid": f"s:3301~l:{league}~e:100~c:{bout}", "name": "Source event", "gameDate": when,
            "gameResult": outcome, "opponent": {"id": "2", "displayName": "Opponent"},
            "status": {"period": 1, "displayClock": "2:31", "result": {"name": method, "displayName": method}}}


def athlete(identifier="1", rows=None):
    return {"athlete": {"id": identifier, "fullName": "Fighter " + identifier},
            "eventsMap": {str(index): value for index, value in enumerate(rows if rows is not None else [event()])}}


def record(**values):
    values = values or {"wins": 1, "losses": 0, "tkos": 1, "submissions": 0, "tkoLosses": 0, "submissionLosses": 0}
    return {"items": [{"name": "overall", "stats": [{"name": key, "value": value} for key, value in values.items()]}]}


class HistoryTests(unittest.TestCase):
    def test_explicit_formats_only(self):
        self.assertEqual(history.explicit_rounds({"format": {"regulation": {"periods": 5}}}), 5)
        for value in ({"status": {"period": 3}}, {"titleFight": True}, {"format": {"regulation": {"periods": 2}}},
                      {"format": {"regulation": {"periods": True}}}):
            self.assertIsNone(history.explicit_rounds(value))

    def test_decisions_require_complete_observed_outcomes(self):
        rows = athlete(rows=[event(), event("102", method="decision---split", league="3359")])["eventsMap"]
        result = history.records(record(wins=2, losses=0, tkos=1, submissions=0), rows, NOW)
        self.assertEqual(result["wins_dec"], 1)
        self.assertEqual(result["losses_dec"], 0)
        self.assertNotIn("wins_dec", history.records(record(wins=3, losses=0, tkos=1, submissions=0), rows, NOW))
        rows["1"]["status"]["result"]["name"] = "unknown"
        self.assertNotIn("wins_dec", history.records(record(wins=2, losses=0, tkos=1), rows, NOW))

    def test_missing_invalid_counts_are_not_zero(self):
        result = history.records(record(wins=2, losses=1, tkos=True, submissions=-1), {}, NOW)
        self.assertEqual(result, {"wins": 2, "losses": 1})
        self.assertIsNone(history.records(record(wins="invalid", losses=1), {}, NOW))

    def test_unknown_or_technical_methods_do_not_become_decisions(self):
        for method in ("decision---technical", "disqualification", "unknown"):
            rows = athlete(rows=[event(method=method)])["eventsMap"]
            self.assertNotIn("wins_dec", history.records(record(wins=1, losses=0), rows, NOW))

    def test_only_latest_eight_completed_ufc_dwcs_rows_get_formats(self):
        rows = [event(str(100 + index), when=f"2025-01-{index + 1:02}T00:00Z") for index in range(10)]
        rows += [event("200", league="3359"), event("201", when="2027-01-01T00:00Z")]
        calls = []
        formats = history.Formats(lambda url: calls.append(url) or {"format": {"regulation": {"periods": 3}}})
        result = history.history("1", "Fighter", athlete(rows=rows)["eventsMap"], formats, NOW)
        self.assertEqual([value["bout_id"] for value in result], [str(109 - index) for index in range(8)])
        self.assertEqual(len(calls), 8)
        self.assertTrue(all(value["scheduled_rounds"] == 3 for value in result))
        self.assertEqual(result[0]["winner"], "1")

    def test_shared_competition_fetches_deduplicated(self):
        calls = []
        barrier = threading.Barrier(2)
        formats = history.Formats(lambda url: calls.append(url) or {"id": "101", "format": {"regulation": {"periods": 3}}})
        def load():
            barrier.wait()
            return formats.get("100", "101", NOW)
        with history.concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda unused: load(), range(2)))
        self.assertEqual(results, [3, 3])
        self.assertEqual(len(calls), 1)
        reused = history.Formats(lambda url: self.fail("cached format fetched again"), formats.values)
        self.assertEqual(reused.get("100", "101", NOW), 3)

    def test_schedule_prioritizes_upcoming_and_uses_cache_as_fallback(self):
        def card(day, identifier):
            return {"date": day, "competitions": [{"competitors": [{"id": identifier, "athlete": {"fullName": identifier}}]}]}
        schedule = {"events": [card("2026-11-21T17:00Z", "2"), card("2026-11-07T17:00Z", "1"), card("2027-01-01T17:00Z", "3")]}
        cached = {"fighters": {"other": {"id": "9", "name": "Fallback"}}}
        self.assertEqual(list(history.targets(schedule, cached, NOW)), ["1", "2"])
        self.assertEqual(history.targets({}, cached, NOW), {"9": "Fallback"})

    def workspace(self, root, previous=None):
        (root / "ufc_fighter_data.json").write_text(json.dumps({"fighters": {"fighter": {"id": "1", "name": "Fighter"}}}))
        if previous:
            (root / "ufc_history_data.json").write_text(json.dumps(previous))

    def test_refresh_provenance_and_identity(self):
        def fetch(url):
            if "/records?" in url:
                return record()
            if "/competitions/" in url:
                return {"id": "101", "format": {"regulation": {"periods": 3}}}
            return athlete()
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            self.workspace(root)
            result = history.refresh(root, fetch, NOW)
            profile = result["fighters"]["1"]
            self.assertEqual(profile["method_record_scope"], "overall_professional")
            self.assertEqual(profile["method_record_source"], history.RECORD_SOURCE)
            self.assertEqual(profile["recent_fights"][0]["scheduled_rounds"], 3)
            original = (root / "ufc_history_data.json").read_bytes()
            result = history.refresh(root, lambda url: self.fail("fresh profile fetched"), NOW)
            self.assertEqual(result["fighters"]["1"], profile)
            self.assertFalse((root / "ufc_history_data.tmp").exists())
            # A wrong athlete identity cannot overwrite even an expired profile.
            later = NOW + datetime.timedelta(days=2)
            result = history.refresh(root, lambda url: athlete("99"), later)
            self.assertEqual(result["fighters"]["1"], profile)

    def test_partial_failure_preserves_previous_component_timestamp(self):
        old_time = (NOW - datetime.timedelta(days=2)).isoformat()
        old = {"id": "1", "name": "Fighter", "method_record": {"wins": 4, "losses": 1},
               "method_record_scope": "overall_professional", "method_record_source": history.RECORD_SOURCE,
               "method_record_fetched_at": old_time, "history_fetched_at": old_time, "recent_fights": []}
        def fetch(url):
            if "/records?" in url:
                raise OSError("public service unavailable")
            if "/competitions/" in url:
                return {}  # Unknown format must stay null despite round-one finish.
            return athlete()
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            self.workspace(root, {"fighters": {"1": old}})
            profile = history.refresh(root, fetch, NOW)["fighters"]["1"]
            self.assertEqual(profile["method_record"], old["method_record"])
            self.assertEqual(profile["method_record_fetched_at"], old_time)
            self.assertEqual(profile["history_fetched_at"], NOW.isoformat())
            self.assertIsNone(profile["recent_fights"][0]["scheduled_rounds"])

    def test_zero_usable_profiles_never_overwrites_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            self.workspace(root)
            target = root / "ufc_history_data.json"
            target.write_text('{"source":"preserve me"}')
            with self.assertRaises(ValueError):
                history.refresh(root, lambda url: athlete("wrong"), NOW)
            self.assertEqual(target.read_text(), '{"source":"preserve me"}')


if __name__ == "__main__":
    unittest.main()
