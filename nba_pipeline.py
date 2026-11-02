"""Published NBA research pipeline. No fabricated prices or retrospective locks."""
import datetime as dt
import itertools
import json
import math
import pathlib
import random
import statistics as st

MODEL = 'nba-joint-bootstrap-v1'
UTC = dt.timezone.utc
KEYS = {'points': 'PTS', 'rebounds': 'REB', 'assists': 'AST'}
def timestamp(value):
    return dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
def fresh(data, now, hours):
    try:
        age = (now-timestamp(data['generated_at'])).total_seconds()
        return 0 <= age <= hours*3600
    except (KeyError, ValueError, TypeError):
        return False

def number(player, key):
    raw = player.get('stats', {}).get(key)
    if key == 'MIN' and ':' in str(raw):
        m, s = map(float, raw.split(':'))
        return m+s/60
    try:
        n = float(raw)
        return n if math.isfinite(n) else None
    except (ValueError, TypeError):
        return None

def analyze(feed, injuries, rosters, odds, now, runs=10000):
    results = []
    history = sorted([g for g in feed['games'] if g['status']=='STATUS_FINAL' and timestamp(g['date']) < now], key=lambda g:g['date'], reverse=True)
    for game in feed['games']:
        if game['status'] != 'STATUS_SCHEDULED' or not now < timestamp(game['date']) <= now+dt.timedelta(hours=48):
            continue
        reasons = []
        for data, hours, name in [(feed,6,'box scores'),(injuries,6,'injuries'),(rosters,24,'rosters')]:
            if not fresh(data,now,hours): reasons.append('Missing/stale '+name)
        rows = {}
        for h in history:
            for p in h['players']:
                pid = str(p.get('id',''))
                if h.get('season_type',2)!=2 or p.get('team') not in (game['home'],game['away']) or p.get('didNotPlay') or not number(p,'MIN'): continue
                if pid not in rosters.get('teams',{}).get(p['team'],[]): continue
                rows.setdefault(pid,[]).append((h,p))
        projections = []
        injury_map = {x.get('player','').casefold():str(x.get('status','')).upper() for x in injuries.get('injuries',[])}
        for pid, samples in rows.items():
            samples = samples[:10]
            if len(samples)<5: continue
            player=samples[0][1]
            status=injury_map.get(player['name'].casefold(),'NOT LISTED')
            if any(x in status for x in ['OUT','DOUBTFUL','INACTIVE','SUSPEND']): continue
            minutes=st.mean(number(p,'MIN') for _,p in samples[:5])
            if minutes<15: continue
            opponent=game['away'] if player['team']==game['home'] else game['home']
            own=[h for h in history if player['team'] in (h['home'],h['away'])]
            rest=(timestamp(game['date'])-timestamp(own[0]['date'])).total_seconds()/86400 if own else None
            minutes*=.97 if rest is not None and rest<1.3 else 1
            for market,key in KEYS.items():
                usable=[(h,p) for h,p in samples if number(p,key) is not None]
                if len(usable)<5: continue
                allowance=[]; league=[]
                for h in history:
                    for defense,offense in [(h['home'],h['away']),(h['away'],h['home'])]:
                        total=sum(number(p,key) or 0 for p in h['players'] if p['team']==offense)
                        if total>0:
                            league.append(total)
                            if defense==opponent: allowance.append(total)
                factor=1
                if allowance and league:
                    factor+=max(-.15,min(.15,st.mean(allowance)/st.mean(league)-1))*len(allowance)/(len(allowance)+12)
                rate=st.mean(number(p,key)/number(p,'MIN') for _,p in usable)
                projections.append(dict(player_id=pid,player=player['name'],team=player['team'],market=market,minutes=round(minutes,2),projection=round(rate*minutes*factor,2),status=status,sample=len(usable),opponent=opponent,defense_factor=factor,rest_days=rest,history={h['id']:number(p,key)/number(p,'MIN')*minutes*factor for h,p in usable}))
        # A missing teammate's role cannot be inferred safely from box scores alone.
        # Hold the game when a current rotation player has unresolved availability.
        for pid,samples in rows.items():
            player=samples[0][1]
            status=injury_map.get(player['name'].casefold(),'NOT LISTED')
            if any(x in status for x in ['QUESTION','DAY-TO-DAY','GAME TIME']) and st.mean(number(p,'MIN') for _,p in samples[:5])>=20:
                reasons.append('Unresolved rotation availability: '+player['name'])
        candidates=[]
        market_fresh=fresh(odds,now,1)
        for quote in odds.get('markets',[]) if market_fresh else []:
            if str(quote.get('game_id'))!=str(game['id']): continue
            p=next((p for p in projections if p['player_id']==str(quote.get('player_id')) and p['market']==quote.get('market')),None)
            try:
                line=float(quote['line']); price=float(quote['american_odds'])
                if line<=0 or not math.isfinite(line) or not math.isfinite(price) or abs(price)<100 or price < -200 or quote.get('side') not in ('over','under'): continue
            except (KeyError,ValueError,TypeError): continue
            if not p or p['status']!='NOT LISTED': continue
            candidates.append({**p,'line':line,'american_odds':price,'side':quote['side'],'decimal':1+(100/abs(price) if price<0 else price/100)})
        if not market_fresh: reasons.append('Missing/stale sportsbook prices')
        rng=random.Random(str(game['id'])+MODEL)
        # Same historical team-game index preserves observed teammate and stat dependence.
        team_ids={team:sorted({hid for p in projections if p['team']==team for hid in p['history']}) for team in (game['home'],game['away'])}
        eligible=[]
        for p in candidates:
            if len(p['history'])>=5: eligible.append(p)
        eligible=eligible[:18]
        hits=[0]*len(eligible); masks=[]
        for _ in range(runs):
            selected={team:rng.choice(ids) for team,ids in team_ids.items() if ids}
            mask=0
            for i,p in enumerate(eligible):
                # Reject incomplete joint rows rather than impute independent samples.
                value=p['history'].get(selected.get(p['team']))
                hit=value is not None and (value>p['line'] if p['side']=='over' else value<p['line'])
                if hit: mask|=1<<i;hits[i]+=1
            masks.append(mask)
        singles=[]
        for i,p in enumerate(eligible):
            probability=hits[i]/runs
            singles.append({**{k:v for k,v in p.items() if k!='history'},'probability':probability,'break_even':1/p['decimal'],'estimated_ev':probability*p['decimal']-1})
        singles.sort(key=lambda p:p['estimated_ev'],reverse=True)
        best=None
        for size in range(2,min(5,len(eligible))+1):
            for indices in itertools.combinations(range(len(eligible)),size):
                legs=[eligible[i] for i in indices]
                if len({p['player_id'] for p in legs})<size: continue
                target=sum(1<<i for i in indices)
                probability=sum((m&target)==target for m in masks)/runs
                # Product prices are never used as an SGP quote: require actual combined price.
                signature=sorted(f"{p['player_id']}:{p['market']}:{p['side']}:{p['line']}" for p in legs)
                q=next((q for q in odds.get('sgp_quotes',[]) if str(q.get('game_id'))==str(game['id']) and sorted(q.get('legs',[]))==signature),None)
                if not q: continue
                try: decimal=float(q['decimal_odds'])
                except (KeyError,TypeError,ValueError): continue
                if not math.isfinite(decimal) or decimal<=1: continue
                ev=probability*decimal-1
                if probability>0 and ev>.05 and (best is None or ev>best['estimated_ev']):
                    best={'legs':[{k:v for k,v in p.items() if k!='history'} for p in legs],'joint_probability':probability,'decimal_odds':decimal,'estimated_ev':ev}
        if not best: reasons.append('No supported positive-edge SGP with an actual combined quote')
        results.append({'game_id':game['id'],'tipoff':game['date'],'model':MODEL,'generated_at':now.isoformat(),'status':'PASS' if reasons else 'RESEARCH LEAN','reasons':reasons,'projections':[{k:v for k,v in p.items() if k!='history'} for p in projections],'sgp':best if not reasons else None,'top_players':singles[:3] if not reasons else [],'best_single':singles[0] if singles and singles[0]['estimated_ev']>.05 and not any('stale' in r or 'availability' in r for r in reasons) else None,'simulation_runs':runs,'limits':'Uncalibrated joint team-game bootstrap; cross-team dependence and future rotation changes are not established.'})
    return results

def publish(root,now=None):
    now=now or dt.datetime.now(UTC)
    def read(name, default):
        path=root/'data'/name
        return json.loads(path.read_text()) if path.exists() else default
    feed=read('nba_games.json',{'games':[]})
    analyses=analyze(feed,read('nba_injuries.json',{}),read('nba_rosters.json',{}),read('nba_market_odds.json',{}),now)
    archive=read('nba_pipeline_locks.json',{'snapshots':[]})
    seen={x['game_id'] for x in archive['snapshots']}
    for a in analyses:
        if a['game_id'] not in seen and a['projections'] and not any('stale' in r for r in a['reasons'] if 'prices' not in r):
            archive['snapshots'].append({**a,'locked_at':now.isoformat(),'grades':None})
    finals={g['id']:g for g in feed['games'] if g['status']=='STATUS_FINAL'}
    for lock in archive['snapshots']:
        if lock.get('grades') is not None or lock['game_id'] not in finals: continue
        players={str(p['id']):p for p in finals[lock['game_id']]['players']}
        grades=[]
        for p in lock['projections']:
            actual_player=players.get(p['player_id']); actual=number(actual_player,KEYS[p['market']]) if actual_player else None
            grades.append({'player_id':p['player_id'],'market':p['market'],'actual':actual,'absolute_error':abs(actual-p['projection']) if actual is not None else None,'status':'DNP' if actual_player and actual_player.get('didNotPlay') else 'graded' if actual is not None else 'ungraded'})
        lock['grades']=grades
        if lock.get('sgp'):
            outcomes=[]
            for leg in lock['sgp']['legs']:
                pl=players.get(leg['player_id']); val=number(pl,KEYS[leg['market']]) if pl else None
                outcomes.append('void' if val is None or pl.get('didNotPlay') else 'push' if val==leg['line'] else 'win' if (val>leg['line'])==(leg['side']=='over') else 'loss')
            lock['sgp_grade']={'legs':outcomes,'result':'loss' if 'loss' in outcomes else 'win' if all(x=='win' for x in outcomes) else 'unsettled/void; check book rules'}
    for name,data in [('nba_analysis.json',{'generated_at':now.isoformat(),'games':analyses}),('nba_pipeline_locks.json',archive)]:
        path=root/'data'/name; temp=path.with_suffix('.tmp');temp.write_text(json.dumps(data,separators=(',',':')));temp.replace(path)
if __name__=='__main__': publish(pathlib.Path(__file__).resolve().parent)
