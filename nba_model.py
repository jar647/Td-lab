"""Pure, deterministic NBA rotation/projection and correlated-scenario model.

Box-score scoring environment is a pace proxy, not measured possessions.
All adjustments are explicit heuristics; no calibration or betting-edge claim.
"""
import datetime as dt
import math
import random
import re
import statistics as st
import unicodedata

MODEL = 'nba-rotation-joint-v2.1'
UTC = dt.timezone.utc
KEYS = {'points': ('PTS',), 'rebounds': ('REB',), 'assists': ('AST',),
        'points_rebounds': ('PTS','REB'), 'points_assists': ('PTS','AST'),
        'rebounds_assists': ('REB','AST'), 'pra': ('PTS','REB','AST')}

def timestamp(value):
    result=dt.datetime.fromisoformat(str(value).replace('Z','+00:00'))
    if result.tzinfo is None: raise ValueError('Timestamp requires timezone')
    return result

def fresh(data, now, hours):
    try:
        age=(now-timestamp(data['generated_at'])).total_seconds()
        return 0<=age<=hours*3600 and data.get('status','ok')=='ok'
    except (KeyError,ValueError,TypeError): return False

def number(player,key):
    raw=(player or {}).get('stats',{}).get(key)
    try:
        if key=='MIN' and ':' in str(raw):
            m,s=map(float,str(raw).split(':'));raw=m+s/60
        value=float(raw)
        return value if math.isfinite(value) and value>=0 else None
    except (ValueError,TypeError): return None

def name_key(value):
    parts=str(value).split(',')
    if len(parts)==2: value=parts[1]+' '+parts[0]
    value=unicodedata.normalize('NFKD',str(value)).encode('ascii','ignore').decode().lower()
    return re.sub(r'\b(jr|sr|ii|iii|iv)\b','',re.sub(r'[^a-z0-9 ]','',value)).strip()

def availability(player,injuries):
    matches=[x for x in injuries.get('injuries',[]) if
             (x.get('player_id') and str(x['player_id'])==str(player.get('id'))) or
             (name_key(x.get('player',''))==name_key(player.get('name','')) and
              (not x.get('team') or x['team']==player.get('team')))]
    status=str(matches[0].get('status','UNKNOWN')).upper() if len(matches)==1 else 'UNKNOWN' if matches else 'NOT LISTED'
    if re.search(r'\b(OUT|DOUBTFUL|INACTIVE|SUSPENDED)\b',status): return status,False,False
    return status,True,status not in ('NOT LISTED','ACTIVE','AVAILABLE','PROBABLE')

def allocate_minutes(weights,total=240,cap=40):
    """Water-fill available rotation weights; never invent minutes above cap."""
    if len(weights)*cap<total: return None
    result={p:0.0 for p in weights};remaining=set(weights);budget=float(total)
    while remaining:
        denom=sum(weights[p] for p in remaining)
        if denom<=0: return None
        capped=[p for p in remaining if budget*weights[p]/denom>cap]
        if not capped:
            for p in remaining: result[p]=budget*weights[p]/denom
            break
        for p in capped:result[p]=float(cap);budget-=cap;remaining.remove(p)
    return result

def completed_history(feed,now):
    season=dt.datetime(now.year-(now.month<10),10,1,tzinfo=UTC)
    result=[]
    for g in feed.get('games',[]):
        try:
            if g.get('status')=='STATUS_FINAL' and g.get('season_type')==2 and season<=timestamp(g['date'])<now:
                result.append(g)
        except (KeyError,ValueError,TypeError):continue
    return sorted(result,key=lambda g:timestamp(g['date']),reverse=True)

def build_projection(game,history,injuries,rosters):
    reasons=[];profiles=[];projections=[];team_info={}
    totals=[]
    for h in history:
        score=sum(number(p,'PTS') or 0 for p in h.get('players',[]) if not p.get('didNotPlay'))
        if score>=130:totals.append(score)
    environment_sd=min(.06,max(.02,st.pstdev(totals)/st.mean(totals)*.4)) if len(totals)>2 else .04
    for team in (game['home'],game['away']):
        opponent=game['away'] if team==game['home'] else game['home']
        ids=rosters.get('teams',{}).get(team) or []
        team_games=[h for h in history if team in (h['home'],h['away'])][:10]
        observed={}
        for h in team_games:
            for p in h.get('players',[]):
                pid=str(p.get('id',''))
                if p.get('team')==team and pid in ids and not p.get('didNotPlay') and (number(p,'MIN') or 0)>0:
                    observed.setdefault(pid,[]).append((h,p))
        active={};absences=[];uncertain=[]
        rest=(timestamp(game['date'])-timestamp(team_games[0]['date'])).total_seconds()/86400 if team_games else None
        for pid,rows in observed.items():
            player=rows[0][1];status,available,pending=availability(player,injuries)
            baseline=st.mean(number(p,'MIN') for _,p in rows[:5])
            if not available:
                if baseline>=15:absences.append(player['name'])
                continue
            if len(rows)<3 or baseline<5:continue
            # Recent appearances, not a fake confirmed rotation. Cap absence redistribution.
            weight=.6*st.mean(number(p,'MIN') for _,p in rows[:3])+.4*baseline
            if rest is not None and rest<1.3 and baseline>=30:weight*=.97
            active[pid]={'rows':rows,'player':player,'status':status,'baseline':baseline,'weight':weight}
            if pending and baseline>=15:uncertain.append(player['name'])
        minutes=allocate_minutes({pid:x['weight'] for pid,x in active.items()})
        if minutes is None:
            reasons.append('Insufficient rotation evidence: '+team)
            minutes={pid:min(40,x['weight']) for pid,x in active.items()}
        if any(minutes[pid]>max(12,x['baseline']*1.35) for pid,x in active.items()):
            reasons.append('Large unverified rotation change: '+team)
        if uncertain:reasons.append('Unresolved rotation availability: '+', '.join(uncertain))
        scoring=[];allowed={key:[] for key in KEYS};league={key:[] for key in KEYS}
        for h in history:
            for defense,offense in [(h['home'],h['away']),(h['away'],h['home'])]:
                ps=[p for p in h.get('players',[]) if p['team']==offense and not p.get('didNotPlay')]
                for market,keys in KEYS.items():
                    val=sum(sum(number(p,k) or 0 for k in keys) for p in ps)
                    if val>0:
                        league[market].append(val)
                        if defense==opponent:allowed[market].append(val)
            if team in (h['home'],h['away']):
                scoring.append(sum(number(p,'PTS') or 0 for p in h.get('players',[]) if p['team']==team))
        for pid,x in active.items():
            player=x['player'];rows=x['rows'];mins=minutes[pid]
            starts=sum(bool(p.get('starter')) for _,p in rows[:5])
            profiles.append({'player_id':pid,'player':player['name'],'team':team,'minutes':round(mins,2),'status':x['status'],'starts_last5':starts,'sample':len(rows),'baseline_minutes':round(x['baseline'],2)})
            for market,keys in KEYS.items():
                usable=[(h,p) for h,p in rows if (number(p,'MIN') or 0)>=5 and all(number(p,k) is not None for k in keys)]
                if len(usable)<3:continue
                raw={h['id']:sum(number(p,k) for k in keys)/number(p,'MIN') for h,p in usable}
                rate=.6*st.mean(list(raw.values())[:3])+.4*st.mean(raw.values())
                allowance=allowed[market];factor=1.0
                if allowance and league[market]:
                    factor+=max(-.15,min(.15,st.mean(allowance)/st.mean(league[market])-1))*len(allowance)/(len(allowance)+12)
                projections.append({'player_id':pid,'player':player['name'],'team':team,'market':market,'minutes':round(mins,2),'projection':round(rate*mins*factor,2),'status':x['status'],'sample':len(usable),'opponent':opponent,'defense_factor':factor,'rest_days':rest,'history':raw,'rate':rate,'reason':f'{mins:.1f} projected minutes; {len(usable)} prior appearances; opponent adjustment {(factor-1)*100:+.1f}%; absent rotation: '+(', '.join(absences) or 'none listed')})
        team_info[team]={'rest_days':rest,'absences':absences,'uncertain':uncertain,'rotation_minutes':round(sum(minutes.values()),2),'games':len(team_games),'projected_points':round(sum(p['projection'] for p in projections if p['team']==team and p['market']=='points'),2)}
        if len(team_games)<5:reasons.append('Limited team sample: '+team)
    starters={team:sorted([p for p in profiles if p['team']==team],key=lambda p:(p['starts_last5'],p['minutes']),reverse=True)[:5] for team in (game['home'],game['away'])}
    return projections,profiles,starters,team_info,list(dict.fromkeys(reasons)),environment_sd

def simulate(game,projections,team_info,environment_sd,runs=10000):
    """Shared environment + team-game resampling + common blowout minutes.

Unobserved player/team-game rows use their empirical rate fallback, tracked
as coverage rather than counted as a losing outcome. Reject thin joint coverage.
"""
    rng=random.Random(str(game['id'])+MODEL)
    centers=[st.mean(p['history'].values()) for p in projections]
    base_indices={(p['player_id'],p['market']):i for i,p in enumerate(projections)}
    allocations={}
    for blow in (False,True):
        allocation={}
        for t in (game['home'],game['away']):
            roster={p['player_id']:p['minutes'] for p in projections if p['team']==t}
            weights={pid:m*(.88 if blow and m>=28 else 1.08 if blow else 1) for pid,m in roster.items()}
            allocation.update(allocate_minutes(weights) or roster)
        allocations[blow]=allocation
    team_ids={t:sorted({hid for p in projections if p['team']==t for hid in p['history']}) for t in (game['home'],game['away'])}
    results=[[] for _ in projections];covered=[[] for _ in projections]
    gap=team_info[game['home']]['projected_points']-team_info[game['away']]['projected_points']
    profile_minutes={p['player_id']:p['minutes'] for p in projections}
    for _ in range(runs):
        tempo=max(.85,min(1.15,rng.gauss(1,environment_sd)))
        margin=rng.gauss(gap,12)
        blowout=abs(margin)>20
        sampled={t:rng.choice(ids) for t,ids in team_ids.items() if ids}
        minute_factors=allocations[blowout]
        # One rate fallback draw per player, shared by that player's stat markets.
        fallback={pid:rng.random() for pid in profile_minutes}
        for i,p in enumerate(projections):
            if len(KEYS[p['market']])>1:
                component_names={'PTS':'points','REB':'rebounds','AST':'assists'}
                indices=[base_indices.get((p['player_id'],component_names[k])) for k in KEYS[p['market']]]
                if all(j is not None for j in indices):
                    results[i].append(sum(results[j][-1] for j in indices))
                    covered[i].append(all(covered[j][-1] for j in indices))
                    continue
            observed=sampled.get(p['team']) in p['history'];covered[i].append(observed)
            rates=list(p['history'].values());rate=p['history'].get(sampled.get(p['team']))
            if rate is None:rate=rates[min(len(rates)-1,int(fallback[p['player_id']]*len(rates)))]
            # Recenter the bootstrap on the published per-minute forecast.
            center=centers[i]
            value=max(0,round(rate* p['rate']/max(.01,center)*minute_factors[p['player_id']]*p['defense_factor']*tempo))
            results[i].append(value)
    return results,covered
