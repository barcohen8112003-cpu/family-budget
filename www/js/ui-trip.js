'use strict';
/* תקציב טיול: סכום לכל קטגוריה, הוספת הוצאה ידנית ומעקב כמה נשאר */

const TRIP_CATEGORIES = [
  { id: 'flights', name: 'טיסות', color: '#1a6aa8', icon: 'plane' },
  { id: 'lodging', name: 'לינה', color: '#0f5c57', icon: 'bed' },
  { id: 'food', name: 'אוכל ומסעדות', color: '#b3401f', icon: 'utensils' },
  { id: 'attractions', name: 'אטרקציות וסיורים', color: '#c98a12', icon: 'ticket' },
  { id: 'transport', name: 'תחבורה ורכב', color: '#6b5b95', icon: 'car' },
  { id: 'shopping', name: 'קניות', color: '#a2559c', icon: 'shopping-bag' },
  { id: 'insurance', name: 'ביטוח נסיעות', color: '#56677a', icon: 'shield' },
  { id: 'phone', name: 'סים ותקשורת', color: '#3d8fb5', icon: 'smartphone' },
  { id: 'other', name: 'שונות', color: '#8a857b', icon: 'circle-ellipsis' },
].map((c) => ({ type: 'expense', ...c }));

const Trip = {
  // הוצאה לפי קטגוריה על פני כל הטיול
  spentBy() { return Calc.totals(S.tx).byCat; },
  level: (spent, budget) => Budget.level(Math.round((spent / budget) * 100)),

  // הוספה או עריכה של הוצאה. preset.categoryId בוחר מראש מאיזו קטגוריה להוריד
  add(tx = null, preset = {}) {
    const t = tx || { id: U.uid(), date: U.today(), description: '', amount: 0, categoryId: preset.categoryId || 'food', sourceId: 'src-manual',
      member: S.settings.members[0] || '', tags: [], manual: true, splits: [] };
    const spent = Trip.spentBy();
    const cats = Cat.tops().filter((c) => c.type === 'expense');
    const left = (id) => {
      if (!(S.budgets[id] > 0)) return '';
      const r = S.budgets[id] - (spent[id] || 0);
      return r >= 0 ? ` · נשארו ${U.money(r)}` : ` · חריגה של ${U.money(-r)}`;
    };
    const m = UI.modal({
      title: tx ? 'עריכת הוצאה' : 'הוצאה חדשה',
      body: `<div class="stack">
        <label class="field"><span>סכום (${U.cur})</span><input type="number" inputmode="decimal" step="any" min="0" id="q-amount" value="${tx ? Math.abs(t.amount) : ''}" style="font-size:24px;min-height:56px"></label>
        <div><div class="label" style="margin-bottom:8px">מאיזה תקציב להוריד?</div>
          <div class="cat-pick">${cats.map((c) => `<button type="button" class="btn" data-pick="${c.id}" aria-pressed="${t.categoryId === c.id}">${UI.cat(c.id, false)}<span class="grow" style="text-align:start">${U.esc(c.name)}<span class="caption" style="display:block">${left(c.id).replace(' · ', '')}</span></span></button>`).join('')}</div></div>
        <label class="field"><span>על מה? (לא חובה)</span><input id="q-desc" value="${U.esc(t.description)}" placeholder="למשל: ארוחת ערב בניו יורק"></label>
        <label class="field"><span>תאריך</span><input type="date" id="q-date" value="${t.date}"></label>
      </div>`,
      actions: [
        { label: 'שמירה', cls: 'primary', onClick: async (close, el) => {
          const amount = +$('#q-amount', el).value; const date = $('#q-date', el).value;
          if (!(amount > 0)) return UI.toast('הקלידו סכום גדול מאפס.', 'error');
          if (!date) return UI.toast('חסר תאריך.', 'error');
          const cat = $('[data-pick][aria-pressed="true"]', el).dataset.pick;
          const desc = $('#q-desc', el).value.trim() || Cat.get(cat).name;
          Object.assign(t, { amount: U.round(-amount), date, categoryId: cat, description: desc, merchant: Classify.merchantKey(desc), splits: [] });
          if (!tx) t.hash = U.hash(`manual|${t.id}`);
          await Store.putTx(t); close();
          if (!tx) {
            const b = S.budgets[cat]; const s = Trip.spentBy()[cat] || 0;
            UI.toast(b > 0 ? `נרשם. ב${Cat.get(cat).name} נשארו ${U.money(b - s)}` : 'ההוצאה נרשמה');
          }
          App.render();
        } },
        { label: 'ביטול', cls: 'ghost', onClick: (close) => close() },
        ...(tx ? [{ label: 'מחיקה', cls: 'danger', onClick: async (close) => { if (await UI.confirm('למחוק את ההוצאה?', 'מחיקה', true)) { await Store.delTx(tx.id); close(); App.render(); } } }] : []),
      ],
    });
    $$('[data-pick]', m.el).forEach((b) => (b.onclick = () => {
      $$('[data-pick]', m.el).forEach((x) => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true');
    }));
    if (!$('[data-pick][aria-pressed="true"]', m.el)) $('[data-pick]', m.el).setAttribute('aria-pressed', 'true');
    $('#q-amount', m.el).focus();
  },

  // קביעת תקציב לקטגוריה, שינוי שם, או קטגוריה חדשה (catId = null)
  editCat(catId) {
    const c = catId ? Cat.get(catId) : null;
    UI.modal({
      title: c ? c.name : 'קטגוריה חדשה',
      body: `<div class="stack">
        <label class="field"><span>שם</span><input id="c-name" value="${U.esc(c ? c.name : '')}" placeholder="למשל: טיפים"></label>
        <label class="field"><span>תקציב לטיול (${U.cur})</span><input type="number" inputmode="decimal" min="0" step="any" id="c-budget" value="${c && S.budgets[c.id] ? S.budgets[c.id] : ''}" placeholder="השאירו ריק אם אין תקציב"></label></div>`,
      actions: [
        { label: 'שמירה', cls: 'primary', onClick: async (close, el) => {
          const name = $('#c-name', el).value.trim(); if (!name) return UI.toast('חסר שם.', 'error');
          let id = catId;
          if (!c) {
            if (S.categories.some((x) => !x.parentId && x.name === name)) return UI.toast('כבר יש קטגוריה בשם הזה.', 'error');
            id = `c-${U.uid()}`; S.categories.push({ id, name, color: '#56677a', icon: 'circle-ellipsis', type: 'expense' });
          } else c.name = name;
          const v = +$('#c-budget', el).value; if (v > 0) S.budgets[id] = v; else delete S.budgets[id];
          await Store.save('categories'); await Store.save('budgets'); close(); App.render();
        } },
        { label: 'ביטול', cls: 'ghost', onClick: (close) => close() },
        ...(c && c.id !== 'other' ? [{ label: 'מחיקת הקטגוריה', cls: 'danger', onClick: async (close) => {
          const used = S.tx.filter((t) => t.categoryId === c.id);
          if (!(await UI.confirm(`למחוק את "${c.name}"?${used.length ? ` ${used.length} ההוצאות שלה יעברו ל"שונות".` : ''}`, 'מחיקה', true))) return;
          used.forEach((t) => { t.categoryId = 'other'; }); if (used.length) await Store.putTx(used);
          S.categories = S.categories.filter((x) => x.id !== c.id); delete S.budgets[c.id];
          await Store.save('categories'); await Store.save('budgets'); close(); App.render();
        } }] : []),
      ],
    });
  },
};

Views.trip = (main) => {
  const spent = Trip.spentBy();
  const cats = Cat.tops().filter((c) => c.type === 'expense');
  const totalBudget = U.sum(cats, (c) => S.budgets[c.id] || 0);
  const totalSpent = U.sum(cats, (c) => Math.max(spent[c.id] || 0, 0));
  const pct = totalBudget ? Math.round((totalSpent / totalBudget) * 100) : 0;
  const lvl = Budget.level(pct);
  const recent = [...S.tx].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 8);

  main.innerHTML = `
    <div class="page-head"><h1>${U.esc(Registry.current().name)}</h1>
      <button class="btn primary" data-add style="min-height:52px;font-size:16px">${UI.icon('plus')}הוצאה חדשה</button></div>
    <div class="card">
      ${totalBudget ? `<div class="row between"><span class="label">התקציב לכל הטיול</span><span class="label ${lvl}">${UI.icon(Budget.icon[lvl])} ${Budget.word[lvl]} · <span class="num">${pct}%</span></span></div>
        <div class="stat"><div class="amount">${UI.money(totalBudget - totalSpent)} <span class="caption">נשארו מתוך ${U.money(totalBudget)}</span></div></div>
        <div class="progress ${lvl}" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="ניצול תקציב הטיול"><i style="width:${Math.min(pct, 100)}%"></i></div>
        <div class="caption" style="margin-top:8px">הוצאתם עד עכשיו ${U.money(totalSpent)}</div>`
    : `<div class="row between"><span class="label">הוצאתם עד עכשיו</span></div><div class="stat"><div class="amount">${UI.money(totalSpent)}</div></div>
        <p class="caption">לחצו על קטגוריה למטה כדי לקבוע לה תקציב.</p>`}
    </div>
    <div class="row between section" style="margin-bottom:12px"><h3>תקציב לפי קטגוריה</h3><button class="btn sm" data-new-cat>${UI.icon('plus')}קטגוריה</button></div>
    <div class="trip-grid">${cats.map((c) => {
    const b = S.budgets[c.id] || 0; const s = Math.max(spent[c.id] || 0, 0); const p = b ? Math.round((s / b) * 100) : 0; const l = Budget.level(p);
    return `<div class="card trip-cat">
        <div class="row between" style="flex-wrap:nowrap"><button class="btn ghost grow" style="justify-content:flex-start;padding:0;min-height:36px" data-cat="${c.id}" aria-label="עריכת ${U.esc(c.name)}">${UI.cat(c.id)}</button>
          <button class="btn sm icon" data-add-to="${c.id}" aria-label="הוצאה מ${U.esc(c.name)}">${UI.icon('plus')}</button></div>
        ${b ? `<div class="row between caption" style="margin:8px 0 4px"><span class="${l}">${p >= 100 ? `חריגה של ${U.money(s - b)}` : `נשארו ${U.money(b - s)}`}</span><span>${U.money(s)} מתוך ${U.money(b)}</span></div>
          <div class="progress ${l}" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100" aria-label="ניצול תקציב ${U.esc(c.name)}"><i style="width:${Math.min(p, 100)}%"></i></div>`
      : `<div class="caption" style="margin-top:8px">${s ? `הוצאתם ${U.money(s)} · ` : ''}<a href="#" data-cat="${c.id}">קביעת תקציב</a></div>`}
      </div>`;
  }).join('')}</div>
    <div class="card section"><h3>הוצאות אחרונות</h3>
      ${recent.length ? `<div class="list">${recent.map((t) => `<div class="item" data-id="${t.id}" style="cursor:pointer" tabindex="0">${UI.cat(t.categoryId, false)}
        <div class="grow"><div class="ellipsis">${U.esc(t.description)}</div><div class="caption"><span class="num">${U.il(t.date)}</span> · ${U.esc(Cat.get(t.categoryId).name)}</div></div>${UI.money(-t.amount)}</div>`).join('')}</div>
        ${S.tx.length > recent.length ? '<button class="btn sm ghost" data-all style="margin-top:8px">לכל ההוצאות</button>' : ''}`
    : '<p class="muted">עדיין לא נרשמו הוצאות. לחצו על "הוצאה חדשה".</p>'}</div>`;

  $('[data-add]', main).onclick = () => Trip.add();
  $('[data-new-cat]', main).onclick = () => Trip.editCat(null);
  $$('[data-cat]', main).forEach((b) => (b.onclick = (e) => { e.preventDefault(); Trip.editCat(b.dataset.cat); }));
  $$('[data-add-to]', main).forEach((b) => (b.onclick = () => Trip.add(null, { categoryId: b.dataset.addTo })));
  $$('.item[data-id]', main).forEach((el) => (el.onclick = () => Trip.add(S.tx.find((t) => t.id === el.dataset.id))));
  const all = $('[data-all]', main); if (all) all.onclick = () => App.go('transactions');
};
