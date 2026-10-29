import unittest
from build_feed import add_pbp_verified_skill_appearances
from scripts.audit_feed_totals import audit

class FeedTotalsTests(unittest.TestCase):
    def fixture(self):
        d={'defense':'PHI','position':'QB','games':1,
           'pass_yards_total':250,'pass_yards_per_game':250,
           'pass_attempts_total':30,'pass_attempts_per_game':30,
           'rush_yards_total':12,'rush_yards_per_game':12,
           'rush_attempts_total':3,'rush_attempts_per_game':3}
        p={'seasonGamesPlayed':1,'last5GamesPlayed':1,'playerAppearancesVerified':True,
           'seasonAverages':{'passYards':250,'passAttempts':30,'rushYards':12,'rushAttempts':3},
           'player_id':'p1','player':'QB','team':'DAL','opp':'PHI','pos':'QB','games':1,
           'playerPassYards':250,'playerPassAttempts':30,'playerRushYards':12,
           'playerCarries':3,'playerRz':1,'defPassYardsAllowed':250,
           'defPassAttemptsAllowed':30,'defRushYardsAllowed':12,
           'defRushAttemptsAllowed':3,
           'last5GameStats':[{'week':1,'gameId':'game1','passYards':250,
                              'passAttempts':30,'rushYards':12,'rushAttempts':3,
                              'rzChances':1,'recYards':0,'receptions':0,
                              'targets':0,'rzTargets':0}]}
        return p,d
    def test_consistent_totals_pass(self):
        p,d=self.fixture()
        self.assertEqual(audit([p],{'rows':[d]})['players_checked'],1)
    def test_player_discrepancy_blocks(self):
        p,d=self.fixture();p['playerPassYards']=292.8
        with self.assertRaises(RuntimeError):audit([p],{'rows':[d]})
    def test_defensive_discrepancy_blocks(self):
        p,d=self.fixture();p['defPassYardsAllowed']=260
        with self.assertRaises(RuntimeError):audit([p],{'rows':[d]})
    def test_missing_game_blocks(self):
        p,d=self.fixture();p['seasonGamesPlayed']=0
        with self.assertRaises(RuntimeError):audit([p],{'rows':[d]})
    def test_recorded_carries_or_targets_prove_skill_player_appearance(self):
        appearances={}
        stats={('GB','jacobs-id',7):{'rushAttempts':11,'targets':5},
               ('GB','inactive-id',7):{'rushAttempts':0,'targets':0},
               ('GB','qb-id',7):{'rushAttempts':2,'targets':0}}
        add_pbp_verified_skill_appearances(appearances,stats,
            {'jacobs-id':'RB','inactive-id':'RB','qb-id':'QB'})
        self.assertEqual(appearances,{('GB','jacobs-id'):{7}})
if __name__=='__main__':unittest.main()

