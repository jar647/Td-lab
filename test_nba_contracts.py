#!/usr/bin/env python3
"""Offline contract tests for NBA feed and locked projection data."""
import datetime, json, pathlib, unittest
ROOT=pathlib.Path(__file__).resolve().parent
class NBAContracts(unittest.TestCase):
 def test_feed(self):
  data=json.loads((ROOT/"data/nba_games.json").read_text())
  self.assertTrue(data.get("games"),"NBA game feed empty")
  datetime.datetime.fromisoformat(data["generated_at"].replace("Z","+00:00"))
  ids=set()
  for game in data["games"]:
   self.assertNotIn(game["id"],ids,"duplicate NBA game")
   ids.add(game["id"])
   self.assertTrue(game["home"] and game["away"] and game["home"]!=game["away"])
   for player in game["players"]:
    self.assertIn(player["team"],(game["home"],game["away"]))
    made=player.get("stats",{}).get("3PM")
    if made is not None:self.assertGreaterEqual(float(made),0)
 def test_snapshots(self):
  path=ROOT/"data/nba_projection_tracker.json"
  if not path.exists():self.skipTest("No snapshots published")
  data=json.loads(path.read_text())
  seen=set()
  for snap in data.get("snapshots",[]):
   self.assertNotIn(snap["game_id"],seen,"duplicate frozen game")
   seen.add(snap["game_id"])
   lock=datetime.datetime.fromisoformat(snap["locked_at"].replace("Z","+00:00"))
   tip=datetime.datetime.fromisoformat(snap["tipoff"].replace("Z","+00:00"))
   self.assertLess(lock,tip,"snapshot was not locked before tipoff")
   for p in snap["projections"]:
    self.assertIn(p["result"],("pending","dnp","ungraded","within_20pct","outside_20pct"))
    self.assertGreaterEqual(p["sample"],3)
    self.assertGreaterEqual(p["projection"],0)
    if p["result"] in ("within_20pct","outside_20pct"):
     self.assertIsNotNone(p["actual"])
if __name__=="__main__":unittest.main()
