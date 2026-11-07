#!/usr/bin/env python3
"""Refresh UFC fighter research data using a server-side FighterAPI key.
Never place API keys in public site files. Fail closed on schema changes.
"""
import json, os, urllib.request, datetime, pathlib, sys, time
API="https://mcp.fighterapi.com/v1/"
KEY=os.getenv("FIGHTERAPI_KEY","").strip()
if not KEY:
    print("FIGHTERAPI_KEY not configured. Keeping existing research cache unchanged.")
    sys.exit(0)
def call(tool,args=None):
    body=json.dumps(args or {}).encode()
    req=urllib.request.Request(API+tool,data=body,headers={"Content-Type":"application/json","x-api-key":KEY},method="POST")
    with urllib.request.urlopen(req,timeout=25) as response:
        return json.load(response)
def unwrap(value):
    if isinstance(value,dict):
        for k in ("result","data"):
            if k in value and isinstance(value[k],(dict,list)):return unwrap(value[k])
    return value
def list_items(obj):
    obj=unwrap(obj)
    if isinstance(obj,list):return obj
    if isinstance(obj,dict):
        for k in ("fights","bouts","schedule","events","items"):
            if isinstance(obj.get(k),list):return obj[k]
    return []
def name(f):
    if isinstance(f,str):return f
    if isinstance(f,dict):return f.get("name") or f.get("display_name") or f.get("full_name") or ""
    return ""
def fighter_name(b,side):
    return name(b.get("fighter_"+side+"_name") or b.get("fighter_"+side) or b.get("fighter"+side.upper()) or b.get(side))
def safe_stats(profile):
    profile=unwrap(profile)
    if not isinstance(profile,dict):return None
    stats=profile.get("career_rates") or profile.get("stats") or profile.get("statistics") or {}
    if not isinstance(stats,dict):return None
    aliases={
        "slpm":("slpm","sig_strikes_landed_per_minute","strikes_landed_per_minute"),
        "sapm":("sapm","sig_strikes_absorbed_per_minute","strikes_absorbed_per_minute"),
        "strAcc":("strAcc","striking_accuracy","sig_strike_accuracy"),
        "strDef":("strDef","striking_defense","sig_strike_defense"),
        "tdAvg":("tdAvg","takedown_average","takedowns_per_15_min"),
        "tdAcc":("tdAcc","takedown_accuracy"),
        "tdDef":("tdDef","takedown_defense"),
        "subAvg":("subAvg","submission_average","submissions_per_15_min")}
    result={}
    for field,keys in aliases.items():
        raw=next((stats[k] for k in keys if k in stats and stats[k] is not None),None)
        if raw is None:return None
        try: v=float(str(raw).replace("%",""))
        except (ValueError,TypeError):return None
        if field in ("strAcc","strDef","tdAcc","tdDef") and 0<=v<=1:v*=100
        if not 0<=v<=10000:return None
        result[field]=v
    return result
schedule=list_items(call("get_schedule"))
output={"generated_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"source":"FighterAPI authenticated server-side refresh","fighters":{},"matched_bouts":0}
for bout in schedule[:100]:
    if not isinstance(bout,dict):continue
    for side in ("a","b"):
        label=fighter_name(bout,side)
        fid=bout.get("fighter_"+side+"_id")
        if not label or not fid:continue
        try:
            profile=call("get_fighter",{"fighter_id":str(fid)})
            stats=safe_stats(profile)
            if stats:output["fighters"][label.casefold()]={"name":label,"stats":stats}
        except Exception as exc:
            print("Fighter lookup failed:",label,type(exc).__name__)
        time.sleep(0.1)
    output["matched_bouts"]+=1
if not output["fighters"]:
    print("Provider returned no complete recognized fighter statistics; refusing to overwrite existing cache.")
    sys.exit(1)
path=pathlib.Path("ufc_fighter_data.json")
path.write_text(json.dumps(output,ensure_ascii=False,separators=(",",":"))+"\n")
print("Saved verified fighter profiles:",len(output["fighters"]))
