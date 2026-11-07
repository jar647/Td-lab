#!/usr/bin/env python3
"""Validate public UFC cache before publishing; never print private credentials."""
import json, math, pathlib, sys
p=pathlib.Path("ufc_fighter_data.json")
if not p.exists():
    print("UFC cache unavailable: authenticated refresh not configured.")
    sys.exit(0)
d=json.loads(p.read_text())
required=("slpm","sapm","strAcc","strDef","tdAvg","tdAcc","tdDef","subAvg")
fighters=d.get("fighters")
assert isinstance(fighters,dict) and fighters, "Cache must contain fighter profiles"
for name,profile in fighters.items():
    assert isinstance(name,str) and name.strip() and name==name.strip().lower(), "Invalid lookup key"
    assert isinstance(profile,dict) and isinstance(profile.get("stats"),dict), "Missing fighter stats"
    for k in required:
        v=profile["stats"].get(k)
        assert type(v) in (int,float) and math.isfinite(v) and v>=0, f"Invalid {k} for {name}"
        if k in ("strAcc","strDef","tdAcc","tdDef"):
            assert v<=100, f"Invalid percentage {k} for {name}"
coverage=d.get("coverage",{})
if coverage:
    assert coverage.get("profiles")==len(fighters), "Coverage count mismatch"
    assert coverage.get("fighters_expected",0)>=len(fighters), "Expected count smaller than profiles"
    assert coverage.get("complete")==(len(fighters)==coverage["fighters_expected"]), "Incorrect completeness flag"
print(f"UFC cache validated: {len(fighters)} profiles, complete={coverage.get('complete',False)}")
