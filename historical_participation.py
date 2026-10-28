"""Strict offensive-snap participation universe for historical NFL prop evaluation.

Uses nflverse weekly rosters, PFR snap counts and schedules. Postgame snaps are
used ONLY to define historical outcomes and zero-stat player appearances.
They are NEVER permitted as a pregame predictive feature.
"""
import pandas as pd

STATS = ("passing_yards", "rushing_yards", "receiving_yards", "receptions",
         "attempts", "carries", "targets")
POSITIONS = {"QB", "RB", "WR", "TE"}

def snap_verified_weekly(weekly, rosters, snaps, schedules, season):
    required = {
        "weekly_stats": (weekly, {"player_id", "season", "week", "game_id", *STATS}),
        "rosters": (rosters, {"gsis_id", "pfr_id", "position", "team"}),
        "snap_counts": (snaps, {"pfr_player_id", "season", "week", "team", "offense_pct"}),
        "schedules": (schedules, {"season", "week", "game_type", "home_team", "away_team", "game_id"}),
    }
    for name, (data, cols) in required.items():
        missing = cols - set(data.columns)
        if missing:
            raise RuntimeError(f"{name} missing required columns: {sorted(missing)}")
    roster = rosters[["gsis_id", "pfr_id", "position", "team"]].dropna(subset=["gsis_id", "pfr_id"]).copy()
    for col in ("gsis_id", "pfr_id", "team"):
        roster[col] = roster[col].astype(str)
    roster["position"] = roster["position"].astype(str).str.upper()
    # Never silently map a PFR identifier that conflicts across GSIS identifiers.
    ambiguity = roster.groupby("pfr_id")["gsis_id"].nunique()
    roster = roster.loc[~roster["pfr_id"].isin(ambiguity[ambiguity != 1].index)].copy()
    # Players can be rostered by several clubs over a season. Match both team
    # AND identifier, never join by player name.
    roster = roster.drop_duplicates(["pfr_id", "team", "gsis_id"])
    inconsistent = roster.groupby(["pfr_id", "team"])["position"].nunique()
    roster = roster.loc[~roster.set_index(["pfr_id", "team"]).index.isin(
        inconsistent[inconsistent != 1].index)]
    roster = roster.drop_duplicates(["pfr_id", "team"])
    roster = roster[roster.position.isin(POSITIONS)]

    s = snaps[pd.to_numeric(snaps["season"], errors="coerce").eq(season)].copy()
    s["offense_pct"] = pd.to_numeric(s["offense_pct"], errors="coerce")
    s = s.loc[s["offense_pct"] > 0].copy()
    s["week"] = pd.to_numeric(s["week"], errors="coerce")
    s["pfr_player_id"] = s["pfr_player_id"].astype(str)
    s["team"] = s["team"].astype(str)
    s = s.merge(roster, left_on=["pfr_player_id", "team"],
                right_on=["pfr_id", "team"], how="inner", validate="many_to_one")
    s = s.drop_duplicates(["gsis_id", "team", "week"])

    sch = schedules.loc[pd.to_numeric(schedules["season"], errors="coerce").eq(season)
                        & schedules["game_type"].astype(str).str.upper().eq("REG"),
                        ["week", "game_id", "home_team", "away_team"]].copy()
    home = sch.rename(columns={"home_team": "team"}).drop(columns="away_team")
    away = sch.rename(columns={"away_team": "team"}).drop(columns="home_team")
    fixtures = pd.concat([home, away], ignore_index=True)
    fixtures["week"] = pd.to_numeric(fixtures["week"], errors="coerce")
    fixtures["team"] = fixtures["team"].astype(str)
    if fixtures.duplicated(["team", "week"]).any():
        raise RuntimeError("Ambiguous regular season schedule by team/week")
    s = s.merge(fixtures, on=["team", "week"], how="inner", validate="many_to_one")
    s["season"] = int(season)
    s["player_id"] = s["gsis_id"].astype(str)

    w = weekly.loc[pd.to_numeric(weekly["season"], errors="coerce").eq(season)].copy()
    w["player_id"] = w["player_id"].astype(str)
    w["game_id"] = w["game_id"].astype(str)
    s["game_id"] = s["game_id"].astype(str)
    w["week"] = pd.to_numeric(w["week"], errors="coerce")
    if "recent_team" in w.columns:
        # nflverse uses recent_team for team as of recorded game.
        w["team"] = w["recent_team"].astype(str)
        join_cols = ["season", "week", "game_id", "player_id", "team"]
    else:
        # Without team identity, traded player/game duplicates could be ambiguous.
        join_cols = ["season", "week", "game_id", "player_id"]
    w = w[join_cols + list(STATS)].copy()
    if w.duplicated(join_cols).any():
        raise RuntimeError("Duplicate player-game statistics; refusing to sum or arbitrarily select")
    matched = s.merge(w, on=join_cols, how="left", validate="one_to_one", indicator=True)
    # An eligible player may have zero statistics, but a missing stats row does
    # not prove zero. Keep explicit provenance so future audits can distinguish.
    matched["boxscore_row_present"] = matched["_merge"].eq("both")
    for stat in STATS:
        matched[stat] = pd.to_numeric(matched[stat], errors="coerce").fillna(0)
    if matched.empty:
        raise RuntimeError(f"No snap-verified offensive player games for {season}")
    # Zero-fill unmatched snaps is justified only when they have independently
    # verified offensive participation. Keep raw per-player rows for audit.
    matched["season_type"] = "REG"
    return matched[["season", "week", "game_id", "player_id", "position", "team",
                    "season_type", "boxscore_row_present", *STATS]].copy()
