'use strict';
/* לוח בקרה: סיכומים, גרפים, תובנות, הוצאות קבועות ותחזית */

const Dash = {
  charts: [],
  css: (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
  destroy() { Dash.charts.forEach((c) => c.destroy()); Dash.charts = []; },
  pct(cur, prev) { if (!prev) return null; return Math.round(((cur - prev) / prev) * 100); },
  // שורת השוואה: עלייה בהוצאות היא "רע", ירידה "טוב"
  compare(label, cur, prev, moreIsBad = true) {
    const p = Dash.pct(cur, prev); if (p === null) return `<div class="caption">${label}: אין נתונים</div>`;
    const up = p > 0; const cls = p === 0 ? '' : up === moreIsBad ? 'over' : 'ok';
    return `<div class="caption">${label}: <span class="${cls}">${UI.icon(up ? 'trending-up' : p < 0 ? 'trending-down' : 'minus')} <span class="num">${Math.abs(p)}%</span> ${up ? 'יותר' : p < 0 ? 'פחות' : 'ללא שינוי'}</span> (${U.money(prev)})</div>`;
  },
};

Views.dashboard = (main) => {
  Dash.destroy();
  if (!S.tx.length) {
    main.innerHTML = `<div class="page-head"><h1>לוח בקרה</h1></div>${UI.empty('upload', 'עדיין אין נתונים. ייבאו תדפיס בנק או אשראי, או טענו את קובצי הדוגמה.', '<button class="btn primary" data-go>מעבר לייבוא</button>')}`;
    $('[data-go]', main).onclick = () => App.go('import'); return;
  }
  const r = Period.range(); const list = Calc.inRange(r.from, r.to); const tot = Calc.totals(list);
  const pr = Period.prevRange(); const prevTot = Calc.totals(Calc.inRange(pr.from, pr.to));
  const hasPrev = Calc.inRange(pr.from, pr.to).length > 0;
  // ממוצע חודשי על פני החודשים המלאים האחרים
  const curYm = U.today().slice(0, 7);
  const otherMonths = Calc.months().filter((m) => (m < r.from.slice(0, 7) || m > r.to.slice(0, 7)) && m !== curYm);
  const avgExp = otherMonths.length ? U.round(U.sum(otherMonths, (m) => Calc.totals(Calc.inMonth(m)).expense) / otherMonths.length) : 0;
  const avgInc = otherMonths.length ? U.round(U.sum(otherMonths, (m) => Calc.totals(Calc.inMonth(m)).income) / otherMonths.length) : 0;
  const mult = Period.step();
  const isMonth = Period.mode === 'month';

  const cats = Object.entries(tot.byCat).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const expenses = list.filter((t) => Calc.counts(t) && Calc.expenseOf(t) > 0);
  const top10 = [...expenses].sort((a, b) => Calc.expenseOf(b) - Calc.expenseOf(a)).slice(0, 10);
  const byMerchant = {};
  expenses.forEach((t) => { const m = (byMerchant[t.merchant] = byMerchant[t.merchant] || { name: t.description, count: 0, sum: 0, cat: t.categoryId }); m.count++; m.sum += Calc.expenseOf(t); });
  const merchants = Object.values(byMerchant).sort((a, b) => b.count - a.count || b.sum - a.sum).slice(0, 8);
  const recurring = Calc.recurring(); const recMonthly = U.sum(recurring, (x) => x.monthly);
  const anomalies = isMonth ? Calc.anomalies(Period.ym) : [];
  const forecast = isMonth ? Calc.forecast(Period.ym) : null;
  const budgetAlerts = isMonth ?Budget.status(Period.ym).filter((b) => b.level !== 'ok') : [];
  const unlinked = list.filter((t) => t.ccCharge && !t.linked);

  const alerts = [
    ...budgetAlerts.map((b) => `<div class="alert ${b.level}">${UI.icon(b.level === 'over' ? 'octagon-alert' : 'triangle-alert')}<div><strong>${b.level === 'over' ? 'חריגה מהתקציב' : 'מתקרב לתקרה'}:</strong> ${U.esc(b.name)}, נוצלו <span class="num">${b.pct}%</span> (${U.money(b.spent)} מתוך ${U.money(b.budget)})</div></div>`),
    ...unlinked.map((t) => `<div class="alert warn">${UI.icon('credit-card')}<div><strong>חיוב אשראי ללא פירוט:</strong> ${U.esc(t.description)}, ${U.money(-t.amount)} ב-<span class="num">${U.il(t.date)}</span>. ייבאו את תדפיס הכרטיס כדי לראות לאן הכסף הלך.</div></div>`),
    ...anomalies.slice(0, 6).map((a) => `<div class="alert ${a.type === 'high' ? 'over' : 'info'}">${UI.icon(a.type === 'high' ? 'trending-up' : 'store')}<div><strong>${a.type === 'high' ? 'הוצאה חריגה' : 'בית עסק חדש'}:</strong> ${U.esc(a.tx.description)}, ${U.money(-a.tx.amount)} ב-<span class="num">${U.il(a.tx.date)}</span>. ${a.text}.</div></div>`),
  ];

  main.innerHTML = `
    <div class="page-head"><h1>${r.label}</h1>
      <div class="row">${Period.html()}<button class="btn no-print" data-print>${UI.icon('printer')}דוח להדפסה / PDF</button></div></div>
    <div class="grid c4 keep2">
      <div class="card stat"><div class="label">הכנסות</div><div class="amount income">${UI.money(tot.income)}</div>
        ${hasPrev ? Dash.compare('מול התקופה הקודמת', tot.income, prevTot.income, false) : ''}${avgInc ? Dash.compare('מול הממוצע', tot.income, avgInc * mult, false) : ''}</div>
      <div class="card stat"><div class="label">הוצאות</div><div class="amount expense">${UI.money(tot.expense)}</div>
        ${hasPrev ? Dash.compare('מול התקופה הקודמת', tot.expense, prevTot.expense) : ''}${avgExp ? Dash.compare('מול הממוצע', tot.expense, avgExp * mult) : ''}</div>
      <div class="card stat"><div class="label">מאזן</div><div class="amount ${tot.balance >= 0 ? 'ok' : 'over'}">${UI.money(tot.balance, true)}</div>
        <div class="caption">${UI.icon(tot.balance >= 0 ? 'piggy-bank' : 'triangle-alert')} ${tot.balance >= 0 ? 'חיסכון' : 'גירעון'}${tot.income ? ` · <span class="num">${Math.round((tot.balance / tot.income) * 100)}%</span> מההכנסות` : ''}</div></div>
      <div class="card stat"><div class="label">${forecast ? 'תחזית לסוף החודש' : 'ממוצע הוצאה חודשי'}</div>
        ${forecast ? `<div class="amount">${UI.money(forecast.projected)}</div><div class="caption">לפי הקצב עד היום (יום ${forecast.day} מתוך ${forecast.dim})${forecast.fixedPending ? `, כולל ${U.money(forecast.fixedPending)} חיובים קבועים שטרם ירדו` : ''}</div>`
    : `<div class="amount">${UI.money(avgExp || tot.expense / mult)}</div><div class="caption">על פני ${otherMonths.length || 1} חודשים</div>`}</div>
    </div>
    ${alerts.length ? `<div class="card section"><h3>התראות</h3><div class="stack" style="gap:8px">${alerts.join('')}</div></div>` : ''}
    <div class="grid c2 section">
      <div class="card"><h3>התפלגות הוצאות לפי קטגוריה</h3>
        ${cats.length ? `<div class="chart-box"><canvas id="donut" role="img" aria-label="תרשים טבעת של ההוצאות לפי קטגוריה"></canvas></div>
        <div class="list" style="margin-top:16px">${cats.map(([id, v]) => `<div class="item"><a href="#" data-cat="${id}" class="grow" style="text-decoration:none;color:inherit">${UI.cat(id)}</a>
          <span class="caption num">${Math.round((v / tot.expense) * 100)}%</span>${UI.money(v)}</div>`).join('')}</div>` : '<p class="muted">אין הוצאות בתקופה זו.</p>'}</div>
      <div class="card"><h3>12 החודשים האחרונים</h3>
        <div class="chart-box"><canvas id="bars" role="img" aria-label="תרשים עמודות של הכנסות והוצאות לפי חודש"></canvas></div>
        <div class="row" style="margin-top:16px"><span class="label"><span class="sw" style="background:var(--expense)"></span>הוצאות</span>
          <span class="label"><span class="sw" style="background:var(--income)"></span>הכנסות</span></div>
        <h3 style="margin-top:24px">בתי העסק הפופולריים</h3>
        <div class="list">${merchants.map((m) => `<div class="item"><div class="grow ellipsis">${U.esc(m.name)}</div><span class="caption">${m.count} עסקאות</span>${UI.money(m.sum)}</div>`).join('') || '<p class="muted">אין נתונים.</p>'}</div></div>
    </div>
    <div class="grid c2 section">
      <div class="card"><h3>10 ההוצאות הגדולות</h3>
        <div class="list">${top10.map((t) => `<div class="item" data-id="${t.id}" style="cursor:pointer" tabindex="0">${UI.cat(t.categoryId, false)}<div class="grow"><div class="ellipsis">${U.esc(t.description)}</div><div class="caption num">${U.il(t.date)}</div></div>${UI.money(Calc.expenseOf(t))}</div>`).join('') || '<p class="muted">אין הוצאות בתקופה זו.</p>'}</div></div>
      <div class="card"><h3>הוצאות קבועות ומנויים</h3>
        ${recurring.length ? `<div class="row" style="margin-bottom:8px"><span class="chip brand">חודשי: <span class="num">${U.money(recMonthly)}</span></span><span class="chip">שנתי: <span class="num">${U.money(recMonthly * 12)}</span></span></div>
        <div class="list">${recurring.map((x) => `<div class="item">${UI.cat(x.categoryId, false)}<div class="grow"><div class="ellipsis">${U.esc(x.name)}</div><div class="caption">סביב ה-${x.day} בחודש · בשנה <span class="num">${U.money(x.yearly)}</span></div></div>${UI.money(x.monthly)}</div>`).join('')}</div>`
    : '<p class="muted">נדרשים לפחות שלושה חודשי נתונים כדי לזהות חיובים חוזרים.</p>'}</div>
    </div>`;

  Period.bind(main);
  $('[data-print]', main).onclick = () => Export.print();
  $$('[data-cat]', main).forEach((a) => (a.onclick = (e) => { e.preventDefault(); App.go('transactions', { from: r.from, to: r.to, cats: [a.dataset.cat], kind: 'expense' }); }));
  $$('.item[data-id]', main).forEach((el) => (el.onclick = () => TxEdit.open(el.dataset.id)));

  if (!window.Chart) return;
  Chart.defaults.font.family = Dash.css('--font-sans'); Chart.defaults.color = Dash.css('--ink-muted');
  const tip = { rtl: true, textDirection: 'rtl', callbacks: { label: (c) => ` ${c.dataset.label || c.label}: ${U.money(c.parsed.y ?? c.parsed)}` } };
  if (cats.length) {
    Dash.charts.push(new Chart($('#donut', main), {
      type: 'doughnut',
      data: { labels: cats.map(([id]) => Cat.get(id).name), datasets: [{ data: cats.map(([, v]) => v), backgroundColor: cats.map(([id]) => Cat.color(id)), borderColor: Dash.css('--surface'), borderWidth: 2 }] },
      options: { maintainAspectRatio: false, cutout: '62%', plugins: { legend: { display: false }, tooltip: tip } },
    }));
  }
  const end = Period.mode === 'month' ? Period.ym : r.to.slice(0, 7);
  const yms = Array.from({ length: 12 }, (_, i) => U.ymAdd(end, i - 11));
  const mt = yms.map((ym) => Calc.totals(Calc.inMonth(ym)));
  Dash.charts.push(new Chart($('#bars', main), {
    type: 'bar',
    data: { labels: yms.map((ym) => `${ym.slice(5)}/${ym.slice(2, 4)}`), datasets: [
      { label: 'הוצאות', data: mt.map((x) => x.expense), backgroundColor: Dash.css('--expense'), borderRadius: 4 },
      { label: 'הכנסות', data: mt.map((x) => x.income), backgroundColor: Dash.css('--income'), borderRadius: 4 }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: tip },
      scales: { x: { grid: { display: false } }, y: { position: 'right', grid: { color: Dash.css('--border') }, ticks: { callback: (v) => (v >= 1000 ? `${v / 1000}K` : v) } } } },
  }));
};
