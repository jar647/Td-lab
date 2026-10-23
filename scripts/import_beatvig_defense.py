#!/usr/bin/env python3
"""Import published BeatVig last-five-game defense-vs-position tables.

Independent reference only. A team's last five *played* games may differ from
the primary feed's last five calendar weeks. Do not silently overwrite data.
"""
import argparse
import json
import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.request import Request, urlopen

BASE = "https://beatvig.com/nfl/defense-vs-position/"
TEAM_NAMES = """Arizona Cardinals|Atlanta Falcons|Baltimore Ravens|Buffalo Bills|Carolina Panthers|Chicago Bears|Cincinnati Bengals|Cleveland Browns|Dallas Cowboys|Denver Broncos|Detroit Lions|Green Bay Packers|Houston Texans|Indianapolis Colts|Jacksonville Jaguars|Kansas City Chiefs|Las Vegas Raiders|Los Angeles Chargers|Los Angeles Rams|Miami Dolphins|Minnesota Vikings|New England Patriots|New Orleans Saints|New York Giants|New York Jets|Philadelphia Eagles|Pittsburgh Steelers|San Francisco 49ers|Seattle Seahawks|Tampa Bay Buccaneers|Tennessee Titans|Washington Commanders""".split("|")
ABBREVS = dict(zip(TEAM_NAMES, """ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LV LAC LA MIA MIN NE NO NYG NYJ PHI PIT SF SEA TB TEN WAS""".split()))
# The primary nflverse feed uses LA for Rams and WAS for Washington.
COLUMNS = {
    "qb": {"Pass yds": "pass_yards_per_game", "Att": "pass_attempts_per_game"},
    "rb": {"Rush yds": "rush_yards_per_game", "Rec yds": "rec_yards_per_game", "Rec": "receptions_per_game", "Tgt": "targets_per_game"},
    "wr": {"Rec yds": "rec_yards_per_game", "Rec": "receptions_per_game", "Tgt": "targets_per_game"},
    "te": {"Rec yds": "rec_yards_per_game", "Rec": "receptions_per_game", "Tgt": "targets_per_game"},
}

class Tables(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tables = []
        self.table = None
        self.row = None
        self.cell = None
    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self.table = []
        elif self.table is not None and tag == "tr":
            self.row = []
        elif self.row is not None and tag in ("th", "td"):
            self.cell = []
    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)
    def handle_endtag(self, tag):
        if tag in ("th", "td") and self.cell is not None:
            self.row.append(" ".join("".join(self.cell).split()))
            self.cell = None
        elif tag == "tr" and self.row is not None:
            self.table.append(self.row)
            self.row = None
        elif tag == "table" and self.table is not None:
            self.tables.append(self.table)
            self.table = None

def parse_page(html, position):
    parser = Tables()
    parser.feed(html)
    candidates = [t for t in parser.tables if t and "Defense" in t[0] and "G" in t[0]]
    if not candidates:
        raise ValueError(f"{position}: defense table not found (site format changed)")
    table = candidates[0]
    headers = table[0]
    output = {}
    for cells in table[1:]:
        if len(cells) != len(headers):
            continue
        name = next((team for team in TEAM_NAMES if team in cells[0]), None)
        if not name:
            continue
        if name in output:
            raise ValueError(f"{position}: duplicate {name}")
        row = {"defense": ABBREVS[name], "position": position.upper()}
        row["games"] = int(cells[headers.index("G")])
        for label, key in COLUMNS[position].items():
            matching = [h for h in headers if h.lower().startswith(label.lower())]
            if not matching:
                continue
            value = cells[headers.index(matching[0])]
            match = re.match(r"^-?\\d+(?:\\.\\d+)?", value.replace(",", ""))
            if not match:
                raise ValueError(f"{position}: bad {label} for {name}: {value!r}")
            row[key] = float(match.group())
        output[name] = row
    if len(output) != 32:
        raise ValueError(f"{position}: expected 32 defenses, got {len(output)}")
    if any(row["games"] != 5 for row in output.values()):
        raise ValueError(f"{position}: expected last 5 played games for every defense")
    return list(output.values())

def fetch(url):
    req = Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; PropVaultAudit/1.0)"})
    with urlopen(req, timeout=25) as response:
        return response.read().decode("utf-8")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", type=Path, default=Path("data/beatvig_defense_reference.json"))
    args = ap.parse_args()
    rows = []
    for pos in COLUMNS:
        rows.extend(parse_page(fetch(BASE + pos), pos))
    result = {"source": "BeatVig defense vs position (public website)", "source_url": BASE,
              "window": "last_5_played_games", "season": datetime.now(timezone.utc).year,
              "retrieved_at": datetime.now(timezone.utc).isoformat(),
              "verification": "EXTERNAL_REFERENCE_NOT_YET_RECONCILED", "rows": rows}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\\n")
    print(f"Imported {len(rows)} defense-position records from BeatVig")

if __name__ == "__main__":
    main()
