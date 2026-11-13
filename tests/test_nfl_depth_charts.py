"""Depth-chart source validation and exact roster joins, without network access."""
import copy
import unittest
from datetime import datetime, timezone, timedelta
from nfl_depth_charts import (TEAMS_URL, parse_depth_chart, fetch_depth_charts,
                              apply_depth_chart_context)

NOW=datetime(2026,11,12,20,tzinfo=timezone.utc)

def document(team='NYG'):
    return {'status':'success','timestamp':NOW.isoformat(),
        'season':{'year':2026},'team':{'abbreviation':team},
        'depthchart':[{'name':'3WR 1TE','positions':{
            'qb':{'position':{'abbreviation':'QB'},'athletes':[{'id':'10'},{'id':'11'}]},
            'wr1':{'position':{'abbreviation':'WR'},'athletes':[{'id':'12'},{'id':'13'}]},
            'wr2':{'position':{'abbreviation':'WR'},'athletes':[{'id':'14'}]},
            'wr3':{'position':{'abbreviation':'WR'},'athletes':[{'id':'15'}]},
            'lt':{'position':{'abbreviation':'OT'},'athletes':[{'id':'99'}]}}}]}


class DepthChartTests(unittest.TestCase):
    def test_first_unit_tracks_each_offensive_slot_and_preserves_curated_qb_role(self):
        chart=parse_depth_chart(document(),'NYG',2026,NOW,'https://example.test/depth')
        self.assertEqual(sum(p['unit']=='first' for p in chart['players']),4)
        rosters=[{'gsis_id':'qb','espn_id':10.0,'team':'NYG'},
                 {'gsis_id':'backup','espn_id':'11','team':'NYG'},
                 {'gsis_id':'wr2','espn_id':'14','team':'NYG'}]
        rows=[{'player_id':'qb','team':'NYG','pos':'QB','qbRole':'EXPECTED_STARTER'},
              {'player_id':'backup','team':'NYG','pos':'QB'},
              {'player_id':'wr2','team':'NYG','pos':'WR','displayOnly':True}]
        result=apply_depth_chart_context(rows,rosters,{'charts':{'NYG':chart}},2026)
        self.assertEqual(result['matched_players'],3)
        self.assertEqual(rows[0]['qbRole'],'EXPECTED_STARTER')
        self.assertEqual(rows[0]['depthChart']['unit'],'first')
        self.assertEqual(rows[1]['depthChart']['unit'],'reserve')
        self.assertEqual(rows[2]['depthChart']['slot'],'wr2')
        self.assertIn('game-day status unconfirmed',rows[0]['depthChart']['label'])

    def test_mismatched_or_stale_source_is_rejected(self):
        for modified in [dict(document(),team={'abbreviation':'WAS'}),
                         dict(document(),season={'year':2025}),
                         dict(document(),timestamp=(NOW-timedelta(days=4)).isoformat()),
                         dict(document(),timestamp=(NOW+timedelta(minutes=10)).isoformat())]:
            with self.assertRaises(ValueError):parse_depth_chart(modified,'NYG',2026,NOW,'source')

    def test_names_do_not_match_wrong_ids_teams_positions_or_ambiguous_rosters(self):
        chart=parse_depth_chart(document(),'NYG',2026,NOW,'source')
        rows=[{'player_id':'wrongid','player':'Same Name','team':'NYG','pos':'QB'},
              {'player_id':'wrongteam','player':'Same Name','team':'WAS','pos':'QB'},
              {'player_id':'wrongpos','team':'NYG','pos':'WR'},
              {'player_id':'ambiguous1','team':'NYG','pos':'QB'}]
        roster=[{'gsis_id':'different','espn_id':'10','team':'NYG'},
                {'gsis_id':'wrongteam','espn_id':'10','team':'WAS'},
                {'gsis_id':'wrongpos','espn_id':'11','team':'NYG'},
                {'gsis_id':'ambiguous1','espn_id':'10','team':'NYG'}]
        apply_depth_chart_context(rows,roster,{'charts':{'NYG':chart}},2026)
        self.assertTrue(all('depthChart' not in row for row in rows))

    def test_source_failure_has_no_fabricated_fallback(self):
        def unavailable(url,timeout):raise TimeoutError('test')
        result=fetch_depth_charts(['NYG','WAS'],2026,now=NOW,fetch_json=unavailable)
        self.assertEqual(result['charts'],{})
        self.assertEqual(result['diagnostics']['status'],'unavailable')
        rows=[{'player_id':'qb','team':'NYG','pos':'QB','depthChart':{'unit':'first'}}]
        apply_depth_chart_context(rows,[{'gsis_id':'qb','espn_id':'10','team':'NYG'}],result,2026)
        self.assertNotIn('depthChart',rows[0])
        self.assertNotIn('qbRole',rows[0])

    def test_mapping_requested_once_and_one_bad_team_does_not_block_others(self):
        calls=[]
        def fetch(url,timeout):
            calls.append((url,timeout))
            if url==TEAMS_URL:
                return {'sports':[{'leagues':[{'teams':[{'team':{'id':'19','abbreviation':'NYG'}},
                     {'team':{'id':'28','abbreviation':'WSH'}}]}]}]}
            if '/19/' in url:return document()
            raise TimeoutError('test')
        result=fetch_depth_charts(['NYG','WAS'],2026,now=NOW,fetch_json=fetch)
        self.assertEqual(set(result['charts']),{'NYG'})
        self.assertEqual(result['diagnostics']['status'],'partial')
        self.assertEqual(sum(url==TEAMS_URL for url,_ in calls),1)
        self.assertTrue(all(timeout==8 for _,timeout in calls))


if __name__=='__main__':unittest.main()
