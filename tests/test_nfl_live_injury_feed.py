"""Live game designations suppress stale matchup candidates without inventing stats."""
import copy
import json
import subprocess
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import pandas as pd

import build_feed


class LiveInjuryFeedTests(unittest.TestCase):
    NOW = datetime(2026, 11, 14, 18, tzinfo=timezone.utc)
    GAME = '2026_10_KC_ATL'
    WALKER = '00-0038134'

    @classmethod
    def setUpClass(cls):
        teams = ['KC', 'ATL'] + ['T' + str(i) for i in range(2, 32)]
        rosters = []
        for team in teams:
            for position in ('QB', 'RB', 'WR', 'TE'):
                pid = cls.WALKER if (team, position) == ('KC', 'RB') else team + '-' + position
                rosters.append(dict(season=2026, gsis_id=pid, position=position, team=team,
                    full_name='Kenneth Walker III' if pid == cls.WALKER else team + ' ' + position,
                    status='ACT'))
        cls.rosters = pd.DataFrame(rosters)
        cls.weekly = cls.rosters.assign(week=10)
        plays = []
        schedule = []
        for week, day in ((7, '2026-10-25'), (8, '2026-11-01'), (9, '2026-11-08')):
            for index in range(0, 32, 2):
                home, away = teams[index:index + 2]
                game = f'2026_{week:02}_{away}_{home}'
                schedule.append(dict(season=2026, week=week, game_type='REG',
                    home_team=home, away_team=away, gameday=day, game_id=game))
                for team, opponent in ((home, away), (away, home)):
                    rb = cls.WALKER if team == 'KC' else team + '-RB'
                    for number in range(4):
                        rush = number < 2
                        receiver = team + ('-WR' if number == 2 else '-TE')
                        plays.append(dict(season=2026, week=week, game_id=game,
                            posteam=team, defteam=opponent, yardline_100=5,
                            play_type='run' if rush else 'pass', rush_attempt=int(rush),
                            pass_attempt=int(not rush), rusher_player_id=rb if rush else None,
                            receiver_player_id=None if rush else receiver,
                            rusher_player_name=team + ' Runner' if rush else None,
                            receiver_player_name=None if rush else receiver,
                            passer_player_id=None if rush else team + '-QB',
                            touchdown=int(number == 0), td_team=team,
                            sack=0, qb_kneel=0, qb_spike=0, two_point_attempt=0,
                            receiving_yards=0 if rush else 10, rushing_yards=6 if rush else 0,
                            passing_yards=0 if rush else 10, complete_pass=int(not rush),
                            pass_touchdown=0, rush_touchdown=int(number == 0)))
        schedule.append(dict(season=2026, week=10, game_type='REG', home_team='ATL',
            away_team='KC', gameday='2026-11-15', gametime='13:00', game_id=cls.GAME))
        cls.pbp = pd.DataFrame(plays)
        cls.schedule = pd.DataFrame(schedule)
        cls.injuries = pd.DataFrame([dict(season=2026, week=10, team='KC',
            gsis_id=cls.WALKER, report_status='Questionable', practice_status='DNP')])

    def report(self, status='OUT', **changes):
        return dict(dict(status=status, team='KC', opponent='ATL', gameId=self.GAME,
            season=2026, week=10, athleteId='4567048',
            source='https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries',
            reportedAt='2026-11-14T17:00:00Z', observedAt=self.NOW.isoformat(),
            sourceUpdatedAt='2026-11-14T17:59:00Z'), **changes)

    def payload(self, report=None):
        return {'reports': {self.WALKER: report or self.report()},
            'diagnostics': {'status': 'ok', 'observed_at': self.NOW.isoformat(), 'matched_reports': 1}}

    def build(self, **overrides):
        options = dict(now=self.NOW, injuries=self.injuries, weekly_rosters=self.weekly)
        options.update(overrides)
        with tempfile.TemporaryDirectory() as directory, patch.object(build_feed, 'OUT', Path(directory)), patch.object(build_feed, 'SEASON', 2026):
            return build_feed.build(self.pbp, self.schedule, self.rosters, **options)

    def test_live_out_replaces_old_questionable_before_candidate_selection(self):
        baseline, old_meta = self.build()
        old = next(p for p in baseline if p['player_id'] == self.WALKER)
        self.assertEqual(old['availability'], 'QUESTIONABLE')
        payload = self.payload()
        original = copy.deepcopy(payload)
        records, meta = self.build(live_injuries=payload)
        self.assertFalse(any(p['player_id'] == self.WALKER for p in records))
        self.assertEqual(meta['availability_diagnostics']['excluded']['out_report'],
            old_meta['availability_diagnostics']['excluded']['out_report'] + 1)
        display = next(p for p in meta['rosterPlayers'] if p['player_id'] == self.WALKER)
        self.assertEqual(display['availability'], 'OUT')
        self.assertEqual(display['injuryReportStatus'], 'OUT')
        self.assertEqual(display['injuryEvidence']['source'], payload['reports'][self.WALKER]['source'])
        self.assertEqual(display['injuryEvidence']['gameId'], self.GAME)
        self.assertEqual(display['injuryEvidence']['effectiveStatus'], 'OUT')
        self.assertFalse(display['playerAppearancesVerified'])
        self.assertEqual(display['seasonGameStats'], [])
        self.assertIsNone(display['playerRushYards'])
        self.assertEqual(meta['availability_diagnostics']['injuries']['live_source']['diagnostics']['applied_reports'], 1)
        self.assertEqual(payload, original, 'publication must not mutate cached source evidence')
        # Actual shared JavaScript consumers must not resurrect the display-only OUT.
        script = """const assert=require('node:assert/strict'),fs=require('node:fs');
        const {records,display}=JSON.parse(fs.readFileSync(0,'utf8'));
        const top=require('./nfl_top_plays'),board=require('./nfl_player_board'),engine=require('./nfl_game_engine');
        const merged=top.mergeRecords(records,[display]);
        assert(engine.blocked(merged.find(p=>p.player_id===display.player_id)));
        const row=board.rows(merged,'TD').find(r=>r.record.player_id===display.player_id);
        assert.equal(row.recommendable,false);assert(row.reasons.some(r=>r.includes('OUT')));"""
        subprocess.run(['node', '-e', script], cwd=Path(build_feed.__file__).parent,
            input=json.dumps({'records': records, 'display': display}), text=True,
            capture_output=True, check=True)

    def test_wrong_player_team_week_season_and_fixture_are_not_applied(self):
        roster_team = dict(zip(self.rosters.gsis_id, self.rosters.team))
        slate = self.schedule[self.schedule.week == 10]
        for changes in ({'team': 'SEA'}, {'opponent': 'BUF'}, {'week': 9},
                        {'season': 2025}, {'gameId': 'another-game'}, {'status': 'ACTIVE'}, {'status': []}):
            with self.subTest(changes=changes):
                self.assertEqual(build_feed.live_injury_reports(self.payload(self.report(**changes)),
                    roster_team, slate, 2026, 10), {})
        wrong_identity = self.payload()
        wrong_identity['reports'] = {'unknown': self.report()}
        self.assertEqual(build_feed.live_injury_reports(wrong_identity, roster_team, slate, 2026, 10), {})

    def test_live_doubtful_preserves_history_and_attaches_current_source(self):
        payload = self.payload(self.report('DOUBTFUL'))
        records, meta = self.build(live_injuries=payload)
        walker = next(p for p in records if p['player_id'] == self.WALKER)
        self.assertEqual(walker['availability'], 'DOUBTFUL')
        self.assertEqual(walker['injuryReportStatus'], 'DOUBTFUL')
        self.assertTrue(walker['playerAppearancesVerified'])
        self.assertEqual(len(walker['seasonGameStats']), 3)
        self.assertEqual(walker['injuryEvidence']['reportedAt'], payload['reports'][self.WALKER]['reportedAt'])
        self.assertEqual(meta['availability_diagnostics']['injuries']['live_source']['reports'], payload['reports'])

    def test_weaker_live_report_cannot_clear_existing_out_or_reserve(self):
        old_out = self.injuries.copy()
        old_out.loc[:, 'report_status'] = 'Out'
        records, meta = self.build(injuries=old_out, live_injuries=self.payload(self.report('QUESTIONABLE')))
        self.assertFalse(any(p['player_id'] == self.WALKER for p in records))
        display = next(p for p in meta['rosterPlayers'] if p['player_id'] == self.WALKER)
        self.assertEqual(display['availability'], 'OUT')
        self.assertEqual(display['injuryReportStatus'], 'OUT')
        reserved = self.rosters[self.rosters.gsis_id == self.WALKER].copy()
        reserved.loc[:, 'status'] = 'IR'
        display = build_feed.display_roster_players(reserved, None,
            self.schedule[self.schedule.week == 10], 2026, 10, self.NOW,
            injury_status={self.WALKER: 'QUESTIONABLE'})[0]
        self.assertEqual(display['availability'], 'IR')

    def test_missing_supplement_keeps_existing_behavior_and_diagnostics(self):
        records, meta = self.build()
        self.assertTrue(any(p['player_id'] == self.WALKER for p in records))
        self.assertNotIn('live_source', meta['availability_diagnostics']['injuries'])
        records, meta = self.build(live_injuries={'reports': {}, 'diagnostics': {'status': 'unavailable'}})
        self.assertTrue(any(p['player_id'] == self.WALKER for p in records))
        self.assertEqual(meta['availability_diagnostics']['injuries']['live_source']['diagnostics']['status'], 'unavailable')


if __name__ == '__main__':
    unittest.main()
