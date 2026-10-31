/* Free BoxScore Lab season totals; never label these as tracking opportunities. */
window.CookNBAFreeStats={
render(feed,id,esc){
 const row=feed?.players?.[String(id)];if(!row)return '';
 const s=row.stats||{};const fmt=v=>Number.isFinite(Number(v))?Number(v).toFixed(1):'N/A';
 const gp=Number(s.games),per=k=>gp>0?fmt(Number(s[k])/gp):'N/A';
 return '<p class="muted"><strong>Free season data · BoxScore Lab</strong> (CC BY 4.0) · Season PTS '+fmt(s.points)+' · REB '+fmt(s.rebounds)+' · AST '+fmt(s.assists)+' · Usage '+(Number.isFinite(Number(s.usage_rate))?fmt(Number(s.usage_rate)*100)+'%':'N/A')+' · Assist share '+(Number.isFinite(Number(s.assist_share))?fmt(Number(s.assist_share)*100)+'%':'N/A')+'<br><small>Season totals (games played unavailable), not per-game averages or tracking opportunities. <a href="https://boxscorelab.com/downloads/" target="_blank" rel="noopener">Source</a></small></p>';
}
};
