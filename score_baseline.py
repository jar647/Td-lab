"""Original scoring baseline, preserved for paired comparisons."""
import pandas as pd

LEAGUE_POINTS=22.0

PRIOR_GAMES=4.0

HOME_ADVANTAGE_POINTS=1.5

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
