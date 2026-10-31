/* Free BoxScore Lab season totals; never label these as tracking opportunities. */
window.CookNBAFreeStats={
render(feed,id,esc){
 const row=feed?.players?.[String(id)];if(!row)return '';
 const s=row.stats||{};const fmt=v=>Number.isFinite(Number(v))?Number(v).toFixed(1):'N/A';
 const gp=Number(s.games),per=k=>gp>0?fmt(Number(s[k])/gp):'N/A';
 return '<p class="muted"><strong>Free season data · BoxScore Lab</strong> (CC BY 4.0) · PTS/G '+per('points')+' · REB/G '+per('rebounds')+' · AST/G '+per('assists')+' · Usage '+fmt(s.usage_rate)+' · Assist share '+fmt(s.assist_share)+'<br><small>Season averages, not potential assists or rebound chances. <a href="https://boxscorelab.com/downloads/" target="_blank" rel="noopener">Source</a></small></p>';
}
};
