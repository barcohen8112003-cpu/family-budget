'use strict';
/* תקציב חודשי לפי קטגוריה, יעדי חיסכון ותשלומים עתידיים */

const Budget = {
  level: (pct) => (pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok'),
  word: { ok: 'בתקציב', warn: 'מתקרב לתקרה', over: 'חריגה' },
  icon: { ok: 'circle-check', warn: 'triangle-alert', over: 'octagon-alert' },
  // מצב התקציב בטווח: רשימה לכל קטגוריה שהוגדר לה תקציב
  status(ym, months = 1) {
    const from = `${ym}-01`; const last = U.ymAdd(ym, months - 1); const to = `${last}-${U.daysInMonth(last)}`;
    const byCat = Calc.totals(Calc.inRange(from, to)).byCat;
    return Cat.tops().filter((c) => c.type === 'expense' && S.budgets[c.id] > 0).map((c) => {
      const budget = S.budgets[c.id] * months; const spent = Math.max(byCat[c.id] || 0, 0); const pct = Math.round((spent / budget) * 100);
      return { id: c.id, name: c.name, budget, spent, pct, level: Budget.level(pct), left: U.round(budget - spent) };
    });
  },
  // הצעת תקציב לקטגוריה: ממוצע שלושת החודשים המלאים האחרונים, מעוגל ל-50
  suggest(id) {
    const full = Calc.months().filter((m) => m < U.today().slice(0, 7)).slice(-3);
    return full.length ? Math.ceil(U.sum(full, (m) => Calc.totals(Calc.inMonth(m)).byCat[id] || 0) / full.length / 50) * 50 : 0;
  },
  // הוספה או עריכה של שורת תקציב. בהוספה אפשר גם ליצור קטגוריה חדשה.
  dialog(catId) {
    const free = Cat.tops().filter((c) => c.type === 'expense' && !(S.budgets[c.id] > 0));
    const m = UI.modal({
      title: catId ? `תקציב חודשי: ${Cat.get(catId).name}` : 'הוספת תקציב חודשי',
      body: `<div class="stack">
        ${catId ? '' : `<label class="field"><span>קטגוריה</span><select id="b-cat">${free.map((c) => `<option value="${c.id}">${U.esc(c.name)}</option>`).join('')}<option value="__new">קטגוריה חדשה…</option></select></label>
        <label class="field" id="b-new-wrap" hidden><span>שם הקטגוריה החדשה</span><input id="b-new"></label>`}
        <label class="field"><span>תקציב חודשי (₪)</span><input type="number" min="0" step="50" id="b-amount" value="${catId ? S.budgets[catId] : ''}"></label>
        <p class="caption" id="b-hint"></p></div>`,
      actions: [
        { label: 'שמירה', cls: 'primary', onClick: async (close, el) => {
          const amount = +$('#b-amount', el).value; if (!(amount > 0)) return UI.toast('הקלידו סכום גדול מאפס.', 'error');
          let id = catId || $('#b-cat', el).value;
          if (id === '__new') {
            const name = $('#b-new', el).value.trim(); if (!name) return UI.toast('חסר שם לקטגוריה החדשה.', 'error');
            if (S.categories.some((c) => !c.parentId && c.name === name)) return UI.toast('כבר קיימת קטגוריה בשם הזה.', 'error');
            id = `c-${U.uid()}`; S.categories.push({ id, name, color: '#56677a', icon: 'circle-ellipsis', type: 'expense' }); await Store.save('categories');
          }
          S.budgets[id] = amount; await Store.save('budgets'); close(); App.render();
        } },
        { label: 'ביטול', cls: 'ghost', onClick: (close) => close() },
      ],
    });
    const el = m.el; const sel = $('#b-cat', el);
    const sync = () => {
      const id = catId || sel.value;
      if (sel) $('#b-new-wrap', el).hidden = id !== '__new';
      const v = id !== '__new' ? Budget.suggest(id) : 0;
      $('#b-hint', el).textContent = v ? `ממוצע ההוצאה בשלושת החודשים האחרונים: ${U.money(v)}` : '';
    };
    if (sel) sel.onchange = sync;
    sync();
  },
  goalDialog(goal) {
    const g = goal || { id: U.uid(), name: '', target: '', saved: 0, deadline: '' };
    UI.modal({
      title: goal ? 'עריכת יעד חיסכון' : 'יעד חיסכון חדש',
      body: `<div class="stack"><label class="field"><span>שם היעד</span><input id="g-name" value="${U.esc(g.name)}" placeholder="למשל: קרן חירום"></label>
        <div class="form-grid"><label class="field"><span>סכום היעד (₪)</span><input type="number" min="0" step="any" id="g-target" value="${g.target}"></label>
        <label class="field"><span>נחסך עד כה (₪)</span><input type="number" min="0" step="any" id="g-saved" value="${g.saved}"></label>
        <label class="field"><span>תאריך יעד (לא חובה)</span><input type="date" id="g-deadline" value="${g.deadline || ''}"></label></div></div>`,
      actions: [
        { label: 'שמירה', cls: 'primary', onClick: async (close, el) => {
          const name = $('#g-name', el).value.trim(); const target = +$('#g-target', el).value;
          if (!name || !(target > 0)) return UI.toast('חסרים שם וסכום יעד.', 'error');
          Object.assign(g, { name, target, saved: +$('#g-saved', el).value || 0, deadline: $('#g-deadline', el).value });
          if (!goal) S.goals.push(g);
          await Store.save('goals'); close(); App.render();
        } },
        { label: 'ביטול', cls: 'ghost', onClick: (close) => close() },
        ...(goal ? [{ label: 'מחיקה', cls: 'danger', onClick: async (close) => { S.goals = S.goals.filter((x) => x.id !== g.id); await Store.save('goals'); close(); App.render(); } }] : []),
      ],
    });
  },
};

Views.budget = (main) => {
  const months = Period.step(); const r = Period.range(); const startYm = r.from.slice(0, 7);
  const byCat = Calc.totals(Calc.inRange(r.from, r.to)).byCat;
  const status = Budget.status(startYm, months);
  const totalBudget = U.sum(status, (s) => s.budget), totalSpent = U.sum(status, (s) => s.spent);
  const totalPct = totalBudget ? Math.round((totalSpent / totalBudget) * 100) : 0;
  const upcoming = Calc.upcoming(U.today().slice(0, 7) > Calc.latestMonth() ? U.today().slice(0, 7) : Calc.latestMonth(), 6);
  const installments = Calc.installments();
  const hasHistory = Calc.months().some((m) => m < U.today().slice(0, 7));

  main.innerHTML = `
    <div class="page-head"><div><h1>תקציב ויעדים</h1><p class="muted">${r.label}</p></div>${Period.html()}</div>
    ${status.length ? `<div class="card"><div class="row between"><h3>סה"כ תקציב</h3><span class="label ${Budget.level(totalPct)}">${UI.icon(Budget.icon[Budget.level(totalPct)])} ${Budget.word[Budget.level(totalPct)]} · <span class="num">${totalPct}%</span></span></div>
      <div class="progress ${Budget.level(totalPct)}" style="margin:12px 0 8px" role="progressbar" aria-valuenow="${totalPct}" aria-valuemin="0" aria-valuemax="100" aria-label="ניצול התקציב הכולל"><i style="width:${Math.min(totalPct, 100)}%"></i></div>
      <div class="caption">נוצלו ${U.money(totalSpent)} מתוך ${U.money(totalBudget)} · ${totalBudget - totalSpent >= 0 ? `נותרו ${U.money(totalBudget - totalSpent)}` : `חריגה של ${U.money(totalSpent - totalBudget)}`}</div></div>` : ''}

    <div class="card section"><div class="row between" style="margin-bottom:16px"><h3>תקציב חודשי לפי קטגוריה</h3>
      <div class="row">${hasHistory ? `<button class="btn sm" data-suggest>${UI.icon('wand-sparkles')}מילוי לפי ממוצע 3 חודשים</button>` : ''}
        <button class="btn sm primary" data-budget-add>${UI.icon('plus')}הוספת תקציב</button></div></div>
      <div class="list">${Cat.tops().filter((c) => c.type === 'expense').map((c) => {
    const s = status.find((x) => x.id === c.id); const spent = Math.max(byCat[c.id] || 0, 0);
    return `<div class="item" style="flex-wrap:wrap">
          <div style="flex:1 1 220px;min-width:0">${UI.cat(c.id)}</div>
          <div style="flex:2 1 260px;min-width:0">
            ${s ? `<div class="row between caption" style="margin-bottom:4px"><span class="${s.level}">${UI.icon(Budget.icon[s.level])} ${Budget.word[s.level]} · <span class="num">${s.pct}%</span></span>
              <span>${U.money(s.spent)} מתוך ${U.money(s.budget)}</span></div>
            <div class="progress ${s.level}" role="progressbar" aria-valuenow="${s.pct}" aria-valuemin="0" aria-valuemax="100" aria-label="ניצול תקציב ${U.esc(c.name)}"><i style="width:${Math.min(s.pct, 100)}%"></i></div>`
      : `<span class="caption">הוצאה בתקופה: ${U.money(spent)} · לא הוגדר תקציב</span>`}
          </div>
          <div class="row" style="flex:0 0 auto;gap:4px;flex-wrap:nowrap"><input type="number" min="0" step="50" data-budget="${c.id}" value="${S.budgets[c.id] || ''}" placeholder="תקציב" style="width:110px" aria-label="תקציב חודשי ל${U.esc(c.name)}"><span class="muted">₪</span>
            <button class="btn sm ghost icon" data-budget-del="${c.id}" ${s ? '' : 'style="visibility:hidden"'} aria-label="מחיקת התקציב של ${U.esc(c.name)}">${UI.icon('trash-2')}</button></div>
        </div>`;
  }).join('')}</div></div>

    <div class="card section"><div class="row between" style="margin-bottom:16px"><h3>יעדי חיסכון</h3><button class="btn sm" data-goal-add>${UI.icon('plus')}יעד חדש</button></div>
      ${S.goals.length ? `<div class="grid c2">${S.goals.map((g) => {
    const pct = Math.min(Math.round((g.saved / g.target) * 100), 100); const left = Math.max(g.target - g.saved, 0);
    const mLeft = g.deadline ? Math.max(Math.ceil(U.daysBetween(U.today(), g.deadline) / 30.4), 1) : null;
    return `<div class="card" style="padding:16px"><div class="row between"><span class="label">${U.esc(g.name)}</span><button class="btn sm ghost icon" data-goal="${g.id}" aria-label="עריכת היעד ${U.esc(g.name)}">${UI.icon('pencil')}</button></div>
          <div class="stat"><div class="amount">${UI.money(g.saved)} <span class="caption">מתוך ${U.money(g.target)}</span></div></div>
          <div class="progress brand" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="התקדמות ביעד ${U.esc(g.name)}"><i style="width:${pct}%"></i></div>
          <div class="caption" style="margin-top:8px"><span class="num">${pct}%</span> · ${left ? `נותרו ${U.money(left)}` : 'היעד הושג'}${left && mLeft ? ` · ${U.money(left / mLeft)} בחודש עד <span class="num">${U.il(g.deadline)}</span>` : ''}</div>
          <div class="row" style="margin-top:12px"><input type="number" min="0" step="any" placeholder="סכום להפקדה" data-dep-input="${g.id}" style="width:150px" aria-label="סכום להפקדה ליעד"><button class="btn sm" data-dep="${g.id}">הפקדה</button></div></div>`;
  }).join('')}</div>` : '<p class="muted">עדיין לא הוגדרו יעדים. למשל: "קרן חירום 20,000 ₪".</p>'}</div>

    <div class="card section"><h3>תשלומים עתידיים</h3>
      ${installments.length ? `<p class="caption" style="margin-bottom:8px">עסקאות בתשלומים פעילות: יתרה כוללת לתשלום ${U.money(U.sum(installments, (x) => x.remaining))}</p>
      <div class="list" style="margin-bottom:16px">${installments.map((x) => `<div class="item"><div class="grow"><div>${U.esc(x.tx.description)}</div><div class="caption">שולמו ${x.tx.installment.n} מתוך ${x.tx.installment.total} · ${U.money(x.monthly)} בחודש</div></div><span class="caption">נותר</span>${UI.money(x.remaining)}</div>`).join('')}</div>` : ''}
      ${upcoming.some((u) => u.items.length) ? `<div class="table-wrap"><table><thead><tr><th>חודש</th><th>חיובים צפויים</th><th class="amount">סה"כ צפוי</th></tr></thead>
      <tbody>${upcoming.map((u) => `<tr><td>${U.monthName(u.ym)}</td><td>${u.items.slice(0, 6).map((i) => `<span class="chip" title="${U.esc(i.kind)}">${U.esc(i.name)} · <span class="num">${U.money(i.amount)}</span></span>`).join(' ')}${u.items.length > 6 ? ` <span class="caption">ועוד ${u.items.length - 6}</span>` : ''}</td><td class="amount">${UI.money(u.total)}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="muted">אין חיובים צפויים. הם יופיעו כאן אחרי ייבוא עסקאות בתשלומים או זיהוי הוצאות קבועות.</p>'}</div>`;

  Period.bind(main);
  $('[data-budget-add]', main).onclick = () => Budget.dialog(null);
  $$('[data-budget]', main).forEach((inp) => (inp.onchange = async () => {
    const v = +inp.value; if (v > 0) S.budgets[inp.dataset.budget] = v; else delete S.budgets[inp.dataset.budget];
    await Store.save('budgets'); App.render();
  }));
  $$('[data-budget-del]', main).forEach((b) => (b.onclick = async () => {
    if (!(await UI.confirm(`למחוק את התקציב של "${Cat.get(b.dataset.budgetDel).name}"? הקטגוריה והעסקאות שלה יישארו.`, 'מחיקה', true))) return;
    delete S.budgets[b.dataset.budgetDel]; await Store.save('budgets'); App.render();
  }));
  const sg = $('[data-suggest]', main);
  if (sg) sg.onclick = async () => {
    if (Object.keys(S.budgets).length && !(await UI.confirm('להחליף את התקציבים הקיימים בממוצע שלושת החודשים האחרונים?', 'החלפה'))) return;
    Cat.tops().filter((c) => c.type === 'expense').forEach((c) => { const v = Budget.suggest(c.id); if (v > 0) S.budgets[c.id] = v; });
    await Store.save('budgets'); App.render();
  };
  $('[data-goal-add]', main).onclick = () => Budget.goalDialog(null);
  $$('[data-goal]', main).forEach((b) => (b.onclick = () => Budget.goalDialog(S.goals.find((g) => g.id === b.dataset.goal))));
  $$('[data-dep]', main).forEach((b) => (b.onclick = async () => {
    const v = +$(`[data-dep-input="${b.dataset.dep}"]`, main).value; if (!(v > 0)) return;
    const g = S.goals.find((x) => x.id === b.dataset.dep); g.saved = U.round(g.saved + v); await Store.save('goals'); App.render();
  }));
};
