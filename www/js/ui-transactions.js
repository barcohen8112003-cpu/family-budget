'use strict';
/* מסך העסקאות: חיפוש, סינון, מיון, עריכה, פיצול וכללי סיווג */

const Tx = {
  f: null, advanced: false,
  blank: () => ({ from: '', to: '', min: '', max: '', exact: '', cats: [], text: '', source: '', member: '', tag: '', kind: 'all', sortKey: 'date', sortDir: -1 }),
  preset(name) {
    const today = U.today(), ym = today.slice(0, 7); const f = Tx.f;
    if (name === 'month') { f.from = `${ym}-01`; f.to = `${ym}-${U.daysInMonth(ym)}`; }
    if (name === 'prev') { const p = U.ymAdd(ym, -1); f.from = `${p}-01`; f.to = `${p}-${U.daysInMonth(p)}`; }
    if (name === '3m') { f.from = `${U.ymAdd(ym, -2)}-01`; f.to = `${ym}-${U.daysInMonth(ym)}`; }
    if (name === 'year') { f.from = `${ym.slice(0, 4)}-01-01`; f.to = `${ym.slice(0, 4)}-12-31`; }
    if (name === 'all') { f.from = ''; f.to = ''; }
  },
  setMonth(ym) { Tx.f.from = `${ym}-01`; Tx.f.to = `${ym}-${U.daysInMonth(ym)}`; },
  matches(t, f) {
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    const abs = Math.abs(t.amount);
    if (f.exact !== '' && Math.abs(abs - +f.exact) > 0.005) return false;
    if (f.min !== '' && abs < +f.min) return false;
    if (f.max !== '' && abs > +f.max) return false;
    const allocs = Calc.allocations(t);
    if (f.cats.length) {
      const ids = new Set(f.cats.flatMap((c) => Cat.family(c)));
      if (!allocs.some((a) => ids.has(a.categoryId))) return false;
    }
    if (f.kind === 'income' && !allocs.some((a) => Cat.isIncome(a.categoryId))) return false;
    if (f.kind === 'expense' && !allocs.some((a) => !Cat.isIncome(a.categoryId))) return false;
    if (f.source && t.sourceId !== f.source) return false;
    if (f.member && t.member !== f.member) return false;
    if (f.tag && !(t.tags || []).includes(f.tag)) return false;
    if (f.text) {
      const hay = `${t.description} ${(t.tags || []).join(' ')} ${t.notes || ''} ${t.details || ''}`.toLowerCase();
      if (!f.text.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  },
  filtered() {
    const f = Tx.f; const list = S.tx.filter((t) => Tx.matches(t, f));
    const key = { date: (t) => t.date, description: (t) => t.description, category: (t) => Cat.label(t.categoryId), source: (t) => (Calc.source(t.sourceId) || {}).name || '', amount: (t) => t.amount }[f.sortKey];
    return list.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * f.sortDir || (a.date < b.date ? 1 : -1); });
  },
  allTags: () => [...new Set(S.tx.flatMap((t) => t.tags || []))].sort(),
  chips(t) {
    return [
      t.ccCharge ? (t.linked ? `<span class="chip ok" title="${t.linkInfo.count} עסקאות בפירוט, סה&quot;כ ${U.money(t.linkInfo.sum)}">${UI.icon('link')}מקושר לפירוט · לא נספר</span>` : `<span class="chip warn">${UI.icon('triangle-alert')}אין פירוט אשראי</span>`) : '',
      t.installment ? `<span class="chip">תשלום ${t.installment.n} מתוך ${t.installment.total} · נותרו <span class="num">${U.money((t.installment.total - t.installment.n) * -t.amount)}</span></span>` : '',
      t.splits && t.splits.length ? `<span class="chip">${UI.icon('split')}פוצל ל-${t.splits.length}</span>` : '',
      t.manual ? '<span class="chip">ידני</span>' : '',
      t.fromNotif ? `<span class="chip accent">${UI.icon('bell')}מהתראה</span>` : '',
      ...(t.tags || []).map((g) => `<span class="chip brand">${U.esc(g)}</span>`),
      t.member && S.settings.members.length > 1 && t.member !== S.settings.members[0] ? `<span class="chip">${U.esc(t.member)}</span>` : '',
    ].join(' ');
  },
};

Views.transactions = (main, params) => {
  if (!Tx.f) { Tx.f = Tx.blank(); Tx.setMonth(Period.ym); }
  if (params) { Tx.f = { ...Tx.blank(), ...params }; App.params = null; }
  const f = Tx.f; const list = Tx.filtered();
  const tot = Calc.totals(list); const counted = list.filter(Calc.counts);
  const net = U.round(tot.income - tot.expense);
  const avg = counted.length ? U.round(U.sum(counted, (t) => Math.abs(t.amount)) / counted.length) : 0;
  const isMonth = f.from && f.to && f.from.slice(0, 7) === f.to.slice(0, 7) && f.from.endsWith('-01') && +f.to.slice(8) === U.daysInMonth(f.from.slice(0, 7));
  const ym = isMonth ? f.from.slice(0, 7) : null;
  const th = (key, label, cls = '') => `<th class="sortable ${cls}" data-sort="${key}" aria-sort="${f.sortKey === key ? (f.sortDir > 0 ? 'ascending' : 'descending') : 'none'}">${label}${f.sortKey === key ? (f.sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
  const activeAdv = [f.min, f.max, f.exact, f.source, f.member, f.tag].filter((x) => x !== '').length + (f.cats.length ? 1 : 0);

  main.innerHTML = `
    <div class="page-head"><h1>עסקאות</h1>
      <div class="row no-print">
        <button class="btn" data-export>${UI.icon('file-spreadsheet')}ייצוא ל-Excel</button>
        <button class="btn primary" data-add>${UI.icon('plus')}הוספה ידנית</button>
      </div></div>
    <div class="card stack no-print">
      <div class="row">
        <div class="period">
          <button class="btn icon" data-m="-1" aria-label="החודש הקודם">${UI.icon('chevron-right')}</button>
          <span class="label" style="padding:0 12px;min-width:120px;text-align:center">${ym ? U.monthName(ym) : f.from || f.to ? 'טווח מותאם' : 'כל התקופות'}</span>
          <button class="btn icon" data-m="1" aria-label="החודש הבא">${UI.icon('chevron-left')}</button>
        </div>
        ${[['month', 'החודש'], ['prev', 'החודש הקודם'], ['3m', '3 חודשים'], ['year', 'השנה'], ['all', 'הכול']].map(([k, l]) => `<button class="btn sm" data-preset="${k}">${l}</button>`).join('')}
      </div>
      <div class="row">
        <label class="field" style="flex:1;min-width:200px"><input type="search" id="q" placeholder="חיפוש בתיאור, בבית העסק או בתגית" value="${U.esc(f.text)}" aria-label="חיפוש חופשי"></label>
        <div class="seg" role="group" aria-label="סוג">${[['all', 'הכול'], ['expense', 'הוצאות'], ['income', 'הכנסות']].map(([k, l]) => `<button data-kind="${k}" aria-pressed="${f.kind === k}">${l}</button>`).join('')}</div>
        <button class="btn" data-adv aria-expanded="${Tx.advanced}">${UI.icon('sliders-horizontal')}סינון${activeAdv ? ` (${activeAdv})` : ''}</button>
      </div>
      <div ${Tx.advanced ? '' : 'hidden'} class="stack">
        <div class="form-grid">
          <label class="field"><span>מתאריך</span><input type="date" data-f="from" value="${f.from}"></label>
          <label class="field"><span>עד תאריך</span><input type="date" data-f="to" value="${f.to}"></label>
          <label class="field"><span>סכום מינימלי</span><input type="number" min="0" step="any" data-f="min" value="${f.min}"></label>
          <label class="field"><span>סכום מקסימלי</span><input type="number" min="0" step="any" data-f="max" value="${f.max}"></label>
          <label class="field"><span>סכום מדויק</span><input type="number" min="0" step="any" data-f="exact" value="${f.exact}"></label>
          <label class="field"><span>מקור</span><select data-f="source"><option value="">כל המקורות</option>${S.sources.map((s) => `<option value="${s.id}" ${f.source === s.id ? 'selected' : ''}>${U.esc(s.name)}</option>`).join('')}</select></label>
          <label class="field"><span>בן משפחה</span><select data-f="member"><option value="">כולם</option>${S.settings.members.map((m) => `<option ${f.member === m ? 'selected' : ''}>${U.esc(m)}</option>`).join('')}</select></label>
          <label class="field"><span>תגית</span><select data-f="tag"><option value="">כל התגיות</option>${Tx.allTags().map((g) => `<option ${f.tag === g ? 'selected' : ''}>${U.esc(g)}</option>`).join('')}</select></label>
        </div>
        <div><div class="label" style="margin-bottom:8px">קטגוריות (בחירה מרובה)</div>
          <div class="row">${Cat.tops().map((c) => `<label class="chip" style="cursor:pointer;padding:6px 8px"><input type="checkbox" data-cat="${c.id}" ${f.cats.includes(c.id) ? 'checked' : ''}> ${U.esc(c.name)}</label>`).join('')}</div></div>
        <div class="row">
          <button class="btn sm" data-clear>ניקוי הסינון</button>
          <button class="btn sm" data-save-filter>${UI.icon('bookmark')}שמירת הסינון</button>
          ${S.filters.length ? `<select id="saved" aria-label="סינונים שמורים"><option value="">סינונים שמורים…</option>${S.filters.map((x, i) => `<option value="${i}">${U.esc(x.name)}</option>`).join('')}</select>
          <button class="btn sm ghost" data-del-filter>מחיקת סינון שמור</button>` : ''}
        </div>
      </div>
    </div>
    <div class="grid c4 keep2 section" style="margin-top:24px">
      <div class="card stat"><div class="label">סה"כ</div><div class="amount">${UI.money(net, true)}</div><div class="caption">הכנסות ${U.money(tot.income)} · הוצאות ${U.money(tot.expense)}</div></div>
      <div class="card stat"><div class="label">ממוצע לעסקה</div><div class="amount">${UI.money(avg)}</div></div>
      <div class="card stat"><div class="label">מספר עסקאות</div><div class="amount"><span class="num">${list.length}</span></div>${list.length !== counted.length ? `<div class="caption">${list.length - counted.length} חיובי אשראי מקושרים אינם נספרים</div>` : ''}</div>
      <div class="card stat"><div class="label">תקופה</div><div class="amount" style="font-size:16px;line-height:24px">${f.from || f.to ? `<span class="num">${U.il(f.from) || '…'}</span> עד <span class="num">${U.il(f.to) || '…'}</span>` : 'הכול'}</div></div>
    </div>
    <div class="section" style="margin-top:24px">
    ${list.length ? `<div class="table-wrap"><table class="tx-table">
      <thead><tr>${th('date', 'תאריך')}${th('description', 'תיאור')}${th('category', 'קטגוריה')}${th('source', 'מקור', 'hide-m')}${th('amount', 'סכום', 'amount')}</tr></thead>
      <tbody>${list.map((t) => `<tr class="clickable ${Calc.counts(t) ? '' : 'off'}" data-id="${t.id}" tabindex="0">
        <td><span class="num">${U.il(t.date)}</span></td>
        <td>${U.esc(t.description)} ${Tx.chips(t)}</td>
        <td>${UI.cat(t.categoryId)}</td>
        <td class="hide-m muted">${U.esc((Calc.source(t.sourceId) || {}).name || '')}</td>
        <td class="amount">${UI.txAmount(t)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="2">סה"כ ${list.length} עסקאות</td><td></td><td class="hide-m"></td><td class="amount">${UI.money(net, true)}</td></tr></tfoot>
    </table></div>` : UI.empty('search-x', S.tx.length ? 'אין עסקאות שמתאימות לסינון.' : 'עדיין אין עסקאות. ייבאו תדפיס כדי להתחיל.', S.tx.length ? '' : '<button class="btn primary" data-go-import>ייבוא תדפיס</button>')}
    </div>`;

  const rerender = () => App.render();
  $$('[data-m]', main).forEach((b) => (b.onclick = () => { Tx.setMonth(U.ymAdd((f.from || U.today()).slice(0, 7), +b.dataset.m)); rerender(); }));
  $$('[data-preset]', main).forEach((b) => (b.onclick = () => { Tx.preset(b.dataset.preset); rerender(); }));
  $$('[data-kind]', main).forEach((b) => (b.onclick = () => { f.kind = b.dataset.kind; rerender(); }));
  $('[data-adv]', main).onclick = () => { Tx.advanced = !Tx.advanced; rerender(); };
  const q = $('#q', main); let timer;
  q.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { f.text = q.value; rerender(); const n = $('#q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
  $$('[data-f]', main).forEach((el) => (el.onchange = () => { f[el.dataset.f] = el.value; rerender(); }));
  $$('[data-cat]', main).forEach((el) => (el.onchange = () => { f.cats = $$('[data-cat]:checked', main).map((x) => x.dataset.cat); rerender(); }));
  $$('[data-sort]', main).forEach((el) => (el.onclick = () => { const k = el.dataset.sort; if (f.sortKey === k) f.sortDir *= -1; else { f.sortKey = k; f.sortDir = k === 'date' || k === 'amount' ? -1 : 1; } rerender(); }));
  $('[data-clear]', main).onclick = () => { const keep = { from: f.from, to: f.to }; Tx.f = { ...Tx.blank(), ...keep }; rerender(); };
  $('[data-save-filter]', main).onclick = () => UI.modal({
    title: 'שמירת סינון', body: '<label class="field"><span>שם הסינון</span><input id="fname" placeholder="למשל: סופר מעל 500 ₪"></label>',
    actions: [{ label: 'שמירה', cls: 'primary', onClick: async (close, el) => {
      const name = $('#fname', el).value.trim(); if (!name) return;
      S.filters.push({ name, f: { ...f } }); await Store.save('filters'); close(); UI.toast('הסינון נשמר'); rerender();
    } }, { label: 'ביטול', cls: 'ghost', onClick: (close) => close() }],
  });
  const saved = $('#saved', main);
  if (saved) {
    saved.onchange = () => { if (saved.value !== '') { Tx.f = { ...Tx.blank(), ...S.filters[+saved.value].f }; Tx.advanced = true; rerender(); } };
    $('[data-del-filter]', main).onclick = () => UI.modal({
      title: 'מחיקת סינון שמור', body: `<label class="field"><span>איזה סינון למחוק?</span><select id="delf">${S.filters.map((x, i) => `<option value="${i}">${U.esc(x.name)}</option>`).join('')}</select></label>`,
      actions: [{ label: 'מחיקה', cls: 'danger', onClick: async (close, el) => { S.filters.splice(+$('#delf', el).value, 1); await Store.save('filters'); close(); rerender(); } }, { label: 'ביטול', cls: 'ghost', onClick: (close) => close() }],
    });
  }
  $$('tr[data-id]', main).forEach((tr) => { tr.onclick = () => TxEdit.open(tr.dataset.id); tr.onkeydown = (e) => { if (e.key === 'Enter') TxEdit.open(tr.dataset.id); }; });
  $('[data-add]', main).onclick = () => TxEdit.open(null);
  $('[data-export]', main).onclick = () => Export.dialog(list, f);
  const gi = $('[data-go-import]', main); if (gi) gi.onclick = () => App.go('import');
};

// ---------- עריכת עסקה / הוספה ידנית ----------
const TxEdit = {
  open(id, preset = {}) {
    const orig = id ? S.tx.find((t) => t.id === id) : null;
    const t = orig ? JSON.parse(JSON.stringify(orig)) : { id: U.uid(), date: U.today(), description: '', amount: 0, categoryId: 'other', sourceId: 'src-cash', member: S.settings.members[0] || '', tags: [], manual: true, splits: [], ...preset };
    let splits = (t.splits || []).map((s) => ({ ...s, amount: Math.abs(s.amount) }));
    const isIncome = orig ? t.amount > 0 : false;
    const sources = [...S.sources]; if (!sources.find((s) => s.id === 'src-cash')) sources.push({ id: 'src-cash', name: 'מזומן', type: 'cash' });
    const splitRows = () => splits.map((s, i) => `<div class="row" style="flex-wrap:nowrap"><select data-sc="${i}" style="flex:1;min-width:0">${UI.catOptions(s.categoryId)}</select>
      <input type="number" step="any" min="0" data-sa="${i}" value="${s.amount}" style="width:110px" aria-label="סכום החלק"><button class="btn sm icon ghost" data-sd="${i}" aria-label="הסרת החלק">${UI.icon('x')}</button></div>`).join('');
    const m = UI.modal({
      title: orig ? 'עריכת עסקה' : 'הוספת הוצאה או הכנסה',
      body: `<div class="stack">
        ${orig && orig.ccCharge ? `<div class="alert info">${UI.icon('link')}<div>${orig.linked ? `שורת חיוב של כרטיס אשראי. מקושרת ל-${orig.linkInfo.count} עסקאות בפירוט (סה"כ ${U.money(orig.linkInfo.sum)}) ולכן אינה נספרת כהוצאה.` : 'שורת חיוב של כרטיס אשראי ללא פירוט. היא נספרת כהוצאה עד שתייבאו את תדפיס הכרטיס.'}</div></div>` : ''}
        <div class="form-grid">
          <label class="field"><span>סוג</span><select id="e-kind"><option value="expense" ${isIncome ? '' : 'selected'}>הוצאה</option><option value="income" ${isIncome ? 'selected' : ''}>הכנסה</option></select></label>
          <label class="field"><span>תאריך</span><input type="date" id="e-date" value="${t.date}"></label>
          <label class="field"><span>סכום (₪)</span><input type="number" step="any" min="0" id="e-amount" value="${orig ? Math.abs(t.amount) : preset.amount || ''}"></label>
        </div>
        <label class="field"><span>תיאור / בית עסק</span><input id="e-desc" value="${U.esc(t.description)}"></label>
        <div class="form-grid">
          <label class="field"><span>קטגוריה</span><select id="e-cat">${UI.catOptions(t.categoryId, !!(orig && orig.ccCharge))}</select></label>
          <label class="field"><span>מקור</span><select id="e-source">${sources.map((s) => `<option value="${s.id}" ${t.sourceId === s.id ? 'selected' : ''}>${U.esc(s.name)}</option>`).join('')}</select></label>
          <label class="field"><span>בן משפחה</span><select id="e-member">${S.settings.members.map((x) => `<option ${t.member === x ? 'selected' : ''}>${U.esc(x)}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span>תגיות (מופרדות בפסיק)</span><input id="e-tags" value="${U.esc((t.tags || []).join(', '))}" placeholder="למשל: חופשה באילת 2026" list="taglist"><datalist id="taglist">${Tx.allTags().map((g) => `<option value="${U.esc(g)}">`).join('')}</datalist></label>
        <label class="field"><span>הערה</span><input id="e-notes" value="${U.esc(t.notes || '')}"></label>
        <div><div class="row between"><span class="label">פיצול לכמה קטגוריות</span><button class="btn sm" id="e-split-add">${UI.icon('split')}הוספת חלק</button></div>
          <div id="e-splits" class="stack" style="gap:8px;margin-top:8px">${splitRows()}</div><p class="caption" id="e-split-note"></p></div>
      </div>`,
      actions: [
        { label: 'שמירה', cls: 'primary', onClick: (close, el) => TxEdit.save(orig, t, splits, el, close).catch(UI.error) },
        { label: 'ביטול', cls: 'ghost', onClick: (close) => close() },
        ...(orig ? [{ label: 'מחיקה', cls: 'danger', onClick: async (close) => { if (await UI.confirm('למחוק את העסקה?', 'מחיקה', true)) { await Store.delTx(orig.id); close(); App.render(); } } }] : []),
      ],
    });
    const el = m.el;
    const note = () => {
      const total = +$('#e-amount', el).value || 0; const used = U.sum(splits, (s) => +s.amount || 0);
      $('#e-split-note', el).textContent = splits.length ? `סה"כ בחלקים: ${U.money(used)} מתוך ${U.money(total)}${Math.abs(used - total) > 0.005 ? '. הסכומים חייבים להתאים.' : ''}` : '';
    };
    const bindSplits = () => {
      $$('[data-sc]', el).forEach((s) => (s.onchange = () => { splits[+s.dataset.sc].categoryId = s.value; }));
      $$('[data-sa]', el).forEach((s) => (s.oninput = () => { splits[+s.dataset.sa].amount = +s.value; note(); }));
      $$('[data-sd]', el).forEach((s) => (s.onclick = () => { splits.splice(+s.dataset.sd, 1); redraw(); }));
    };
    const redraw = () => { $('#e-splits', el).innerHTML = splitRows(); UI.icons(); bindSplits(); note(); };
    $('#e-split-add', el).onclick = () => {
      const total = +$('#e-amount', el).value || 0;
      if (!splits.length) splits.push({ categoryId: $('#e-cat', el).value, amount: total });
      const used = U.sum(splits, (s) => +s.amount || 0);
      splits.push({ categoryId: 'other', amount: Math.max(U.round(total - used), 0) }); redraw();
    };
    $('#e-amount', el).oninput = note;
    $('#e-kind', el).onchange = (e) => { if (!orig) $('#e-cat', el).value = e.target.value === 'income' ? 'income' : 'other'; };
    bindSplits(); note();
  },
  async save(orig, t, splits, el, close) {
    const amount = +$('#e-amount', el).value; const desc = $('#e-desc', el).value.trim(); const date = $('#e-date', el).value;
    if (!date) return UI.toast('חסר תאריך.', 'error');
    if (!desc) return UI.toast('חסר תיאור.', 'error');
    if (!(amount > 0)) return UI.toast('הסכום חייב להיות גדול מאפס.', 'error');
    const sign = $('#e-kind', el).value === 'income' ? 1 : -1;
    splits = splits.filter((s) => +s.amount > 0);
    if (splits.length === 1) splits = [];
    if (splits.length && Math.abs(U.sum(splits, (s) => +s.amount) - amount) > 0.005) return UI.toast('סכום החלקים בפיצול אינו שווה לסכום העסקה.', 'error');
    const newCat = $('#e-cat', el).value;
    Object.assign(t, {
      date, description: desc, merchant: Classify.merchantKey(desc), amount: U.round(sign * amount), categoryId: newCat,
      sourceId: $('#e-source', el).value, member: $('#e-member', el).value, notes: $('#e-notes', el).value.trim(),
      tags: $('#e-tags', el).value.split(',').map((x) => x.trim()).filter(Boolean),
      splits: splits.map((s) => ({ categoryId: s.categoryId, amount: U.round(sign * s.amount) })),
    });
    if (!orig) t.hash = U.hash(`manual|${t.id}`);
    if (t.sourceId === 'src-cash' && !S.sources.find((s) => s.id === 'src-cash')) { S.sources.push({ id: 'src-cash', name: 'מזומן', type: 'cash', institution: null }); await Store.save('sources'); }
    await Store.putTx(t);
    close();
    // למידה: שינוי קטגוריה לבית עסק
    if (orig && orig.categoryId !== newCat && !t.ccCharge && !splits.length) {
      const same = S.tx.filter((x) => x.merchant === t.merchant && x.id !== t.id && !(x.splits && x.splits.length));
      const ok = await UI.confirm(`להחיל את הקטגוריה "${Cat.label(newCat)}" על כל העסקאות מ"${t.description}"? ${same.length ? `יש עוד ${same.length} עסקאות קיימות. ` : ''}הכלל יחול גם על עסקאות עתידיות.`, 'החלה על הכול');
      if (ok) {
        S.rules[t.merchant] = newCat; await Store.save('rules');
        same.forEach((x) => { x.categoryId = newCat; });
        if (same.length) await Store.putTx(same);
        UI.toast(`הכלל נשמר ועודכנו ${same.length + 1} עסקאות`);
      }
    } else if (!orig) UI.toast('העסקה נוספה');
    App.render();
  },
};
