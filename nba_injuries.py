#!/usr/bin/env python3
"""NBA injury collector. ESPN first, Yahoo Sports HTML fallback; never assume missing=healthy."""
import datetime,json,pathlib,urllib.request,sys,re
from html.parser import HTMLParser
ROOT=pathlib.Path(__file__).resolve().parent
ESPN="https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries"
YAHOO="https://sports.yahoo.com/nba/injuries/"
def fetch(url):
 req=urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0","Accept":"text/html,application/json"})
 with urllib.request.urlopen(req,timeout=25) as r:return r.read().decode("utf-8","replace")
def espn(data):
 rows=[]
 for team in data.get("injuries",[]):
  if not isinstance(team,dict):continue
  t=team.get("team",{})
  for item in team.get("injuries",[]) if isinstance(team.get("injuries"),list) else [team]:
   athlete=item.get("athlete",{})
   if not isinstance(athlete,dict):continue
   name=athlete.get("displayName") or athlete.get("fullName")
   if name:rows.append({"player_id":str(athlete.get("id") or ""),"player":name,"team":t.get("displayName","") if isinstance(t,dict) else "","status":str(item.get("status","")),"note":""})
 return rows
class InjuryHTML(HTMLParser):
 def __init__(self):
  super().__init__();self.tagstack=[];self.incell=False;self.cell=[];self.row=[];self.rows=[];self.team="";self.head=[];self.heading=False
 def handle_starttag(self,tag,attrs):
  if tag in ("h2","h3","h4"):self.heading=True;self.head=[]
  if tag=="tr":self.row=[]
  if tag in ("td","th"):self.incell=True;self.cell=[]
 def handle_data(self,data):
  if self.incell:self.cell.append(data)
  if self.heading:self.head.append(data)
 def handle_endtag(self,tag):
  if tag in ("h2","h3","h4") and self.heading:
   name=" ".join(" ".join(self.head).split())
   if name:self.team=name
   self.heading=False
  if tag in ("td","th") and self.incell:
   self.row.append(" ".join(" ".join(self.cell).split()));self.incell=False
  if tag=="tr" and self.row:self.rows.append((self.team,self.row))
def yahoo(html):
 parser=InjuryHTML();parser.feed(html);rows=[]
 for team,cells in parser.rows:
  if len(cells)<3 or cells[0].lower() in ("player","name"):continue
  name=cells[0];status=" ".join(cells[1:])
  m=re.search(r"\b(out|questionable|doubtful|probable|day.to.day|game.time.decision|suspended)\b",status,re.I)
  if not m or len(name)>90:continue
  rows.append({"player_id":"","player":name,"team":team,"status":m.group(1).upper(),"note":status[:250]})
 return rows
def main():
 errors=[];rows=[];source=""
 try:
  rows=espn(json.loads(fetch(ESPN)));source="ESPN"
 except Exception as e:errors.append("ESPN: "+str(e))
 if not rows:
  try:rows=yahoo(fetch(YAHOO));source="Yahoo Sports"
  except Exception as e:errors.append("Yahoo: "+str(e))
 if len(rows)<5:
  print("NBA injury refresh rejected: "+str(len(rows))+" records; "+"; ".join(errors),file=sys.stderr);sys.exit(1)
 now=datetime.datetime.now(datetime.timezone.utc).isoformat()
 payload={"generated_at":now,"source":source,"status":"ok","injuries":rows}
 path=ROOT/"data/nba_injuries.json";path.parent.mkdir(exist_ok=True)
 path.write_text(json.dumps(payload,separators=(",",":")))
 print("NBA injuries:",len(rows),"source:",source)
if __name__=="__main__":main()
