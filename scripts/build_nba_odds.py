"""NBA prop adapter using the existing OddsPapi secret; no secrets in output.

Catalog IDs/lines are discovered, never hardcoded. Join a fixture by both teams
AND tipoff, then resolve player names uniquely within that game's current roster.
Combined SGP prices are not supplied by this endpoint and are never fabricated.
"""
import datetime as dt
import json
import math
import pathlib
import re
import sys
from scripts.build_hardrock_feed import get
from scripts.odds_provider import ProviderRateLimit
from nba_model import name_key, timestamp, fresh, UTC
from nba_pipeline import atomic

ROOT=pathlib.Path(__file__).resolve().parents[1]

def records(data,key):
    if isinstance(data,list):return data
    return data.get(key,data.get('data',[])) if isinstance(data,dict) else []

def team_key(value):
    return re.sub(r'[^a-z0-9]','',str(value).lower().replace('los angeles','la'))

def match_fixture(fixture,games):
    sides={team_key(fixture.get('participant1Name','')),team_key(fixture.get('participant2Name',''))}
    try:tip=timestamp(fixture.get('startTime') or fixture.get('startDate') or fixture.get('date'))
    except (TypeError,ValueError):return None
    matches=[g for g in games if g.get('status')=='STATUS_SCHEDULED' and sides=={team_key(g['home']),team_key(g['away'])} and abs((timestamp(g['date'])-tip).total_seconds())<=7200]
    return matches[0] if len(matches)==1 else None

def classify_market(name,meta=None):
    # Normalize word order/punctuation, but never infer a partial-game market.
    text=str(name).lower()
    if re.search(r'quarter|half|period|regulation|excluding|excl\.?|first|second|third|fourth|[1-4](?:st|nd|rd|th)',text):return None
    text=re.sub(r'\b(?:including|incl\.?)\s+(?:overtime|ot)\b','',text)
    # Recognize made threes only; attempts and partial games remain excluded.
    text=re.sub(r'\b(?:3[ -]?(?:point(?:er)?s?|pt|pm)|three[ -]?(?:point(?:er)?s?))(?:[ -]?(?:field[ -]?goals?))?(?:[ -]?made)?\b','threes',text)
    text=re.sub(r'\bthrees?(?:[ -]?made)?\b','threes',text)
    words=re.findall(r'[a-z]+',text)
    metadata=meta or {}
    if metadata.get('sportId') is not None and str(metadata['sportId'])!='11':return None
    period=metadata.get('period')
    # Live NBA catalog uses result for markets explicitly including overtime.
    incl_ot=bool(re.search(r'(?:including|incl\.?)\s+(?:overtime|ot)',str(name).lower()))
    if period=='result':
        if not incl_ot or metadata.get('playerProp') is not True:return None
    elif period not in (None,'fulltime','fulltimeinclot','fulltimeinclovertime'):return None
    explicit='over' in words and 'under' in words and 'player' in words
    catalog_verified=metadata.get('playerProp') is True and {str(o.get('outcomeName','')).lower() for o in metadata.get('outcomes',[])}=={'over','under'}
    if not explicit and not catalog_verified:return None
    words=[w for w in words if w not in ('over','under','player','total','full','time','and')]
    # Supported component sets; unknown qualifiers/milestone words fail closed.
    aliases={'point':'points','points':'points','rebound':'rebounds','rebounds':'rebounds','assist':'assists','assists':'assists','threes':'threes'}
    if not words or any(w not in aliases for w in words):return None
    stats=frozenset(aliases[w] for w in words)
    return {frozenset(['points']):'points',frozenset(['rebounds']):'rebounds',frozenset(['assists']):'assists',frozenset(['threes']):'threes',frozenset(['points','rebounds']):'points_rebounds',frozenset(['points','assists']):'points_assists',frozenset(['rebounds','assists']):'rebounds_assists',frozenset(['points','rebounds','assists']):'pra'}.get(stats)

def parse_props(game,catalog,response,players,now,bookmaker='hardrockbet'):
    lookup={str(m.get('marketId')):m for m in records(catalog,'markets')}
    names={}
    for p in players:
        if p.get('team') in (game['home'],game['away']):names.setdefault(name_key(p['name']),set()).add(str(p['id']))
    out=[]
    for mid,market in response.get('bookmakerOdds',{}).get(bookmaker,{}).get('markets',{}).items():
        meta=lookup.get(str(mid),{});kind=classify_market(meta.get('marketName'),meta)
        if not kind:continue
        try:
            line=float(meta['handicap'])
            if line<=0 or not math.isfinite(line):continue
        except (KeyError,ValueError,TypeError):continue
        outcomes={str(o.get('outcomeId')):str(o.get('outcomeName','')).lower().strip() for o in meta.get('outcomes',[])}
        for oid,outcome in market.get('outcomes',{}).items():
            side=outcomes.get(str(oid),'')
            if side not in ('over','under'):continue
            for provider_id,p in outcome.get('players',{}).items():
                if not isinstance(p,dict) or p.get('active') is not True:continue
                ids=names.get(name_key(p.get('playerName','')),set())
                if len(ids)!=1:continue
                try:
                    decimal=float(p['price'])
                    if not math.isfinite(decimal) or decimal<=1:continue
                except (KeyError,ValueError,TypeError):continue
                american=round((decimal-1)*100) if decimal>=2 else round(-100/(decimal-1))
                out.append({'game_id':str(game['id']),'player_id':next(iter(ids)),'market':kind,'side':side,'line':line,'american_odds':american,'bookmaker':bookmaker,'observed_at':now.isoformat(),'provider_player_id':str(provider_id),'provider_market_id':str(mid),'price_changed_at':p.get('changedAt')})
    return out

def collect(feed,rosters,now,request=get,diagnostics=None):
    diagnostics=diagnostics if diagnostics is not None else {}
    if not fresh(feed,now,6) or not fresh(rosters,now,24):raise RuntimeError('stale_local_inputs')
    diagnostics['provider_phase']='fixtures'
    fixtures=records(request('fixtures',sportId=11,**{'from':now.date().isoformat(),'to':(now+dt.timedelta(days=2)).date().isoformat()}),'fixtures')
    diagnostics['provider_phase']='markets'
    catalog=request('markets',sportId=11)
    diagnostics['provider_phase']='tournaments'
    tournaments=records(request('tournaments',sportId=11),'tournaments')
    nba_ids={str(t.get('tournamentId')) for t in tournaments if str(t.get('tournamentName') or t.get('name') or '').strip().lower() in ('nba','usa nba','usa - nba')}
    diagnostics['basketball_prop_examples']=[{k:m.get(k) for k in ('marketName','period','marketType','playerProp','handicap')} for m in records(catalog,'markets') if str(m.get('sportId'))=='11' and m.get('playerProp') is True][:12]
    diagnostics.update(fixtures=len(fixtures),catalog_markets=len(records(catalog,'markets')),supported_catalog_markets=sum(classify_market(m.get('marketName'),m) is not None for m in records(catalog,'markets')),nba_tournaments=len(nba_ids),fixture_fields=sorted({k for f in fixtures[:1] if isinstance(f,dict) for k in f}),catalog_fields=sorted({k for m in records(catalog,'markets')[:1] if isinstance(m,dict) for k in m}))
    names={}
    for g in sorted(feed.get('games',[]),key=lambda g:g['date'],reverse=True):
        for p in g.get('players',[]):
            pid=str(p.get('id',''))
            if pid in (rosters.get('teams',{}).get(p.get('team')) or []):names.setdefault(pid,p)
    markets=[];matched=0;nba_count=0;priced_markets=0;named_players=0
    for f in fixtures:
        if not isinstance(f,dict) or not f.get('hasOdds') or not f.get('fixtureId'):continue
        if str(f.get('tournamentId')) not in nba_ids and not re.search(r'(^|-)nba($|-)',str(f.get('tournamentSlug','')).lower()) and str(f.get('tournamentName','')).upper()!='NBA':continue
        nba_count+=1
        g=match_fixture(f,feed.get('games',[]))
        if not g or not now<timestamp(g['date'])<=now+dt.timedelta(hours=48):continue
        matched+=1
        diagnostics['provider_phase']='odds'
        response=request('odds',fixtureId=f['fixtureId'],bookmakers='hardrockbet')
        bk=response.get('bookmakerOdds',{}).get('hardrockbet',{})
        priced_markets+=len(bk.get('markets',{}))
        named_players+=sum(bool(p.get('playerName')) for m in bk.get('markets',{}).values() for o in m.get('outcomes',{}).values() for p in o.get('players',{}).values() if isinstance(p,dict))
        markets+=parse_props(g,catalog,response,list(names.values()),now)
    diagnostics.update(nba_fixtures=nba_count,matched_fixtures=matched,book_markets=priced_markets,named_prop_outcomes=named_players,accepted_props=len(markets))
    if not markets:raise RuntimeError('no_supported_active_NBA_props')
    return {'generated_at':now.isoformat(),'status':'ok','source':'OddsPapi / Hard Rock Bet','matched_fixtures':matched,'markets':markets,'sgp_quotes':[],'sgp_quote_status':'Combined SGP quotes unavailable from the prop endpoint; never multiply individual prices.'}

def main(root=ROOT,request=get,now=None):
    now=now or dt.datetime.now(UTC)
    diagnostics={}
    try:
        feed=json.loads((root/'data/nba_games.json').read_text());rosters=json.loads((root/'data/nba_rosters.json').read_text())
        data=collect(feed,rosters,now,request,diagnostics)
        # A separate same-book combined-quote capture can be supplied without re-dating it.
        path=root/'data/nba_sgp_quotes.json'
        if path.exists():
            captures=json.loads(path.read_text())
            for q in captures.get('sgp_quotes',[]):
                stamp=q.get('observed_at',captures.get('generated_at'))
                if fresh({'generated_at':stamp},now,1):data['sgp_quotes'].append({**q,'observed_at':stamp})
        atomic(root/'data/nba_market_odds.json',data)
        status={'generated_at':now.isoformat(),'status':'ok','markets':len(data['markets']),'source':data['source'],'live_price_verified':True}
    except Exception as exc:
        # Provider exceptions may contain a query URL/key. Never print their text.
        message=str(exc)
        code='missing_repository_secret' if message=='Missing ODDSPAPI_API_KEY' else 'provider_authentication' if message in ('Odds provider HTTP 401','Odds provider HTTP 403') else 'provider_rate_limit' if message=='Odds provider HTTP 429' else message if message in ('stale_local_inputs','no_supported_active_NBA_props') else 'provider_unavailable'
        status={'generated_at':now.isoformat(),'status':'unavailable','reason_code':code,'diagnostics':diagnostics,'reason':'NBA odds refresh unavailable; last successful prices retained and freshness-gated.'}
        status['live_price_verified']=False
        if isinstance(exc,ProviderRateLimit):status.update(exc.safe_details())
    atomic(root/'data/nba_market_status.json',status)
    print('NBA odds:',status['status'])
    return status
if __name__=='__main__':main()
