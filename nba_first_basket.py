"""Extract first made FIELD GOALS from complete ESPN opening play-by-play."""
import math

def extract_first_baskets(detail):
    plays=detail.get('plays') or []
    def order(p):
        try:return float(p['sequenceNumber'])
        except (ValueError,TypeError,KeyError):return math.inf
    plays=sorted(plays,key=order)
    if not plays or any(not math.isfinite(order(p)) for p in plays):
        return {'available':False,'reason':'Opening play-by-play sequence unavailable'}
    first=plays[0]
    if first.get('period',{}).get('number')!=1 or first.get('clock',{}).get('displayValue')!='12:00' or first.get('homeScore')!=0 or first.get('awayScore')!=0:
        return {'available':False,'reason':'Complete opening sequence not verified'}
    identities={str(p['athlete']['id']):str(t.get('team',{}).get('displayName',''))
                for t in detail.get('boxscore',{}).get('players',[]) for group in t.get('statistics',[])
                for p in group.get('athletes',[]) if p.get('athlete',{}).get('id')}
    first_by_team={}; opening=None
    for p in plays:
        if not p.get('scoringPlay') or p.get('scoreValue') not in (2,3) or not p.get('shootingPlay'):
            continue
        if 'free throw' in str(p.get('type',{}).get('text','')).lower():continue
        participants=p.get('participants') or []
        pid=str(participants[0].get('athlete',{}).get('id','')) if participants else ''
        team=identities.get(pid)
        if not team:return {'available':False,'reason':'First field-goal scorer identity could not be verified'}
        result={'player_id':pid,'team':team,'play_id':str(p.get('id','')),
                'period':p.get('period',{}).get('number'),'clock':p.get('clock',{}).get('displayValue')}
        if opening is None:opening=result
        first_by_team.setdefault(team,result)
        if len(first_by_team)==2:break
    if opening is None or len(first_by_team)!=2:
        return {'available':False,'reason':'First field goals for both teams unavailable'}
    return {'available':True,'definition':'First made field goal; free throws excluded',
            'first_game':opening,'first_by_team':first_by_team}
