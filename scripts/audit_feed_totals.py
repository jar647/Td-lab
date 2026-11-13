#!/usr/bin/env python3
"""Fail-closed reconciliation of published nflverse matchup aggregates.

A team-game denominator is NOT proof of player participation. We audit it as
a team-game rate and require player appearances before calling it per-game.
"""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
def close(a, b):
    return a is not None and b is not None and abs(float(a)-float(b)) <= 0.002
def audit(records, defense):
    errors=[]
    rows={(x["defense"],x["position"]):x for x in defense["rows"]}
    player_metrics={
        "playerPassYards":"passYards",
        "playerRushYards":"rushYards",
        "playerRecYards":"recYards",
        "playerReceptions":"receptions",
        "playerPassAttempts":"passAttempts",
        "playerCarries":"rushAttempts",
        "playerTargets":"targets",
      }
    defense_metrics={
        "defPassYardsAllowed":"pass_yards",
        "defPassAttemptsAllowed":"pass_attempts",
        "defRushYardsAllowed":"rush_yards",
        "defRushAttemptsAllowed":"rush_attempts",
        "defRecYardsAllowed":"rec_yards",
        "defReceptionsAllowed":"receptions",
        "defTargetsAllowed":"targets",
        "defRzTargetsAllowed":"redzone_targets",
    }
    for p in records:
        who=f'{p["team"]}/{p["player_id"]}'
        games=p.get("last5GameStats") or []
        denom=int(p["games"])
        if p.get("seasonGamesPlayed") != denom or not p.get("playerAppearancesVerified"):
            errors.append(f"{who}: season appearance count mismatch")
        if not 1<=denom<=17:
            errors.append(f"{who}: invalid season games played")
        if len(games)>5:
            errors.append(f"{who}: chart exceeds five appearances")
        if len({g["gameId"] for g in games})!=len(games):
            errors.append(f"{who}: duplicate game IDs")
        for field,metric in player_metrics.items():
            if p.get(field) is None:continue
            expected=p.get("seasonAverages",{}).get(metric)
            if not close(p[field],expected):
                errors.append(f"{who}: {field} differs from season average")
        # New TD inputs are verified appearance statistics. Older immutable
        # feeds without them remain valid; partial or inconsistent new inputs
        # cannot silently enter the scorer.
        if p.get('playerAnytimeTDs') is not None:
            history=p.get('seasonGameStats') or []
            if len(history)!=denom or not history or any(
                    any(not isinstance(g.get(k),(int,float)) or isinstance(g.get(k),bool)
                        or not math.isfinite(g[k]) or g[k]<0 or int(g[k])!=g[k] for k in ('rushTDs','recTDs')) for g in history):
                errors.append(f'{who}: invalid anytime-TD appearance history')
            else:
                rush=sum(g['rushTDs'] for g in history)/denom
                receiving=sum(g['recTDs'] for g in history)/denom
                recent=history[-3:]
                recent_total=sum(g['rushTDs']+g['recTDs'] for g in recent)/len(recent)
                for field,value in (('playerRushTDs',rush),('playerRecTDs',receiving),
                                    ('playerAnytimeTDs',rush+receiving),('recent3AnytimeTDs',recent_total)):
                    if not close(p.get(field),round(value,3)):
                        errors.append(f'{who}: {field} differs from verified rushing/receiving TD history')
        d=rows.get((p["opp"],p["pos"]))
        if d is None: errors.append(f"{who}: missing defense audit row");continue
        for field,metric in defense_metrics.items():
            if p.get(field) is None:continue
            expected=d.get(metric+"_per_game")
            if not close(p[field],expected):
                errors.append(f"{who}: {field} {p[field]} != defense {expected}")
            total=d.get(metric+"_total")
            if total is None or not close(expected,round(float(total)/int(d["games"]),3)):
                errors.append(f"{who}: {metric} defensive total/denominator mismatch")
    if errors:raise RuntimeError("Feed audit failed ("+str(len(errors))+"): "+"; ".join(errors[:25]))
    return {"players_checked":len(records),"defensive_rows_checked":len(rows),
            "player_average_definition":"full season totals divided by actual games played",
            "participation_verified":True,"external_boxscore_verified":False,
            "status":"INTERNAL_TOTALS_RECONCILED"}
def main():
    result=audit(json.loads((DATA/"matchups.json").read_text()),
                 json.loads((DATA/"defense_stats_audit.json").read_text()))
    (DATA/"feed_audit.json").write_text(json.dumps(result,indent=2))
    print(json.dumps(result,indent=2))
if __name__=="__main__":main()
