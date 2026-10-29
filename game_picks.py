#!/usr/bin/env python3
"""Leakage-safe game score research baseline. No uncalibrated betting advice."""
import json
from datetime import datetime, timezone
from pathlib import Path
import pandas as pd
import nflreadpy
from game_context import team_context, matchup_context, adjusted_projection, travel_estimate, residual_context
from nfl_weather import forecast_for_game
from nfl_research import enrich_research, injury_research

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
    def shrunk(values):return (float(values.sum())+PRIOR_GAMES*LEAGUE_POINTS)/(len(values)+PRIOR_GAMES)
    return {"games":n,"offense":round(shrunk(scored),2),
            "defense_allowed":round(shrunk(conceded),2),
            "home_games":len(home),"home_offense":round(shrunk(pd.to_numeric(home.home_score,errors="coerce").dropna()),2),
            "home_defense_allowed":round(shrunk(pd.to_numeric(home.away_score,errors="coerce").dropna()),2),
            "away_games":len(away),"away_offense":round(shrunk(pd.to_numeric(away.away_score,errors="coerce").dropna()),2),
            "away_defense_allowed":round(shrunk(pd.to_numeric(away.home_score,errors="coerce").dropna()),2)}

def score_projection(home,away):
    # Overall offense/defense rates are blended with shrunk home/road splits.
    # Split influence grows with the available venue sample, capped at 30%.
    h_overall=(home["offense"]+away["defense_allowed"])/2+HOME_ADVANTAGE_POINTS/2
    a_overall=(away["offense"]+home["defense_allowed"])/2-HOME_ADVANTAGE_POINTS/2
    split_weight=min(.30,.05*min(home.get("home_games",0),away.get("away_games",0)))
    h_split=(home["home_offense"]+away["away_defense_allowed"])/2+HOME_ADVANTAGE_POINTS/2
    a_split=(away["away_offense"]+home["home_defense_allowed"])/2-HOME_ADVANTAGE_POINTS/2
    h=(1-split_weight)*h_overall+split_weight*h_split
    a=(1-split_weight)*a_overall+split_weight*a_split
    return round(max(0,h),1),round(max(0,a),1)

def team_record(history,team):
    rows=[]
    for _,g in history.iterrows():
        if str(g.home_team)==team: rows.append(("home",g.home_score,g.away_score))
        elif str(g.away_team)==team: rows.append(("away",g.away_score,g.home_score))
    def result(items):
        wins=sum(float(a)>float(b) for _,a,b in items)
        losses=sum(float(a)<float(b) for _,a,b in items)
        ties=sum(float(a)==float(b) for _,a,b in items)
        return {"games":len(items),"wins":wins,"losses":losses,"ties":ties}
    home=[x for x in rows if x[0]=="home"]
    away=[x for x in rows if x[0]=="away"]
    return {"overall":result(rows),"home":result(home),"away":result(away)}

def coach_record(history,coach):
    if not coach or "home_coach" not in history or "away_coach" not in history:return None
    rows=[]
    for _,g in history.iterrows():
        home_value=g.get("home_coach")
        away_value=g.get("away_coach")
        home_name="" if pd.isna(home_value) else str(home_value)
        away_name="" if pd.isna(away_value) else str(away_value)
        if home_name==coach:
            rows.append((g.home_score,g.away_score))
        elif away_name==coach:
            rows.append((g.away_score,g.home_score))
    if not rows:return {"games":0,"wins":0,"losses":0,"ties":0}
    return {"games":len(rows),"wins":sum(float(a)>float(b) for a,b in rows),
            "losses":sum(float(a)<float(b) for a,b in rows),
            "ties":sum(float(a)==float(b) for a,b in rows)}

def key_player_usage(matchups,team):
    rows=[p for p in matchups if p.get("team")==team]
    qbs=sorted((p for p in rows if p.get("pos")=="QB"),
               key=lambda p:float(p.get("playerPassAttempts") or 0),reverse=True)
    qb=qbs[0] if qbs else None
    skill=[p for p in rows if p.get("pos") in ("RB","WR","TE")]
    skill.sort(key=lambda p:float(p.get("playerTargets") or 0)+float(p.get("playerCarries") or 0),reverse=True)
    def card(p):
        return {"name":p.get("player"),"position":p.get("pos"),
          "games":p.get("seasonGamesPlayed",p.get("games")),
          "availability":p.get("injuryReportStatus") if p.get("injuryReportStatus") not in (None,"NOT_REPORTED") else (p.get("gameDayAvailability") or "NOT_REPORTED"),
          "practice":p.get("injuryPracticeStatus") or "NOT_REPORTED",
          "pass_attempts_per_game":p.get("playerPassAttempts"),
          "pass_yards_per_game":p.get("playerPassYards"),
          "carries_per_game":p.get("playerCarries"),"rush_yards_per_game":p.get("playerRushYards"),
          "targets_per_game":p.get("playerTargets"),"receptions_per_game":p.get("playerReceptions"),
          "receiving_yards_per_game":p.get("playerRecYards"),"recent_form":p.get("last5Averages")}
    return {"quarterback":card(qb) if qb else None,
            "top_usage_players":[card(p) for p in skill[:3]],
            "availability_warning":"Feed labels are not official game-day inactive confirmation."}

def game_research_context(game,history,home,away,matchups):
    def text(key):
        value=game.get(key)
        return None if pd.isna(value) else (str(value).strip() or None)
    home_coach=text("home_coach")
    away_coach=text("away_coach")
    neutral=(text("location") or "").lower()=="neutral"
    def val(key):
        value=game.get(key)
        try:return None if pd.isna(value) else float(value)
        except (TypeError,ValueError):return None
    return {"teams":{home:{"record":team_record(history,home),"coach":home_coach,
                    "coach_record":coach_record(history,home_coach),"usage":key_player_usage(matchups,home)},
                    away:{"record":team_record(history,away),"coach":away_coach,
                    "coach_record":coach_record(history,away_coach),"usage":key_player_usage(matchups,away)}},
        "rest_days":{"home":val("home_rest"),"away":val("away_rest")},
        "venue":{"name":game.get("game_stadium") or game.get("stadium"),"location":game.get("location"),
                 "roof":game.get("roof"),"surface":game.get("surface"),
                 "temperature_f":val("temp"),"wind_mph":val("wind")},
        "travel":travel_estimate(away,home,neutral),
        "source_note":"Team/player statistics, injury report fields, coach labels and venue fields are taken from the published nflverse feeds; source coverage and status freshness are shown separately."}

def main():
    status=json.loads((ROOT/"data/status.json").read_text())
    season=int(status.get("season",datetime.now(timezone.utc).year))
    week=int(status.get("week",0))
    schedules=frame(nflreadpy.load_schedules())
    try:
        injuries=frame(nflreadpy.load_injuries([season]))
        rosters=frame(nflreadpy.load_rosters([season]))
        injury_error=None
    except Exception as exc:
        injuries,rosters=None,None
        injury_error=str(exc)
    teams=set(schedules.loc[pd.to_numeric(schedules.season,errors="coerce")==season,"home_team"].dropna().astype(str))
    injury_reports=injury_research(injuries,rosters,season,week,teams)
    if injury_error:
        for report in injury_reports.values():
            report["source_error"]=injury_error
    pbp=frame(nflreadpy.load_pbp([season])).to_dict("records")
    player_feed=json.loads((ROOT/"data/matchups.json").read_text()) if (ROOT/"data/matchups.json").exists() else []
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
        baseline_home,baseline_away=score_projection(h,a)
        home_context=team_context(pbp,season,week,str(r["home_team"]))
        away_context=team_context(pbp,season,week,str(r["away_team"]))
        matchup=matchup_context(home_context,away_context)
        hp,ap=adjusted_projection(baseline_home,baseline_away,matchup)
        research=game_research_context(r,history,str(r["home_team"]),str(r["away_team"]),player_feed)
        weather=forecast_for_game(r,str(r["home_team"]),research["venue"].get("roof"))
        research=enrich_research(research,schedules,season,week,injury_reports)
        research["weather"]=weather
        if weather.get("available"):
            research["venue"].update({"temperature_f":weather.get("temperature_f"),
                "wind_mph":weather.get("wind_mph"),"wind_direction":weather.get("wind_direction"),
                "precipitation_probability":weather.get("precipitation_probability"),
                "weather_condition":weather.get("condition"),"weather_updated_at":weather.get("updated_at")})
        sim_context=residual_context(r,str(r["home_team"]),str(r["away_team"]))
        if weather.get("available"):
            sim_context["temperature_f"]=weather.get("temperature_f")
            sim_context["wind_mph"]=weather.get("wind_mph")
        games.append({"game_id":str(r["game_id"]),"home":str(r["home_team"]),"away":str(r["away_team"]),"gameday":str(r["gameday"]),
          "model_version":"score-baseline-pbp-v2",
          "projected_home_points":hp,"projected_away_points":ap,
          "projected_margin_home":round(hp-ap,1),"projected_total":round(hp+ap,1),
          "model_inputs":{"home":h,"away":a,"baseline_home_points":baseline_home,"baseline_away_points":baseline_away,
            "matchup":matchup,"research_context":research,
            "residual_context":sim_context,
            "prior_games":PRIOR_GAMES,"league_points_prior":LEAGUE_POINTS,"home_advantage_points":HOME_ADVANTAGE_POINTS},
          "ml":{"pick":None,"confidence":None,"status":"PASS"},
          "ats":{"pick":None,"confidence":None,"status":"PASS","line":None},
          "total":{"pick":None,"confidence":None,"status":"PASS","line":None},
          "reason":"Projected score blends historical scoring with a shrunk EPA/success-rate offense-vs-defense matchup adjustment. Inputs use completed prior-week play-by-play only. The scoring distribution and probabilities are uncalibrated; no betting recommendation is issued."})
    out={"season":season,"week":week,"generated_at":datetime.now(timezone.utc).isoformat(),
      "model_status":"EXPERIMENTAL_MATCHUP_SCORE_BASELINE","model_version":"score-baseline-pbp-v2",
      "note":"Projected scores blend completed prior-week points and shrunk home/road splits with offense-vs-defense EPA/success/explosive-play context. Each game also includes team/player usage, injury-report fields, coach records, rest, venue and an approximate travel estimate where available. Uncalibrated research only; no picks.","games":games}
    path=ROOT/"data/game_picks.json"
    path.write_text(json.dumps(out,indent=2))
    print("Game scoring baseline:",len(games),"games; no betting recommendations until validation")
if __name__=="__main__":main()
