#!/usr/bin/env python3
"""Leakage-safe game score research baseline. No uncalibrated betting advice."""
import json
from datetime import datetime, timezone
from pathlib import Path
import pandas as pd
import nflreadpy

ROOT=Path(__file__).resolve().parent
LEAGUE_POINTS=22.0
PRIOR_GAMES=4.0
HOME_ADVANTAGE_POINTS=1.5

def frame(x):
    return x.to_pandas() if hasattr(x,"to_pandas") else pd.DataFrame(x)

def team_rates(history,team):
    home=history[history.home_team==team]
    away=history[history.away_team==team]
    n=len(home)+len(away)
    scored=pd.concat([pd.to_numeric(home.home_score,errors="coerce"),pd.to_numeric(away.away_score,errors="coerce")])
    conceded=pd.concat([pd.to_numeric(home.away_score,errors="coerce"),pd.to_numeric(away.home_score,errors="coerce")])
    return {"games":n,"offense":round((float(scored.sum())+PRIOR_GAMES*LEAGUE_POINTS)/(n+PRIOR_GAMES),2),
            "defense_allowed":round((float(conceded.sum())+PRIOR_GAMES*LEAGUE_POINTS)/(n+PRIOR_GAMES),2)}

def score_projection(home,away):
    # Offensive scoring blended with opposing defense, with small home adjustment.
    h=(home["offense"]+away["defense_allowed"])/2+HOME_ADVANTAGE_POINTS/2
    a=(away["offense"]+home["defense_allowed"])/2-HOME_ADVANTAGE_POINTS/2
    return round(max(0,h),1),round(max(0,a),1)

def main():
    status=json.loads((ROOT/"data/status.json").read_text())
    season=int(status.get("season",datetime.now(timezone.utc).year))
    week=int(status.get("week",0))
    schedules=frame(nflreadpy.load_schedules([season]))
    regular=schedules[(pd.to_numeric(schedules["season"],errors="coerce")==season)&(schedules["game_type"].astype(str).str.upper()=="REG")].copy()
    regular["week_num"]=pd.to_numeric(regular["week"],errors="coerce")
    slate=regular[regular.week_num==week]
    games=[]
    for _,r in slate.iterrows():
        # Exclude target week entirely, even if a game has already finished.
        # No target-game scores, future scores or current-week leakage.
        history=regular[(regular.week_num<week)&regular.home_score.notna()&regular.away_score.notna()]
        h=team_rates(history,str(r["home_team"]))
        a=team_rates(history,str(r["away_team"]))
        hp,ap=score_projection(h,a)
        games.append({"game_id":str(r["game_id"]),"home":str(r["home_team"]),"away":str(r["away_team"]),"gameday":str(r["gameday"]),
          "projected_home_points":hp,"projected_away_points":ap,
          "projected_margin_home":round(hp-ap,1),"projected_total":round(hp+ap,1),
          "model_inputs":{"home":h,"away":a,"prior_games":PRIOR_GAMES,"league_points_prior":LEAGUE_POINTS,"home_advantage_points":HOME_ADVANTAGE_POINTS},
          "ml":{"pick":None,"confidence":None,"status":"PASS"},
          "ats":{"pick":None,"confidence":None,"status":"PASS","line":None},
          "total":{"pick":None,"confidence":None,"status":"PASS","line":None},
          "reason":"Projected score is an unvalidated scoring baseline, not a betting recommendation. No verified market lines or calibrated win/cover/total probabilities."})
    out={"season":season,"week":week,"generated_at":datetime.now(timezone.utc).isoformat(),
      "model_status":"UNVALIDATED_SCORE_BASELINE","model_version":"score-baseline-v1",
      "note":"Projected scores use completed prior-week scoring only, shrunk toward 22 points/team, with a 1.5-point home advantage. No calibrated probabilities or picks.","games":games}
    path=ROOT/"data/game_picks.json"
    path.write_text(json.dumps(out,indent=2))
    print("Game scoring baseline:",len(games),"games; no betting recommendations until validation")
if __name__=="__main__":main()
