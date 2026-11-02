"""Reconstruct quarter rotations only when substitutions reconcile to box minutes."""
import re

def extract_rotation_profile(detail):
    ids={};expected={};starts={};quarter={};minutes={}
    def missing(reason):return {'available':False,'reason':reason}
    for t in detail.get('boxscore',{}).get('players',[]):
        team=str(t.get('team',{}).get('id'));starts[team]=set()
        for group in t.get('statistics',[]):
            for p in group.get('athletes',[]):
                pid=str(p.get('athlete',{}).get('id'));ids[pid]=team;quarter[pid]=[0,0,0,0];minutes[pid]=0
                if p.get('didNotPlay'):expected[pid]=0;continue
                stats=dict(zip(group.get('labels',[]),p.get('stats',[])))
                try:
                    raw=str(stats['MIN']);expected[pid]=float(raw.split(':')[0])+float(raw.split(':')[1])/60 if ':' in raw else float(raw)
                except (KeyError,ValueError):return missing('Missing player minutes')
                if p.get('starter'):starts[team].add(pid)
    if len(starts)!=2 or any(len(x)!=5 for x in starts.values()):return missing('Five verified starters required')
    grouped={};seen=set()
    for p in detail.get('plays',[]):
        ident=p.get('id');q=p.get('period',{}).get('number');raw=p.get('clock',{}).get('displayValue','')
        if not ident or ident in seen or not q:continue
        seen.add(ident)
        try:
            clock=sum(float(x)*m for x,m in zip(raw.split(':')[::-1],[1,60]))/60
            if clock<0 or clock>(12 if q<=4 else 5):return missing('Invalid clock')
        except (ValueError,TypeError):continue
        grouped.setdefault(q,[]).append((clock,p))
    if any(q not in grouped for q in range(1,5)):return missing('Missing quarter')
    subs=0
    for q,plays in sorted(grouped.items()):
        duration=12 if q<=4 else 5
        if plays[0][0]!=duration or plays[-1][0]!=0:return missing('Quarter boundary sequence incomplete')
        on={team:set(ps) for team,ps in starts.items()} if q==1 else {team:set() for team in starts}
        if q>1:
            # First observed entry => initially off; first exit/action => initially on.
            observed=set()
            for _,p in plays:
                ps=[str(x.get('athlete',{}).get('id')) for x in p.get('participants',[])]
                substitution=' enters the game for ' in p.get('text','')
                for i,pid in enumerate(ps):
                    if pid in observed or pid not in ids:continue
                    observed.add(pid)
                    if not substitution or i==1:on[ids[pid]].add(pid)
            if any(len(x)!=5 for x in on.values()):return missing('Quarter starting five cannot be reconstructed')
        last=duration
        for clock,p in plays:
            if clock>last+1e-6:return missing('Out-of-order clock')
            for players in on.values():
                for pid in players:
                    dt=last-clock;minutes[pid]+=dt
                    if q<=4:quarter[pid][q-1]+=dt
            last=clock
            if ' enters the game for ' in p.get('text',''):
                ps=[str(x.get('athlete',{}).get('id')) for x in p.get('participants',[])]
                if len(ps)!=2:return missing('Ambiguous substitution')
                entering,leaving=ps;team=ids.get(entering)
                if not team or ids.get(leaving)!=team or entering in on[team] or leaving not in on[team]:return missing('Substitution sequence incomplete')
                on[team].remove(leaving);on[team].add(entering);subs+=1
    if subs<10 or any(abs(minutes.get(pid,0)-value)>1.1 for pid,value in expected.items()):return missing('Reconstructed minutes disagree with box score')
    return {'available':True,'players':{pid:{'quarters':qs,'minutes':minutes[pid]} for pid,qs in quarter.items()},'substitutions':subs,'definition':'Substitutions and observed quarter starting fives reconciled to box minutes within 1.1 minutes/player.'}
