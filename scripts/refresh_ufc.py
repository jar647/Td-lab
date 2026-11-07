#!/usr/bin/env python3
"""Secure UFC statistics refresh. API key stays in GitHub Actions secrets.
FighterAPI REST docs: /v1/get_schedule -> data.bouts; /v1/get_fighter -> data.career_rates.
"""
import datetime,json,os,pathlib,sys,time,urllib.request
KEY=os.getenv("FIGHTERAPI_KEY","").strip()
OUT=pathlib.Path("ufc_fighter_data.json")
if not KEY:
    print("FIGHTERAPI_KEY absent: skipping refresh; no unverified data generated.")
    sys.exit(0)
def api(method,args):
    request=urllib.request.Request("https://mcp.fighterapi.com/v1/"+method,data=json.dumps(args).encode(),headers={"Content-Type":"application/json","x-api-key":KEY},method="POST")
    with urllib.request.urlopen(request,timeout=30) as response: raw=json.load(response)
    if not isinstance(raw,dict) or not isinstance(raw.get("data"),dict):raise ValueError("Unexpected FighterAPI REST envelope")
    return raw["data"]
def stats(profile):
    rates=profile.get("career_rates") or {}
    aliases={"slpm":("sig_landed_per_15",15),"sapm":("sig_absorbed_per_15",15),"strAcc":("sig_accuracy",1),"strDef":("sig_defense",1),"tdAvg":("td_per_15",1),"tdAcc":("td_accuracy",1),"tdDef":("td_defense",1),"subAvg":("sub_attempts_per_15",1)}
    result={}
    for k,(source,divisor) in aliases.items():
        v=rates.get(source)
        if isinstance(v,bool):return None
        if isinstance(v,str):
            try:v=float(v.strip().rstrip("%"))
            except ValueError:return None
        if not isinstance(v,(int,float)) or not __import__("math").isfinite(v):return None
        v=float(v)/divisor
        if k in ("strAcc","strDef","tdAcc","tdDef"):
            if 0<=v<=1:v*=100
            elif not 0<=v<=100:return None
        if not 0<=v<=1000:return None
        result[k]=round(v,5)
    return result
old={}
if OUT.exists():
    try:old=json.loads(OUT.read_text()).get("fighters",{})
    except (ValueError,OSError):pass
schedule=api("get_schedule",{"days":42})
bouts=schedule.get("bouts",[])
if not isinstance(bouts,list):raise ValueError("Unexpected schedule.bouts")
fighters={}
for bout in bouts:
    if not isinstance(bout,dict):continue
    for side in ("a","b"):
        fid=bout.get("fighter_"+side)
        name=bout.get("fighter_"+side+"_name")
        if not fid or not name:continue
        key=name.strip().casefold()
        if key in fighters:continue
        if key in old and old[key].get("id")==str(fid) and old[key].get("fetched_at") and all(isinstance(old[key].get("stats",{}).get(metric),(int,float)) for metric in ("slpm","sapm","strAcc","strDef","tdAvg","tdAcc","tdDef","subAvg")) and (datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(old[key]["fetched_at"])).total_seconds() < 86400:
            fighters[key]=old[key]
            continue
        try:
            data=api("get_fighter",{"fighter_id":str(fid)})
            extracted=stats(data)
            if extracted: fighters[key]={"id":str(fid),"name":name,"stats":extracted,"record":data.get("fighter",{}).get("pro_record"),"rating":data.get("rating",{}).get("current"),"fetched_at":datetime.datetime.now(datetime.timezone.utc).isoformat()}
            else:print("Incomplete career rates:",name)
        except Exception as exc:print("Fighter refresh error:",name,type(exc).__name__)
        time.sleep(0.12)
if not fighters:
    print("No complete verified fighter profiles; refusing to overwrite cache.")
    sys.exit(1)
payload={"coverage":{"profiles":len(fighters),"fighters_expected":len({str(b.get("fighter_"+side)) for b in bouts if isinstance(b,dict) for side in ("a","b") if b.get("fighter_"+side)}),"complete":len(fighters)>=len({str(b.get("fighter_"+side)) for b in bouts if isinstance(b,dict) for side in ("a","b") if b.get("fighter_"+side)})},"generated_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"source":"FighterAPI authenticated REST get_schedule/get_fighter","fighters":fighters,"scheduled_bouts":len(bouts)}
OUT.write_text(json.dumps(payload,ensure_ascii=False,separators=(",",":"))+"\n")
print("Verified profiles:",len(fighters),"scheduled bouts:",len(bouts))
