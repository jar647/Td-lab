#!/usr/bin/env python3
"""Fetch StatMuse 2026 defensive position tables. Fail closed on incomplete pages.

These are season-to-date values, not rolling five-week averages.
"""
import argparse
import json
import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.request import Request, urlopen

TEAMS = dict(zip(
    "Cardinals Falcons Ravens Bills Panthers Bears Bengals Browns Cowboys Broncos Lions Packers Texans Colts Jaguars Chiefs Raiders Chargers Rams Dolphins Vikings Patriots Saints Giants Jets Eagles Steelers 49ers Seahawks Buccaneers Titans Commanders".split(),
    "ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LV LAC LA MIA MIN NE NO NYG NYJ PHI PIT SF SEA TB TEN WAS".split()))
POSITIONS = ("RB", "WR", "TE")
COLS = {"REC YDS": "rec_yards_total", "REC": "receptions_total", "TRG": "targets_total",
        "REC TD": "rec_touchdowns_total", "RUSH YDS": "rush_yards_total", "ATT": "rush_attempts_total"}

class TableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tables, self.table, self.row, self.cell = [], None, None, None
    def handle_starttag(self, tag, attrs):
        if tag == "table": self.table = []
        elif tag == "tr" and self.table is not None: self.row = []
        elif tag in ("td", "th") and self.row is not None: self.cell = []
    def handle_data(self, data):
        if self.cell is not None: self.cell.append(data)
    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.cell is not None:
            self.row.append(" ".join("".join(self.cell).split()))
            self.cell = None
        elif tag == "tr" and self.row is not None:
            self.table.append(self.row)
            self.row = None
        elif tag == "table" and self.table is not None:
            self.tables.append(self.table)
            self.table = None

def parse(html, position):
    parser = TableParser()
    parser.feed(html)
    tables = [t for t in parser.tables if t and "OPP" in t[0] and "REC YDS" in t[0] and "GP" in t[0]]
    if len(tables) != 1:
        raise ValueError(f"{position}: expected exactly one opponent stats table, found {len(tables)}")
    headers, rows = tables[0][0], tables[0][1:]
    result = {}
    for cells in rows:
        if len(cells) != len(headers): continue
        opponent = cells[headers.index("OPP")]
        name = opponent.replace("Washington ", "").replace("San Francisco ", "").strip()
        if name not in TEAMS: continue
        abbr = TEAMS[name]
        if abbr in result: raise ValueError(f"Duplicate opponent {abbr}")
        games = int(cells[headers.index("GP")].replace(",", ""))
        if games < 1: raise ValueError("Missing games")
        record = {"defense": abbr, "position": position, "games": games}
        for col, metric in COLS.items():
            if col not in headers: continue
            raw = cells[headers.index(col)].replace(",", "")
            if not re.fullmatch(r"-?\\d+(?:\\.\\d+)?", raw):
                raise ValueError(f"Invalid {metric} for {abbr}: {raw}")
            value = float(raw)
            record[metric] = value
            record[metric.replace("_total", "_per_game")] = round(value / games, 3)
        result[abbr] = record
    if len(result) != 32:
        raise ValueError(f"{position}: incomplete StatMuse table: {len(result)}/32 teams; pagination or layout may have changed")
    return list(result.values())

def fetch(url):
    req = Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; PropVault/1.0)"})
    with urlopen(req, timeout=30) as response:
        return response.read().decode("utf-8")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--output", type=Path, default=Path("data/statmuse_defense.json"))
    args = ap.parse_args()
    rows, urls = [], {}
    for pos, name in (("RB", "running-backs"), ("WR", "wide-receivers"), ("TE", "tight-ends")):
        url = f"https://www.statmuse.com/nfl/ask/{name}-receiving-yards-by-opponent-in-{args.season}"
        rows.extend(parse(fetch(url), pos))
        urls[pos] = url
    report = {"source": "StatMuse", "source_urls": urls, "season": args.season,
              "window": "season_to_date", "retrieved_at": datetime.now(timezone.utc).isoformat(),
              "status": "SOURCE_REPORTED", "rows": rows,
              "note": "StatMuse season-to-date defensive position totals; not rolling five games"}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Fetched {len(rows)} StatMuse position rows")

if __name__ == "__main__":
    main()
