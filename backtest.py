#!/usr/bin/env python3
"""Leakage-free nflverse PBP research backtest. No bookmaker claims."""
import json
from pathlib import Path
import numpy as np
import pandas as pd
import nflreadpy

SEASONS=[2025,2026]
MARKETS={
 "PASS":("passer_player_id","pass_attempt","passing_yards"),
 "RUSH":("rusher_player_id","rush_attempt","rushing_yards"),
 "REC":("receiver_player_id","pass_attempt","receiving_yards"),
 "CATCH":("receiver_player_id","pass_attempt","complete_pass"),
}
def main():
    results=[]
    for season in SEASONS:
        pbp=nflreadpy.load_pbp(seasons=[season])
        if hasattr(pbp,"to_pandas"):pbp=pbp.to_pandas()
        pbp=pbp[(pbp.season==season)&(pbp.season_type=="REG")].copy()
        if "no_play" in pbp:pbp=pbp[pd.to_numeric(pbp.no_play,errors="coerce").fillna(0)==0]
        for market,(pid,flag,yards) in MARKETS.items():
            if not set((pid,flag,yards)).issubset(pbp.columns):continue
            rows=pbp[(pd.to_numeric(pbp[flag],errors="coerce")==1)&pbp[pid].notna()].copy()
            rows["value"]=pd.to_numeric(rows[yards],errors="coerce").fillna(0)
            if market=="CATCH":rows["value"]=rows["value"].clip(0,1)
            games=rows.groupby([pid,"week","game_id"],as_index=False).value.sum().sort_values([pid,"week","game_id"])
            # Each prediction uses only earlier appearances. Minimum three played games.
            for player,g in games.groupby(pid):
                values=g.value.to_numpy(dtype=float)
                weeks=g.week.to_numpy()
                for i in range(3,len(g)):
                    history=values[:i]
                    baseline=float(history.mean())
                    recent=float(history[-3:].mean())
                    challenger=.7*baseline+.3*recent
                    actual=float(values[i])
                    results.append(dict(season=season,week=int(weeks[i]),market=market,baseline_error=abs(actual-baseline),challenger_error=abs(actual-challenger),baseline_in_range=baseline*.8<=actual<=baseline*1.2,challenger_in_range=challenger*.8<=actual<=challenger*1.2))
    if not results:raise RuntimeError("No eligible completed player games; no result published")
    df=pd.DataFrame(results)
    out=[]
    for (season,market),g in df.groupby(["season","market"]):
        out.append(dict(season=int(season),market=market,sample=int(len(g)),baseline_mae=round(float(g.baseline_error.mean()),3),challenger_mae=round(float(g.challenger_error.mean()),3),baseline_range_coverage=round(float(g.baseline_in_range.mean()),3),challenger_range_coverage=round(float(g.challenger_in_range.mean()),3)))
    path=Path("data/backtest_report.json")
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps({"method":"Walk-forward, prior played games only. Challenger 70% season-to-date + 30% prior-three production. No defense, snap share, target share, air yards, sportsbook odds or calibrated probabilities. This is a partial baseline test, NOT a validation of the full live model.","results":out},indent=2))
    print(path.read_text())
if __name__=="__main__":main()
