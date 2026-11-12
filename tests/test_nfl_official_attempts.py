import unittest
import pandas as pd
from build_feed import official_pass_attempts, official_rush_attempts, official_stat_plays

class OfficialAttemptsTests(unittest.TestCase):
    def fixture(self):
        return pd.DataFrame([
            dict(name='completion',pass_attempt=1,qb_spike=0,sack=0,rush_attempt=0,qb_kneel=0,two_point_attempt=0),
            dict(name='incomplete',pass_attempt=1,qb_spike=0,sack=0,rush_attempt=0,qb_kneel=0,two_point_attempt=0),
            dict(name='sack',pass_attempt=1,qb_spike=0,sack=1,rush_attempt=0,qb_kneel=0,two_point_attempt=0),
            dict(name='spike',pass_attempt=0,qb_spike=1,sack=0,rush_attempt=0,qb_kneel=0,two_point_attempt=0),
            dict(name='rush',pass_attempt=0,qb_spike=0,sack=0,rush_attempt=1,qb_kneel=0,two_point_attempt=0),
            dict(name='kneel',pass_attempt=0,qb_spike=0,sack=0,rush_attempt=0,qb_kneel=1,two_point_attempt=0),
            dict(name='two-point-pass',pass_attempt=1,qb_spike=0,sack=0,rush_attempt=0,qb_kneel=0,two_point_attempt=1),
            dict(name='two-point-rush',pass_attempt=0,qb_spike=0,sack=0,rush_attempt=1,qb_kneel=0,two_point_attempt=1),
        ])
    def test_pass_attempts_count_spikes_not_sacks_or_conversions(self):
        self.assertEqual(official_pass_attempts(self.fixture()).name.tolist(),['completion','incomplete','spike'])
    def test_rushing_counts_kneels_not_conversions(self):
        self.assertEqual(official_rush_attempts(self.fixture()).name.tolist(),['rush','kneel'])
    def test_missing_source_flags_cannot_be_assumed_zero(self):
        with self.assertRaises(RuntimeError): official_pass_attempts(self.fixture().drop(columns='sack'))
        with self.assertRaises(RuntimeError): official_rush_attempts(self.fixture().drop(columns='qb_kneel'))

    def test_stat_spikes_and_kneels_survive_general_play_filter(self):
        source=self.fixture()
        source['play']=1
        source.loc[source.name.isin(['spike','kneel']),'play']=0
        source['no_play']=0
        kept=official_stat_plays(source)
        self.assertIn('spike',kept.name.tolist())
        self.assertIn('kneel',kept.name.tolist())
        self.assertNotIn('two-point-pass',kept.name.tolist())
        source.loc[source.name.eq('completion'),'no_play']=1
        self.assertNotIn('completion',official_stat_plays(source).name.tolist())
