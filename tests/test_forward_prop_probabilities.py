"""Regression tests for immutable pregame prop captures and postgame grading."""
import json
import tempfile
import unittest
from pathlib import Path
import pandas as pd

from capture_prop_probabilities import freeze_fixture
from grade_prop_probabilities import evaluate

class ForwardPropResearchTests(unittest.TestCase):
    def setUp(self):
        self.fixture={"season":2026,"week":9,"game_id":"g9",
                      "gameday":"2026-11-01","home_team":"GB","away_team":"CHI"}
        games=[{"rushYards":60,"rushAttempts":15,"recYards":0,"targets":0,"receptions":0}] * 5
        self.players=[{"player_id":"id1","player":"Example RB","pos":"RB",
                       "team":"GB","opp":"CHI","playerAppearancesVerified":True,
                       "availability":"ROSTER_ACTIVE","last5GameStats":games}]
        self.schedules=pd.DataFrame([{**self.fixture,"game_type":"REG",
                                      "home_score":24,"away_score":17}])
        self.appearances=pd.DataFrame([
            {"game_id":"g9","player_id":"id1","team":"GB",
             "passing_yards":0,"rushing_yards":0,"receiving_yards":0,"receptions":0},
            {"game_id":"g9","player_id":"id2","team":"CHI",
             "passing_yards":0,"rushing_yards":11,"receiving_yards":0,"receptions":0},
        ])

    def capture(self,path):
        self.assertTrue(freeze_fixture(self.fixture,self.players,
                        "2026-10-30T12:00:00+00:00",path).startswith("FROZEN_"))
        return json.loads(next(path.glob("*.json")).read_text())

    def test_frozen_before_kickoff_not_overwritten(self):
        with tempfile.TemporaryDirectory() as root:
            path=Path(root)
            original=self.capture(path)
            self.players[0]["last5GameStats"][0]["rushYards"]=9999
            self.assertEqual(freeze_fixture(self.fixture,self.players,
                             "2026-10-30T14:00:00Z",path),"ALREADY_FROZEN")
            self.assertEqual(original,json.loads(next(path.glob("*.json")).read_text()))

    def test_post_cutoff_capture_blocked(self):
        with tempfile.TemporaryDirectory() as root:
            status=freeze_fixture(self.fixture,self.players,"2026-11-01T10:00:00Z",Path(root))
            self.assertEqual(status,"AFTER_CONSERVATIVE_DAY_CUTOFF")
            self.assertEqual(list(Path(root).glob("*.json")),[])

    def test_true_zero_opportunity_grades_miss(self):
        with tempfile.TemporaryDirectory() as root:
            doc=self.capture(Path(root))
            result=evaluate([doc],self.schedules,self.appearances)
            rush=[r for r in result["records"] if r["market"]=="RUSH"]
            self.assertGreater(len(rush),0)
            self.assertTrue(all(r["hit"]==0 for r in rush))
            self.assertFalse(result["bet_ready"])

    def test_missing_player_not_mislabeled_zero(self):
        with tempfile.TemporaryDirectory() as root:
            doc=self.capture(Path(root))
            appearances=pd.concat([self.appearances[self.appearances.player_id=="id2"],
                pd.DataFrame([{"game_id":"g9","player_id":"other","team":"GB",
                    "passing_yards":0,"rushing_yards":0,"receiving_yards":0,"receptions":0}])])
            result=evaluate([doc],self.schedules,appearances)
            self.assertEqual(result["graded"],0)
            self.assertGreater(result["skipped"].get("NO_OFFENSIVE_SNAPS",0),0)

    def test_not_final_kept_pending(self):
        with tempfile.TemporaryDirectory() as root:
            doc=self.capture(Path(root))
            schedule=self.schedules.copy()
            schedule.loc[0,"home_score"]=None
            result=evaluate([doc],schedule,self.appearances)
            self.assertEqual(result["graded"],0)
            self.assertEqual(result["skipped"].get("GAME_NOT_FINAL"),1)

if __name__=="__main__":
    unittest.main()
