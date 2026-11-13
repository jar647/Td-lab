"""Display roster coverage and actual anytime-TD source attribution."""
import unittest
from datetime import datetime, timezone
import pandas as pd
from build_feed import display_roster_players, add_anytime_touchdowns
from scripts.audit_feed_totals import audit


class DisplayRosterTests(unittest.TestCase):
    def test_roster_only_rows_preserve_missing_data_and_current_team_status(self):
        annual=pd.DataFrame([
            dict(gsis_id='verified',team='A',position='QB',full_name='Verified QB',status='ACT'),
            dict(gsis_id='rookie',team='A',position='WR',full_name='Rookie Receiver',status='ACT'),
            dict(gsis_id='out',team='B',position='RB',full_name='Unavailable Runner',status='ACT'),
            dict(gsis_id='ir',team='B',position='TE',full_name='Reserve Tight End',status='IR'),
            dict(gsis_id='cut',team='A',position='WR',full_name='Released Player',status='CUT'),
            dict(gsis_id='traded',team='C',position='WR',full_name='Other Club Player',status='ACT'),
            dict(gsis_id='kicker',team='A',position='K',full_name='Kicker',status='ACT')])
        weekly=pd.DataFrame([
            dict(gsis_id='rookie',season=2026,week=10,team='A',position='WR',status='ACT',jersey_number=18),
            dict(gsis_id='cut',season=2026,week=9,team='A',position='WR',status='ACT'),
            dict(gsis_id='traded',season=2026,week=9,team='A',position='WR',status='ACT'),
            dict(gsis_id='future',season=2026,week=11,team='A',position='WR',status='ACT',full_name='Future Player')])
        slate=pd.DataFrame([dict(home_team='A',away_team='B')])
        original=annual.copy(deep=True)
        rows=display_roster_players(annual,weekly,slate,2026,10,datetime(2026,11,12,tzinfo=timezone.utc),
            existing_records=[{'player_id':'verified'}],injury_status={'out':'OUT'})
        by_id={p['player_id']:p for p in rows}
        self.assertEqual(set(by_id),{'rookie','out','ir'})
        self.assertEqual(by_id['rookie']['availability'],'ROSTER_ACTIVE')
        self.assertEqual(by_id['rookie']['opp'],'B')
        self.assertEqual(by_id['rookie']['jersey_number'],18)
        self.assertEqual(by_id['out']['availability'],'OUT')
        self.assertEqual(by_id['ir']['availability'],'IR')
        for row in rows:
            self.assertTrue(row['displayOnly'])
            self.assertFalse(row['playerAppearancesVerified'])
            self.assertEqual(row['seasonGameStats'],[])
            self.assertEqual(row['games'],0)
            self.assertIsNone(row['playerRushYards'])
            self.assertIsNone(row['playerAnytimeTDs'])
            self.assertNotIn('qbRole',row)
        pd.testing.assert_frame_equal(annual,original)

    def test_no_weekly_snapshot_does_not_invent_starter_or_game_day_clearance(self):
        roster=pd.DataFrame([dict(gsis_id='qb',team='A',position='QB',full_name='New QB',status='ACT')])
        row=display_roster_players(roster,None,pd.DataFrame([dict(home_team='A',away_team='B')]),
            2026,10,datetime.now(timezone.utc))[0]
        self.assertEqual(row['gameDayAvailability'],'UNVERIFIED')
        self.assertNotIn('qbRole',row)
        self.assertEqual(row['rosterSource']['dataset'],'rosters')


class AnytimeTouchdownSourceTests(unittest.TestCase):
    def play(self,**changes):
        return dict(dict(posteam='A',defteam='B',week=1,touchdown=1,td_team='A',
            pass_attempt=0,qb_spike=0,sack=0,rush_attempt=0,qb_kneel=0,
            two_point_attempt=0,play=1,no_play=0,pass_touchdown=0,rush_touchdown=0,
            passer_player_id='qb',rusher_player_id=None,receiver_player_id=None),**changes)

    def test_scoring_credit_excludes_passers_conversions_nullified_and_defensive_scores(self):
        plays=pd.DataFrame([
            self.play(pass_attempt=1,pass_touchdown=1,receiver_player_id='wr'),
            self.play(rush_attempt=1,rush_touchdown=1,rusher_player_id='rb'),
            self.play(rush_attempt=1,rush_touchdown=1,rusher_player_id='qb'),
            self.play(rush_attempt=1,rush_touchdown=1,rusher_player_id='rb',two_point_attempt=1),
            self.play(pass_attempt=1,pass_touchdown=1,receiver_player_id='wr',no_play=1),
            self.play(pass_attempt=1,receiver_player_id='wr',td_team='B'),
            self.play(rush_attempt=1,rusher_player_id='rb',touchdown=0)])
        stats={('A','qb',1):{'passTDs':1}}
        add_anytime_touchdowns(stats,plays)
        self.assertEqual(stats[('A','wr',1)],{'recTDs':1})
        self.assertEqual(stats[('A','rb',1)],{'rushTDs':1})
        self.assertEqual(stats[('A','qb',1)],{'passTDs':1,'rushTDs':1})

    def test_offensive_fumble_recovery_does_not_credit_rusher_with_touchdown(self):
        plays=pd.DataFrame([
            self.play(rush_attempt=1,rusher_player_id='rb',td_player_id='te'),
            self.play(rush_attempt=1,rush_touchdown=1,rusher_player_id='rb',td_player_id='rb')])
        stats={}
        add_anytime_touchdowns(stats,plays)
        self.assertEqual(stats,{('A','rb',1):{'rushTDs':1}})

    def test_td_audit_preserves_old_feeds_and_blocks_inconsistent_new_fields(self):
        from tests.test_feed_totals import FeedTotalsTests
        row,defense=FeedTotalsTests().fixture()
        self.assertEqual(audit([row],{'rows':[defense]})['players_checked'],1)
        row.update(seasonGameStats=[{'rushTDs':1,'recTDs':0,'passTDs':4}],
            playerRushTDs=1,playerRecTDs=0,playerAnytimeTDs=1,recent3AnytimeTDs=1)
        self.assertEqual(audit([row],{'rows':[defense]})['players_checked'],1)
        row['playerAnytimeTDs']=5
        with self.assertRaisesRegex(RuntimeError,'playerAnytimeTDs differs'):
            audit([row],{'rows':[defense]})


if __name__=='__main__':unittest.main()
