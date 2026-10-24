#!/usr/bin/env python3
"""Walk-forward experimental defensive model comparison; no live-model changes."""
import json
from pathlib import Path
import pandas as pd
import nflreadpy

SEASONS=[2025,2026]
MARKETS={
 "PASS":("passer_player_id","pass_attempt","passing_yards"),
 "RUSH":("rusher_player_id","rush_attempt","rushing_yards"),
 "REC":("receiver_player_id","pass_attempt","receiving_yards"),
 "CATCH":("receiver_player_id","pass_attempt","complete_pass"),
}
def numeric(s):
    return pd.to_numeric(s,errors="coerce").fillna(0)
def main():
    outcomes=[]
    for season in SEASONS:
        pbp=nflreadpy.load_pbp(seasons=[season])
        if hasattr(pbp,"to_pandas"):pbp=pbp.to_pandas()
        pbp=pbp[(pbp.season==season)&(pbp.season_type=="REG")].copy()
        if "no_play" in pbp:pbp=pbp[numeric(pbp.no_play)==0]
        for market,(pid,flag,metric) in MARKETS.items():
            needed={pid,flag,metric,"week","game_id","posteam","defteam"}
            if not needed.issubset(pbp.columns):raise RuntimeError(f"Missing {market} columns: {needed-set(pbp.columns)}")
            events=pbp[(numeric(pbp[flag])==1)&pbp[pid].notna()&pbp.posteam.notna()&pbp.defteam.notna()].copy()
            events["value"]=numeric(events[metric])
            if market=="CATCH":events["value"]=events.value.clip(0,1)
            # Player-game rows. This is an event-observed sample, not a complete
            # appearance history: zero-event appearances cannot be recovered here.
            games=events.groupby([pid,"week","game_id","posteam","defteam"],as_index=False).value.sum()
            # Defense/team-game totals. Defense's last five means previous
            # completed games, including zero position events when known.
            dgames=events.groupby(["defteam","week","game_id"],as_index=False).value.sum()
            # Schedule proxy from all PBP rows, to retain zero-event games.
            played=pbp[["defteam","week","game_id"]].dropna().drop_duplicates()
            dgames=played.merge(dgames,on=["defteam","week","game_id"],how="left").fillna({"value":0})
            teamgames=events.groupby(["posteam","week","game_id"],as_index=False).value.sum()
            d_history={t:g.sort_values(["week","game_id"]) for t,g in dgames.groupby("defteam")}
            t_history={t:g.sort_values(["week","game_id"]) for t,g in teamgames.groupby("posteam")}
            for player,g in games.groupby(pid):
                g=g.sort_values(["week","game_id"])
                for _,row in g.iterrows():
                    week=int(row.week)
                    prev=g[g.week<week]
                    if len(prev)<3:continue
                    hist=prev.value.to_numpy(dtype=float)
                    season_avg=float(hist.mean())
                    recent_avg=float(hist[-3:].mean())
                    blend=.7*season_avg+.3*recent_avg
                    defense=str(row.defteam)
                    dh=d_history.get(defense)
                    if dh is None:continue
                    dh=dh[dh.week<week]
                    if len(dh)<3:continue
                    allowed=float(dh.value.mean())
                    # Existing live formula: season allowed / player season
                    # average, clamped, with 25% of that factor applied.
                    old_ratio=max(.85,min(1.15,allowed/max(season_avg,1)))
                    old=blend*(.75+.25*old_ratio)
                    recent_allowed=float(dh.value.tail(5).mean())
                    # Opponent strength context from earlier offensive games,
                    # excluding each opponent's game against this defense.
                    foes=pbp[(pbp.defteam==defense)&(pbp.week<week)][["game_id","posteam"]].dropna().drop_duplicates()
                    baselines=[]
                    for _,foe in foes.iterrows():
                        tg=t_history.get(str(foe.posteam))
                        if tg is None:continue
                        earlier=tg[(tg.week<week)&(tg.game_id!=foe.game_id)]
                        if len(earlier)>=2:baselines.append(float(earlier.value.mean()))
                    strength=(allowed/(sum(baselines)/len(baselines))) if baselines and sum(baselines)>0 else None
                    # Candidate: blend season and recent defensive allowances,
                    # moderate opponent-strength normalization, cap adjustment.
                    adjusted=.6*allowed+.4*recent_allowed
                    if strength is not None:
                        adjusted*=max(.85,min(1.15,1/strength))
                    new_ratio=max(.85,min(1.15,adjusted/max(season_avg,1)))
                    new=blend*(.75+.25*new_ratio)
                    actual=float(row.value)
                    outcomes.append({"season":season,"week":week,"market":market,
                        "old_error":abs(actual-old),"new_error":abs(actual-new),
                        "old_sq":(actual-old)**2,"new_sq":(actual-new)**2,
                        "old_in20":old*.8<=actual<=old*1.2,
                        "new_in20":new*.8<=actual<=new*1.2,
                        "has_strength":strength is not None})
    if not outcomes:raise RuntimeError("No eligible historical predictions")
    df=pd.DataFrame(outcomes)
    result=[]
    for (season,market),g in df.groupby(["season","market"]):
        result.append({"season":int(season),"market":market,"sample":len(g),
            "old_mae":round(float(g.old_error.mean()),3),
            "new_mae":round(float(g.new_error.mean()),3),
            "mae_improvement":round(float(g.old_error.mean()-g.new_error.mean()),3),
            "old_rmse":round(float(g.old_sq.mean()**.5),3),
            "new_rmse":round(float(g.new_sq.mean()**.5),3),
            "old_20pct_coverage":round(float(g.old_in20.mean()),3),
            "new_20pct_coverage":round(float(g.new_in20.mean()),3),
            "opponent_strength_samples":int(g.has_strength.sum())})
    output={"method":"Experimental walk-forward defense comparison. Uses prior player event-observed games, prior defensive games, and prior opponent offensive production only. NOT a complete appearance-aware validation. Opponent baseline is team-level; receiving markets are not position-specific in this experiment. The current live projection remains unchanged.","results":result}
    path=Path("data/defense_model_comparison.json")
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(output,indent=2))
    print(path.read_text())
if __name__=="__main__":main()
