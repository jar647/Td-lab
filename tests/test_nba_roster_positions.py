import unittest
from nba_rosters import parse_roster
class RosterPositions(unittest.TestCase):
 def test_sourced_positions_preserve_ids_and_generic_positions(self):
  ids,players=parse_roster({'athletes':[{'id':1,'displayName':'Center','position':{'abbreviation':'C','displayName':'Center'}},{'id':2,'displayName':'Forward','position':{'abbreviation':'F'}}]},'Team')
  self.assertEqual(ids,['1','2']);self.assertEqual(players['1']['position'],'C');self.assertEqual(players['2']['position'],'F');self.assertEqual(players['1']['team'],'Team')
 def test_absent_position_is_not_guessed(self):
  _,p=parse_roster({'athletes':[{'id':1,'displayName':'Unknown'}]},'Team');self.assertIsNone(p['1']['position'])
