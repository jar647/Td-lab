import unittest
from scripts.derive_espn_defense import derive
from scripts.compare_espn_defense import compare

SOURCE = "ESPN NFL game summary (unofficial)"

def game(index):
    home = str(index * 2 + 1)
    away = str(index * 2 + 2)
    def group(team):
        return {"team": {"id": team}, "statistics": [
            {"name": "passing", "labels": ["C/ATT", "YDS"],
             "athletes": [{"athlete": {"position": {"abbreviation": "QB"}}, "stats": ["12/20", "215"]}]},
            {"name": "rushing", "labels": ["CAR", "YDS"],
             "athletes": [{"athlete": {"position": {"abbreviation": "RB"}}, "stats": ["13", "70"]}]},
            {"name": "receiving", "labels": ["REC", "YDS"],
             "athletes": [{"athlete": {"position": {"abbreviation": "WR"}}, "stats": ["5", "83"]}]}]}
    return {"event_id": str(index), "competitors": [
        {"team": {"id": home, "abbreviation": f"T{index*2+1:02}"}},
        {"team": {"id": away, "abbreviation": f"T{index*2+2:02}"}}],
        "boxscore_players": [group(home), group(away)]}

class ESPNTests(unittest.TestCase):
    def evidence(self):
        return {"source": SOURCE, "season": 2026, "weeks": [2, 3, 4, 5, 6],
                "retrieved_at": "2026-10-23T00:00:00+00:00", "failures": [],
                "games": [game(i) for i in range(16)]}

    def test_derive_box_scores_by_opposing_defense(self):
        result = derive(self.evidence())
        self.assertEqual(len(result["rows"]), 128)
        rows = {(r["defense"], r["position"]): r for r in result["rows"]}
        self.assertEqual(rows["T01", "QB"]["pass_yards_total"], 215)
        self.assertEqual(rows["T02", "QB"]["pass_attempts_total"], 20)
        self.assertEqual(rows["T01", "WR"]["receptions_total"], 5)
        self.assertEqual(rows["T01", "TE"]["rec_yards_total"], 0)
        self.assertFalse(result["status"] == "VERIFIED")

    def test_missing_game_blocks(self):
        raw = self.evidence()
        raw["games"].pop()
        with self.assertRaises(ValueError):
            derive(raw)

    def test_duplicate_game_blocks(self):
        raw = self.evidence()
        raw["games"].append(raw["games"][0])
        with self.assertRaises(ValueError):
            derive(raw)

    def test_comparison_never_grants_full_verification(self):
        external = derive(self.evidence())
        primary = {"season": 2026, "week": 7, "lookback_weeks": 5,
                   "rows": [dict(row) for row in external["rows"]]}
        result = compare(primary, external)
        self.assertEqual(result["status"], "PARTIAL_MATCH")
        self.assertFalse(result["independent_external_source_verified"])

    def test_comparison_flags_stat_discrepancy(self):
        external = derive(self.evidence())
        primary = {"season": 2026, "week": 7, "lookback_weeks": 5,
                   "rows": [dict(row) for row in external["rows"]]}
        primary["rows"][0]["pass_yards_total"] += 10
        self.assertEqual(compare(primary, external)["status"], "BLOCKED")

if __name__ == "__main__":
    unittest.main()
