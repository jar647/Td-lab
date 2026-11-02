"""One-time backfill of shot descriptions; normal refresh extracts from existing summary calls."""
import concurrent.futures,json,pathlib,urllib.request
from nba_shot_profile import extract_shot_profile
root=pathlib.Path(__file__).resolve().parents[1];path=root/'data/nba_games.json';feed=json.loads(path.read_text())
def enrich(g):
    if g.get('status')!='STATUS_FINAL' or g.get('season_type')!=2 or g.get('shot_profile'):return
    try:
        req=urllib.request.Request('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event='+str(g['id']),headers={'User-Agent':'PropShop research/1.0'})
        with urllib.request.urlopen(req,timeout=25) as r:detail=json.load(r)
        g['shot_profile']=extract_shot_profile(detail)
    except Exception as e:g['shot_profile']={'available':False,'reason':type(e).__name__}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(enrich,feed['games']))
path.with_suffix('.tmp').write_text(json.dumps(feed,separators=(',',':')));path.with_suffix('.tmp').replace(path)
print('Verified shot profiles:',sum(g.get('shot_profile',{}).get('available',False) for g in feed['games']))
