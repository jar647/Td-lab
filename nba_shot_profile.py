"""Distance buckets from ESPN play descriptions, with box-score coverage checks.
Not optical tracking, court coordinates, or position-specific defensive assignments.
"""
import re

def extract_shot_profile(detail):
    teams={str(t.get('team',{}).get('id')):t.get('team',{}).get('displayName') for t in detail.get('boxscore',{}).get('players',[])}
    player_team={};expected={};first=(detail.get('plays') or [{}])[0]
    if first.get('period',{}).get('number')!=1 or first.get('clock',{}).get('displayValue')!='12:00':return {'available':False,'reason':'Complete opening sequence unavailable'}
    for t in detail.get('boxscore',{}).get('players',[]):
        team=t.get('team',{}).get('displayName');expected[team]=0
        for group in t.get('statistics',[]):
            for athlete in group.get('athletes',[]):
                pid=str(athlete.get('athlete',{}).get('id',''));player_team[pid]=team
                if athlete.get('didNotPlay'):continue
                stats=dict(zip(group.get('labels',[]),athlete.get('stats',[])))
                try:expected[team]+=int(str(stats['FG']).split('-')[1])
                except (KeyError,ValueError,IndexError):return {'available':False,'reason':'Team shooting denominator unavailable'}
    buckets={};players={};seen=set()
    def empty():return {z:{'attempts':0,'made':0} for z in ('rim','two_other','three')}
    for play in detail.get('plays',[]):
        text=str(play.get('text','')).lower();pid=str(((play.get('participants') or [{}])[0].get('athlete') or {}).get('id',''));team=teams.get(str(play.get('team',{}).get('id'))) or player_team.get(pid)
        ident=str(play.get('id',''))
        if not ident or ident in seen or not play.get('shootingPlay') or 'free throw' in text or not team or not pid:continue
        seen.add(ident)
        if not re.search(r'\b(makes|misses)\b',text):continue
        distance=re.search(r'(\d+)-foot',text)
        if 'three point' in text or '3-point' in text or play.get('scoreValue')==3:zone='three'
        elif distance:
            if int(distance.group(1))>22:continue
            zone='rim' if int(distance.group(1))<=4 else 'two_other'
        elif 'layup' in text or 'dunk' in text:zone='rim'
        else:continue
        for b in (buckets.setdefault(team,empty()),players.setdefault(pid,empty())):
            b[zone]['attempts']+=1;b[zone]['made']+=int(' makes ' in ' '+text+' ')
    coverage={team:sum(z['attempts'] for z in buckets.get(team,{}).values())/n if n else 0 for team,n in expected.items()}
    if len(coverage)!=2 or any(not .8<=c<=1.02 for c in coverage.values()):return {'available':False,'reason':'Shot-description coverage below 80% or inconsistent with box FGA','coverage':coverage}
    return {'available':True,'definition':'Close/rim: explicit <=4 feet or an undistanced layup/dunk; other two-pointers; threes. ESPN shot-description categories, not tracking coordinates.','teams':buckets,'players':players,'coverage':coverage}
