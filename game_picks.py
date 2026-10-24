#!/usr/bin/env python3
"""Game-picks research feed. No uncalibrated probabilities or invented market lines."""
import json
from datetime import datetime, timezone
from pathlib import Path
import pandas as pd
import nflreadpy

ROOT=Path(__file__).resolve().parent
def frame(x): return x.to_pandas() if hasattr(x,"to_pandas") else pd.DataFrame(x)
def main():
    status=json.loads((ROOT/"data/status.json").read_text())
    season=int(status.get("season",datetime.now(timezone.utc).year))
    week=int(status.get("week",0))
    schedules=frame(nflreadpy.load_schedules([season]))
    slate=schedules[(pd.to_numeric(schedules["season"],errors="coerce")==season)&(pd.to_numeric(schedules["week"],errors="coerce")==week)&(schedules["game_type"].astype(str).str.upper()=="REG")]
    games=[]
    for _,r in slate.iterrows():
        games.append({"game_id":str(r["game_id"]),"home":str(r["home_team"]),"away":str(r["away_team"]),"gameday":str(r["gameday"]),
          "ml":{"pick":None,"confidence":None,"status":"PASS"},
          "ats":{"pick":None,"confidence":None,"status":"PASS","line":None},
          "total":{"pick":None,"confidence":None,"status":"PASS","line":None},
          "reason":"Awaiting validated team-efficiency model, current sportsbook lines and calibrated probabilities."})
    out={"season":season,"week":week,"generated_at":datetime.now(timezone.utc).isoformat(),
      "model_status":"RESEARCH_ONLY","note":"Game slate is real. No betting picks or confidence percentages until out-of-sample calibration and live market validation.","games":games}
    path=ROOT/"data/game_picks.json"
    path.write_text(json.dumps(out,indent=2))
    print("Game picks research slate:",len(games),"games; betting recommendations withheld until validation")
if __name__=="__main__":main()
