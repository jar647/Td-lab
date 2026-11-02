"""Scheduled NBA analyst, immutable captures and grading. No invented book prices."""
import copy
import datetime as dt
import hashlib
import itertools
import json
import math
import pathlib
import statistics as st
from nba_model import (MODEL, UTC, KEYS, timestamp, fresh, number, completed_history,
                       build_projection, simulate)


def clean(p):
    return {k:v for k,v in p.items() if k not in ('history','rate','draws','coverage')}

def quote_key(q):
    return f"{q['player_id']}:{q['market']}:{q['side']}:{float(q['line'])}"

def price_quote(q,now,default_stamp):
    try:
        line=float(q['line']);american=float(q['american_odds'])
        if not math.isfinite(line) or line<=0 or not math.isfinite(american) or abs(american)<100 or american < -200:return None
        if q['side'] not in ('over','under') or not q.get('bookmaker'):return None
        if not fresh({'generated_at':q.get('observed_at',default_stamp)},now,1):return None
        return line,american,1+(100/abs(american) if american<0 else american/100)
    except (KeyError,ValueError,TypeError):return None

def outcomes(draws,line,side):
    return [0 if x==line else 1 if ((x>line)==(side=='over')) else -1 for x in draws]

def grade_stats(outcomes_,decimal):
    n=len(outcomes_);win=outcomes_.count(1)/n;push=outcomes_.count(0)/n
    return {'probability':win,'push_probability':push,'break_even':1/decimal,
            'estimated_ev':win*(decimal-1)-(1-win-push),'fair_decimal':(1-push)/win if win else None}

def ranked_players(rows):
    seen=set();result=[]
    for p in sorted(rows,key=lambda p:p['estimated_ev'],reverse=True):
        if p['player_id'] in seen:continue
        seen.add(p['player_id']);result.append(clean(p))
    return result

def joint_ticket(legs,runs):
    combined=[];coverage=0
    for j in range(runs):
        vals=[p['outcomes'][j] for p in legs]
        combined.append(-1 if -1 in vals else 1 if all(v==1 for v in vals) else 0)
        coverage+=all(p['coverage'][j] for p in legs)
    return combined,coverage/runs

def analyze(feed,injuries,rosters,odds,now,runs=10000):
    if not isinstance(runs,int) or not 1<=runs<=50000:raise ValueError('Invalid simulation count')
    results=[];history=completed_history(feed,now)
    for game in feed.get('games',[]):
        try:
            if game.get('status')!='STATUS_SCHEDULED' or not now<timestamp(game['date'])<=now+dt.timedelta(hours=48):continue
        except (ValueError,KeyError,TypeError):continue
        blockers=[]
        for data,hours,name in [(feed,6,'box scores'),(injuries,6,'injuries'),(rosters,24,'rosters')]:
            if not fresh(data,now,hours):blockers.append('Missing/stale '+name)
        projections,rotation,starters,teams,model_reasons,environment_sd=build_projection(game,history,injuries,rosters)
        blockers+=model_reasons
        if not projections:blockers.append('No supported player projections')
        draws,coverage=simulate(game,projections,teams,environment_sd,runs)
        lookup={(p['player_id'],p['market']):i for i,p in enumerate(projections)}
        for i,p in enumerate(projections):
            p['projection']=round(st.mean(draws[i]),2)
            p['interval_80']=[sorted(draws[i])[int(.1*(runs-1))],sorted(draws[i])[int(.9*(runs-1))]]
        candidates=[]
        market_fresh=fresh(odds,now,1)
        for q in odds.get('markets',[]) if market_fresh else []:
            if str(q.get('game_id'))!=str(game['id']):continue
            index=lookup.get((str(q.get('player_id')),q.get('market')))
            valid=price_quote(q,now,odds.get('generated_at'))
            if index is None or not valid:continue
            p=projections[index]
            if p['sample']<5 or p['status'] not in ('NOT LISTED','ACTIVE','AVAILABLE','PROBABLE'):continue
            line,american,decimal=valid;settlement=outcomes(draws[index],line,q['side'])
            candidate={**p,'line':line,'side':q['side'],'american_odds':american,'decimal':decimal,'bookmaker':q['bookmaker'],'observed_at':q.get('observed_at',odds['generated_at']),'outcomes':settlement,'coverage':coverage[index],**grade_stats(settlement,decimal)}
            # Explicit opposite price and no-vig comparison; never mix books or lines.
            opposite=next((other for other in odds.get('markets',[]) if str(other.get('game_id'))==str(game['id']) and str(other.get('player_id'))==p['player_id'] and other.get('market')==p['market'] and other.get('side')!=q['side'] and other.get('bookmaker')==q['bookmaker'] and other.get('line')==q.get('line') and price_quote(other,now,odds['generated_at'])),None)
            if opposite:
                opp=price_quote(opposite,now,odds['generated_at'])[2]
                candidate['no_vig_probability']=(1/decimal)/(1/decimal+1/opp)
                candidate['no_vig_edge']=candidate['probability']/max(.001,1-candidate['push_probability'])-candidate['no_vig_probability']
            candidates.append(candidate)
        positives=[p for p in candidates if p['estimated_ev']>.05 and .45<=p['probability']<=.90]
        best_single=ranked_players(positives)[0] if positives and not blockers else None
        best=None
        # Only evaluate offered same-book tickets. No exponential scan or invented prices.
        for q in odds.get('sgp_quotes',[]) if market_fresh and not blockers else []:
            try:
                if str(q['game_id'])!=str(game['id']) or not q.get('bookmaker'):continue
                if not fresh({'generated_at':q.get('observed_at',odds['generated_at'])},now,1):continue
                signatures=q['legs'];decimal=float(q['decimal_odds'])
                if not 2<=len(signatures)<=5 or len(set(signatures))!=len(signatures) or not math.isfinite(decimal) or decimal<=1:continue
                legs=[next((p for p in candidates if quote_key(p)==sig and p['bookmaker']==q['bookmaker']),None) for sig in signatures]
                if any(p is None for p in legs) or len({p['player_id'] for p in legs})!=len(legs):continue
                settled,joint_coverage=joint_ticket(legs,runs)
                prob=settled.count(1)/runs
                # Conservative SGP EV: pushes/voids require book-specific repricing.
                ev=prob*decimal-1
                if joint_coverage<.8 or ev<=.05:continue
                if best is None or ev>best['estimated_ev']:
                    best={'legs':[clean_leg(p) for p in legs],'joint_probability':prob,'joint_observed_coverage':joint_coverage,'decimal_odds':decimal,'estimated_ev':ev,'bookmaker':q['bookmaker'],'observed_at':q.get('observed_at',odds['generated_at'])}
            except (KeyError,TypeError,ValueError):continue
        # An unpriced research ticket is useful, but never masquerades as a bet/EV.
        targets=[]
        for i,p in enumerate(projections):
            if p['market'] not in ('points','rebounds','assists') or p['sample']<5 or p['minutes']<20 or p['status'] not in ('NOT LISTED','ACTIVE','AVAILABLE','PROBABLE'):continue
            ordered=sorted(draws[i]);line=max(.5,math.floor(ordered[int(.30*(runs-1))])-.5)
            settled=outcomes(draws[i],line,'over');prob=settled.count(1)/runs
            if not .55<=prob<=.80:continue
            targets.append({**p,'line':line,'side':'over','probability':prob,'outcomes':settled,'coverage':coverage[i]})
        # Prefer actually offered single-leg markets when a provider is connected.
        offered_targets=[p for p in candidates if p['estimated_ev']>0 and .55<=p['probability']<=.80 and p['minutes']>=20]
        if len({p['player_id'] for p in offered_targets})>=3:targets=offered_targets
        target=None
        if not blockers:
            targets.sort(key=lambda p:(p['sample'],p['minutes'],p['probability']),reverse=True)
            unique=[]
            for p in targets:
                if p['player_id'] not in {x['player_id'] for x in unique}:unique.append(p)
                if len(unique)==8:break
            choices=[]
            for count in range(3,min(5,len(unique))+1):
                for legs in itertools.combinations(unique,count):
                    settled,cov=joint_ticket(legs,runs);prob=settled.count(1)/runs
                    if cov>=.8 and .12<=prob<=.35:choices.append((abs(prob-.20),legs,prob,cov))
            if choices:
                _,legs,prob,cov=min(choices,key=lambda x:x[0])
                target={'legs':[clean_leg(p) for p in legs],'joint_probability':prob,'fair_decimal':1/prob,'minimum_decimal_for_5pct_ev':1.05/prob,'joint_observed_coverage':cov,'status':'UNPRICED RESEARCH TARGET — NOT A BET'}
        notes=[]
        if not market_fresh:notes.append('Missing/stale sportsbook prices')
        if not best:notes.append('No qualifying offered SGP quote')
        status='PASS' if blockers else 'RESEARCH LEAN' if best else 'PRICE REQUIRED' if target else 'PASS'
        results.append({'game_id':str(game['id']),'game':game['away']+' @ '+game['home'],'home':game['home'],'away':game['away'],'tipoff':game['date'],'model':MODEL,'generated_at':now.isoformat(),'status':status,'reasons':blockers+notes,'blockers':blockers,'projections':[clean(p) for p in projections],'rotation':rotation,'starters':starters,'team_context':teams,'sgp':best,'research_ticket':target,'top_players':[clean_leg(p) for p in ranked_players_internal(positives)[:3]] if not blockers else [],'best_single':clean_leg(best_single) if best_single else None,'simulation_runs':runs,'shared_environment_sd':environment_sd,'input_timestamps':{k:v.get('generated_at') for k,v in [('games',feed),('injuries',injuries),('rosters',rosters),('odds',odds)]},'limits':'Uncalibrated research model. Recent rotation estimates, bounded opponent adjustments, shared scoring-environment proxy, heuristic blowout minutes, and observed teammate stat dependence. No confirmed starting-five feed. SGP prices must be actual same-book quotes; unpriced tickets are not bets.'})
    return results

def clean_leg(p):
    return {k:v for k,v in clean(p).items() if k not in ('outcomes',)}

def ranked_players_internal(rows):
    seen=set();result=[]
    for p in sorted(rows,key=lambda p:p['estimated_ev'],reverse=True):
        if p['player_id'] not in seen:seen.add(p['player_id']);result.append(p)
    return result

def atomic(path,data):
    temporary=path.with_suffix('.tmp');temporary.write_text(json.dumps(data,separators=(',',':'),allow_nan=False));temporary.replace(path)

def fingerprint(a):
    payload={k:v for k,v in a.items() if k not in ('generated_at','capture_id','input_timestamps','frozen')}
    def stable(value):
        if isinstance(value,dict):return {k:stable(v) for k,v in value.items() if k!='observed_at'}
        if isinstance(value,list):return [stable(v) for v in value]
        return value
    return hashlib.sha256(json.dumps(stable(payload),sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()

def publish(root,now=None):
    now=now or dt.datetime.now(UTC)
    def read(name,default):
        path=root/'data'/name
        return json.loads(path.read_text()) if path.exists() else default
    feed=read('nba_games.json',{'games':[]})
    analyses=analyze(feed,read('nba_injuries.json',{}),read('nba_rosters.json',{}),read('nba_market_odds.json',{}),now)
    archive=read('nba_pipeline_locks.json',{'snapshots':[]})
    # v1 locks are retained, but never silently re-labeled as v2 predictions.
    seen={s.get('capture_id') for s in archive['snapshots']}
    for a in analyses:
        capture_id=fingerprint(a);a['capture_id']=capture_id
        a['frozen']=capture_id in seen or bool(a['projections'] and not a['blockers'])
        if capture_id not in seen and a['frozen']:
            archive['snapshots'].append({**copy.deepcopy(a),'locked_at':now.isoformat(),'grades':None})
            seen.add(capture_id)
    finals={str(g['id']):g for g in feed['games'] if g.get('status')=='STATUS_FINAL'}
    for lock in archive['snapshots']:
        if lock.get('grades') is not None or str(lock['game_id']) not in finals:continue
        try:
            if timestamp(lock['locked_at'])>=timestamp(lock['tipoff']):continue
        except (KeyError,ValueError,TypeError):continue
        players={str(p['id']):p for p in finals[str(lock['game_id'])].get('players',[])}
        grades=[]
        for p in lock['projections']:
            pl=players.get(p['player_id']);keys=KEYS.get(p['market'],())
            values=[number(pl,k) for k in keys]
            dnp=bool(pl and (pl.get('didNotPlay') or number(pl,'MIN')==0))
            actual=sum(values) if keys and all(v is not None for v in values) and not dnp else None
            grades.append({'player_id':p['player_id'],'market':p['market'],'actual':actual,'absolute_error':abs(actual-p['projection']) if actual is not None else None,'status':'DNP' if dnp else 'graded' if actual is not None else 'ungraded'})
        # Missing final rows can be repaired later without rewriting a prediction.
        if any(x['status']=='ungraded' for x in grades):continue
        lock['grades']=grades;lock['graded_at']=now.isoformat()
        lock['minute_grades']=[]
        for player in lock.get('rotation',[]):
            pl=players.get(player['player_id']);actual=number(pl,'MIN')
            lock['minute_grades'].append({'player_id':player['player_id'],'projection':player['minutes'],'actual':actual,'absolute_error':abs(actual-player['minutes']) if actual is not None and not pl.get('didNotPlay') else None})
        actuals={(x['player_id'],x['market']):x for x in grades}
        if lock.get('best_single'):
            single=lock['best_single'];record=actuals.get((single['player_id'],single['market']),{});val=record.get('actual')
            state='void' if val is None else 'push' if val==single['line'] else 'win' if (val>single['line'])==(single['side']=='over') else 'loss'
            lock['single_grade']={'result':state,'actual':val,'unit_return':single['decimal']-1 if state=='win' else -1 if state=='loss' else 0}
        if lock.get('sgp'):
            outcomes_=[]
            for leg in lock['sgp']['legs']:
                record=actuals.get((leg['player_id'],leg['market']),{});actual=record.get('actual')
                outcomes_.append('void' if actual is None else 'push' if actual==leg['line'] else 'win' if (actual>leg['line'])==(leg['side']=='over') else 'loss')
            lock['sgp_grade']={'legs':outcomes_,'result':'loss' if 'loss' in outcomes_ else 'win' if all(x=='win' for x in outcomes_) else 'unsettled/void; check book rules'}
    # Evaluation uses one final pregame capture per game/model, not every revision.
    final_captures={}
    for s in archive['snapshots']:
        if s.get('model')!=MODEL or s.get('grades') is None:continue
        key=(s['game_id'],s['model'])
        if key not in final_captures or s['locked_at']>final_captures[key]['locked_at']:final_captures[key]=s
    graded=[g for s in final_captures.values() for g in s['grades'] if g['status']=='graded']
    minute_errors=[m['absolute_error'] for s in final_captures.values() for m in s.get('minute_grades',[]) if m['absolute_error'] is not None]
    report={'minutes_mae':st.mean(minute_errors) if minute_errors else None,'model':MODEL,'captures':len([s for s in archive['snapshots'] if s.get('model')==MODEL]),'graded_games':len(final_captures),'graded_projections':len(graded),'mae':st.mean(x['absolute_error'] for x in graded) if graded else None,'method':'One latest valid pregame capture per game/model. Projection MAE is not bet win rate.'}
    for name,data in [('nba_analysis.json',{'generated_at':now.isoformat(),'model':MODEL,'games':analyses,'audit':report}),('nba_pipeline_locks.json',archive)]:atomic(root/'data'/name,data)
    return analyses
if __name__=='__main__':publish(pathlib.Path(__file__).resolve().parent)
