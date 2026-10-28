"""Daily NBA learning regression: immutable data and no look-ahead."""
import datetime
import unittest
from nba_daily_learning import observation_rows, report, walk_forward


class NBAResearchDailyTests(unittest.TestCase):
    @staticmethod
    def fixtures(days=9, n=40):
        start=datetime.datetime(2026,10,22,tzinfo=datetime.timezone.utc)
        snaps=[]
        for day in range(days):
            tip=start+datetime.timedelta(days=day,hours=23)
            lock=tip-datetime.timedelta(hours=7)
            rows=[]
            for i in range(n):
                actual=float(12+i%8)
                predicted=actual+3
                rows.append({
                    "player_id":str(i), "market":"points", "sample":5,
                    "projection":predicted,"actual":actual,"result":"outside_20pct"
                })
            snaps.append({
                "game_id":f"G{day}","model":"research-v1",
                "tipoff":tip.isoformat(),"locked_at":lock.isoformat(),
                "projections":rows
            })
        return {"updated_at":"2026-10-28T00:00:00+00:00","snapshots":snaps}

    def test_walk_forward_improvement_uses_past_only(self):
        data=self.fixtures()
        rows,inv=observation_rows(data)
        metric=walk_forward(rows)
        self.assertGreater(metric["walk_forward_holdout_days"],0)
        self.assertLess(metric["bias_challenger_holdout_mae"],
                        metric["baseline_holdout_mae"])
        self.assertGreater(metric["daily_walk_forward"][0]["train_days"],2)
        # Rewriting the LATER test day cannot change an EARLIER fitted
        # challenger adjustment, regardless of the future result.
        before=metric["daily_walk_forward"][0]
        latest=max(r["day"] for r in rows)
        for r in rows:
            if r["day"]==latest:r["actual"]=10000.
        after=walk_forward(rows)["daily_walk_forward"][0]
        self.assertEqual(before,after)

    def test_invalid_lock_excluded(self):
        data=self.fixtures(days=1,n=5)
        data["snapshots"][0]["locked_at"]=data["snapshots"][0]["tipoff"]
        rows,inv=observation_rows(data)
        self.assertEqual(rows,[])
        self.assertEqual(inv["invalid_pregame_locks"],1)

    def test_pending_and_dnp_never_graded_as_miss(self):
        data=self.fixtures(days=1,n=5)
        values=data["snapshots"][0]["projections"]
        values[0]["result"]="pending"
        values[1]["result"]="dnp"
        rows,inv=observation_rows(data)
        self.assertEqual(len(rows),3)
        self.assertEqual(inv["pending_predictions"],1)
        self.assertEqual(inv["dnp"],1)

    def test_model_versions_kept_separate(self):
        data=self.fixtures(days=2,n=5)
        data["snapshots"][1]["model"]="research-v2"
        result=report(data,datetime.datetime(2026,11,3,tzinfo=datetime.timezone.utc))
        self.assertEqual(set(result["models"]),{"research-v1","research-v2"})
        self.assertFalse(result["bet_ready"])
        self.assertFalse(result["automated_model_promotion"])

    def test_duplicate_player_market_rejected(self):
        data=self.fixtures(days=1,n=5)
        data["snapshots"][0]["projections"].append(
            dict(data["snapshots"][0]["projections"][0]))
        with self.assertRaisesRegex(ValueError,"Duplicate NBA"):
            observation_rows(data)

    def test_future_date_same_day_is_never_training(self):
        data=self.fixtures(days=8,n=30)
        # All forecasts from one Eastern day must not be trained on
        # one another, even when the tipoffs differ by hours.
        data["snapshots"][1]["tipoff"]=data["snapshots"][0]["tipoff"]
        data["snapshots"][1]["locked_at"]=data["snapshots"][0]["locked_at"]
        rows,_=observation_rows(data)
        audit=walk_forward(rows)
        self.assertTrue(all(
            entry["train_days"]>=3 for entry in audit["daily_walk_forward"]
        ))


if __name__=="__main__":
    unittest.main()
