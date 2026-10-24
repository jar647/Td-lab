#!/usr/bin/env python3
"""Fail-closed reconciliation of published nflverse matchup aggregates.

A team-game denominator is NOT proof of player participation. We audit it as
a team-game rate and require player appearances before calling it per-game.
"""
import json
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
        "playerRzTargets":"rzTargets",
        "playerRz":"rzChances",
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
        if not 1<=denom<=5: errors.append(f"{who}: invalid sample denominator")
        if len(games)!=denom: errors.append(f"{who}: {len(games)} chart games != {denom} team games")
        if len({g["gameId"] for g in games})!=len(games):
            errors.append(f"{who}: duplicate game IDs")
        if [g["week"] for g in games]!=sorted(g["week"] for g in games):
            errors.append(f"{who}: game records not chronological")
        for field,metric in player_metrics.items():
            if p.get(field) is None: continue
            total=sum(float(g.get(metric,0)) for g in games)
            if not close(p[field],round(total/denom,3)):
                errors.append(f"{who}: {field} {p[field]} != {total}/{denom}")
        if p.get("teamTargetsTotal") is not None and p.get("playerTargetShare") is not None:
            team_total=int(p["teamTargetsTotal"])
            player_total=sum(float(g.get("targets",0)) for g in games)
            if team_total<=0 or not close(p["playerTargetShare"],round(100*player_total/team_total,3)):
                errors.append(f"{who}: target share mismatch")
        if p.get("teamRzChancesTotal") is not None:
            rz_total=int(p["teamRzChancesTotal"])
            player_rz=sum(float(g.get("rzChances",0)) for g in games)
            if rz_total<=0 or not close(p["rzshare"],round(100*player_rz/rz_total,3)):
                errors.append(f"{who}: red-zone share mismatch")
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
            "player_average_definition":"last five TEAM games, not confirmed player appearances",
            "participation_verified":False,"external_boxscore_verified":False,
            "status":"INTERNAL_TOTALS_RECONCILED"}
def main():
    result=audit(json.loads((DATA/"matchups.json").read_text()),
                 json.loads((DATA/"defense_stats_audit.json").read_text()))
    (DATA/"feed_audit.json").write_text(json.dumps(result,indent=2))
    print(json.dumps(result,indent=2))
if __name__=="__main__":main()
