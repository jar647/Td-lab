"""NFL injury-report evidence quality.

A game designation, practice report, active-roster membership and confirmed
game-day participation are FOUR different facts.  This module never infers
game-day actives from missing injury rows, roster ACT codes, or practice FULL.
Only exact GSIS ID + current team records may influence player filtering.
"""
from __future__ import annotations

import pandas as pd

GAME_DESIGNATIONS = {"OUT", "DOUBTFUL", "QUESTIONABLE"}


def _weekly(injuries, season, week):
    if injuries is None or injuries.empty:
        return pd.DataFrame()
    if not {"season", "week", "gsis_id", "team"}.issubset(injuries.columns):
        return pd.DataFrame()
    rows = injuries.loc[
        pd.to_numeric(injuries["season"], errors="coerce").eq(season)
        & pd.to_numeric(injuries["week"], errors="coerce").eq(week)
    ].copy()
    if not rows.empty:
        rows["team"] = rows["team"].astype(str).str.upper().str.strip()
    return rows


def trusted_injury_rows(injuries, season, week, roster_team):
    """Filter out stale-team and unknown-ID injury rows before assigning risk.

    Return the exact current-week rows for IDs whose current roster team
    matches the injury record team. Failing to match is unknown, never healthy.
    """
    rows = _weekly(injuries, season, week)
    if rows.empty:
        return rows
    current = {str(pid): str(team).upper().strip()
               for pid, team in roster_team.items() if pid is not None}
    mask = rows.apply(
        lambda r: pd.notna(r["gsis_id"])
        and current.get(str(r["gsis_id"]), "") == str(r["team"]), axis=1)
    return rows.loc[mask].copy()


def diagnose_injury_feed(injuries, season, week, slate_teams, roster_team):
    """Report evidence stage and exact identity/coverage quality, not health."""
    teams = sorted({str(t).upper().strip() for t in slate_teams if t})
    output = {
        "report_stage": "SOURCE_UNAVAILABLE",
        "rows_for_week": 0,
        "matched_rows": 0,
        "matched_ids": 0,
        "practice_flags": 0,
        "game_designations_reported": 0,
        "teams_with_injury_rows": [],
        "teams_without_injury_rows": teams,
        "stale_team_or_unmatched_id_rows": 0,
        "current_week_report_status_counts": {},
        "source_last_updated_utc": None,
        "official_game_day_active_confirmed": False,
        "note": "An injury designation is NOT a game-day active list; missing data never confirms healthy.",
    }
    if injuries is None or injuries.empty:
        return output
    output["source_rows"] = int(len(injuries))
    output["columns"] = list(injuries.columns)
    if not {"season", "week", "gsis_id", "team"}.issubset(injuries.columns):
        return output
    all_week = _weekly(injuries, season, week)
    scoped = all_week[all_week["team"].isin(teams)].copy()
    trusted = trusted_injury_rows(scoped, season, week, roster_team)
    output["rows_for_week"] = int(len(scoped))
    output["matched_rows"] = int(len(trusted))
    output["stale_team_or_unmatched_id_rows"] = int(len(scoped) - len(trusted))
    output["teams_with_injury_rows"] = sorted(set(scoped["team"]))
    output["teams_without_injury_rows"] = sorted(set(teams)-set(scoped["team"]))
    if "report_status" in trusted.columns:
        values = trusted["report_status"].fillna("MISSING").astype(str).str.upper().str.strip()
        output["current_week_report_status_counts"] = {
            str(k): int(v) for k, v in values.value_counts().to_dict().items()
        }
        known = trusted.loc[values.isin(GAME_DESIGNATIONS)]
        output["matched_ids"] = int(known["gsis_id"].astype(str).nunique())
        output["game_designations_reported"] = int(len(known))
    if "practice_status" in trusted.columns:
        practice = trusted["practice_status"].fillna("").astype(str).str.upper()
        flagged = practice.str.contains(
            r"DNP|DID NOT PARTICIPATE|LIMITED|^LP$", regex=True, na=False)
        output["practice_flags"] = int(
            trusted.loc[flagged, "gsis_id"].astype(str).nunique()
        )
    if "date_modified" in scoped.columns:
        updated = pd.to_datetime(scoped["date_modified"], errors="coerce", utc=True).max()
        if pd.notna(updated):
            output["source_last_updated_utc"] = updated.isoformat()
    if scoped.empty:
        output["report_stage"] = "NO_CURRENT_WEEK_REPORT"
    elif output["game_designations_reported"]:
        output["report_stage"] = "GAME_DESIGNATIONS_PARTIAL"
    else:
        output["report_stage"] = "PRACTICE_ONLY_NO_GAME_DESIGNATIONS"
    return output
