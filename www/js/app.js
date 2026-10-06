'use strict';
/* מעטפת האפליקציה: ניווט, ערכת צבעים, נעילת PIN ורכיבי ממשק משותפים */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const Views = {};

const UI = {
  icons() { if (window.lucide) lucide.createIcons(); },
  icon: (name) => `<i data-lucide="${name}"></i>`,
  money: (n, signed = false, cls = '') => `<span class="num ${cls}">${U.money(n, signed)}</span>`,
  // סכום עסקה בצבע: הכנסה או הוצאה
  txAmount(t) { return UI.money(t.amount, true, Cat.isIncome(t.categoryId) || t.amount > 0 ? 'income' : 'expense'); },
  cat(id, withLabel = true) {
    return `<span class="cat"><span class="dot" style="background:${Cat.color(id)}">${UI.icon(Cat.icon(id))}</span>${withLabel ? `<span>${U.esc(Cat.label(id))}</span>` : ''}</span>`;
  },
  catOptions(selected, includeSystem = false) {
    return Cat.options(includeSystem).map((o) => `<option value="${o.id}" ${o.id === selected ? 'selected' : ''}>${U.esc(o.label)}</option>`).join('');
  },
  toast(msg, type = '') {
    const el = document.createElement('div'); el.className = `toast ${type}`; el.textContent = msg;
    $('#toasts').appendChild(el); setTimeout(() => el.remove(), type === 'error' ? 7000 : 3500);
  },
  error(e) { console.error(e); UI.toast(e instanceof ImportError ? e.message : `אירעה שגיאה: ${e.message || e}`, 'error'); },
  // חלון קופץ. actions: [{label, cls, onClick(close, el)}]
  modal({ title, body, actions = [], wide = false }) {
    const back = document.createElement('div'); back.className = 'modal-back';
    back.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><h2>${U.esc(title)}</h2><div class="modal-body">${body}</div><div class="actions"></div></div>`;
    const close = () => back.remove();
    const bar = $('.actions', back);
    actions.forEach((a) => {
      const b = document.createElement('button'); b.className = `btn ${a.cls || ''}`; b.textContent = a.label;
      b.onclick = () => a.onClick(close, back); bar.appendChild(b);
    });
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
    back.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    $('#modal-root').appendChild(back); UI.icons();
    const first = $('input, select, button', $('.modal-body', back)); if (first) first.focus();
    return { el: back, close };
  },
  confirm(text, okLabel = 'אישור', danger = false) {
    return new Promise((res) => UI.modal({
      title: 'אישור פעולה', body: `<p>${U.esc(text)}</p>`,
      actions: [
        { label: okLabel, cls: danger ? 'danger' : 'primary', onClick: (close) => { close(); res(true); } },
        { label: 'ביטול', cls: 'ghost', onClick: (close) => { close(); res(false); } },
      ],
    }));
  },
  download(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
  empty: (icon, text, action = '') => `<div class="card empty">${UI.icon(icon)}<p>${text}</p>${action ? `<div style="margin-top:16px">${action}</div>` : ''}</div>`,
};

// תקופה נבחרת, משותפת ללוח הבקרה ולתקציב
const Period = {
  mode: 'month', ym: U.today().slice(0, 7),
  range() {
    const [y, m] = Period.ym.split('-').map(Number);
    if (Period.mode === 'year') return { from: `${y}-01-01`, to: `${y}-12-31`, label: `שנת ${y}` };
    if (Period.mode === 'quarter') {
      const q = Math.floor((m - 1) / 3); const a = `${y}-${U.pad(q * 3 + 1)}`, b = `${y}-${U.pad(q * 3 + 3)}`;
      return { from: `${a}-01`, to: `${b}-${U.daysInMonth(b)}`, label: `רבעון ${q + 1}, ${y}` };
    }
    return { from: `${Period.ym}-01`, to: `${Period.ym}-${U.daysInMonth(Period.ym)}`, label: U.monthName(Period.ym) };
  },
  step: () => ({ month: 1, quarter: 3, year: 12 }[Period.mode]),
  shift(dir) { Period.ym = U.ymAdd(Period.ym, dir * Period.step()); },
  prevRange() { const keep = Period.ym; Period.shift(-1); const r = Period.range(); Period.ym = keep; return r; },
  html() {
    const months = new Set(Calc.months()); months.add(Period.ym); months.add(U.today().slice(0, 7));
    const opts = [...months].sort().reverse().map((ym) => `<option value="${ym}" ${ym === Period.ym ? 'selected' : ''}>${Period.mode === 'month' ? U.monthName(ym) : ym === Period.ym ? Period.range().label : U.monthName(ym)}</option>`).join('');
    return `<div class="row no-print">
      <div class="period">
        <button class="btn icon" data-period="-1" aria-label="התקופה הקודמת">${UI.icon('chevron-right')}</button>
        <select data-period-select aria-label="בחירת חודש">${opts}</select>
        <button class="btn icon" data-period="1" aria-label="התקופה הבאה">${UI.icon('chevron-left')}</button>
      </div>
      <div class="seg" role="group" aria-label="סוג תקופה">
        ${[['month', 'חודש'], ['quarter', 'רבעון'], ['year', 'שנה']].map(([k, l]) => `<button data-period-mode="${k}" aria-pressed="${Period.mode === k}">${l}</button>`).join('')}
      </div>
    </div>`;
  },
  bind(root) {
    $$('[data-period]', root).forEach((b) => (b.onclick = () => { Period.shift(+b.dataset.period); App.render(); }));
    $$('[data-period-mode]', root).forEach((b) => (b.onclick = () => { Period.mode = b.dataset.periodMode; App.render(); }));
    const sel = $('[data-period-select]', root); if (sel) sel.onchange = () => { Period.ym = sel.value; App.render(); };
  },
};

const App = {
  route: 'dashboard', params: null,
  NAV: [
    ['dashboard', 'לוח בקרה', 'layout-dashboard'], ['transactions', 'עסקאות', 'list'], ['import', 'ייבוא', 'upload'],
    ['budget', 'תקציב ויעדים', 'target'], ['settings', 'הגדרות', 'settings'],
  ],
  async start() {
    if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    try { await Store.load(); }
    catch (e) { document.body.innerHTML = `<div class="lock"><div class="card"><h2>לא ניתן לטעון את הנתונים</h2><p class="muted">${U.esc(e.message)}</p></div></div>`; return; }
    App.applyTheme();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', App.applyTheme);
    if (S.settings.pinHash) App.lock(); else App.unlock();
  },
  applyTheme() {
    const t = S.settings.theme === 'auto' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : S.settings.theme;
    document.documentElement.dataset.theme = t;
  },
  async toggleTheme() {
    S.settings.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    await Store.save('settings'); App.applyTheme(); App.render();
  },
  pinHash: (pin) => U.sha(`family-budget:${pin}`),
  lock() {
    $('#app').hidden = true; const el = $('#lock'); el.hidden = false;
    el.innerHTML = `<form class="card"><h2>תקציב משפחתי</h2><p class="muted">הקלידו את קוד ה-PIN</p>
      <input type="password" inputmode="numeric" autocomplete="off" maxlength="8" aria-label="קוד PIN" autofocus>
      <p class="over label" hidden>הקוד שגוי. נסו שוב.</p><button class="btn primary" style="width:100%">כניסה</button></form>`;
    $('form', el).onsubmit = async (e) => {
      e.preventDefault(); const inp = $('input', el);
      if (await App.pinHash(inp.value) === S.settings.pinHash) App.unlock();
      else { $('p.over', el).hidden = false; inp.value = ''; inp.focus(); }
    };
  },
  unlock() {
    $('#lock').hidden = true; $('#app').hidden = false;
    Period.ym = Calc.latestMonth();
    App.go(S.tx.length ? 'dashboard' : 'import');
    Notif.pull();
  },
  // כפתור החזרה באנדרואיד: סגירת חלון קופץ, ביטול ייבוא, חזרה ללוח הבקרה, ואז יציאה
  onBack() {
    const m = $('.modal-back'); if (m) { m.remove(); return true; }
    if (App.route === 'import' && Imp.cur) { Imp.cancel(); return true; }
    if (App.route !== 'dashboard') { App.go('dashboard'); return true; }
    return false;
  },
  go(route, params = null) { App.route = route; App.params = params; App.render(); window.scrollTo(0, 0); },
  render() {
    const dark = document.documentElement.dataset.theme === 'dark';
    $('#nav').innerHTML = `<div class="brand">תקציב משפחתי</div>
      ${App.NAV.map(([id, label, icon]) => `<button data-route="${id}" ${App.route === id ? 'aria-current="page"' : ''}>${UI.icon(icon)}<span>${label}</span></button>`).join('')}
      <div class="spacer"></div>
      <button class="desk" data-theme-toggle>${UI.icon(dark ? 'sun' : 'moon')}<span>${dark ? 'מצב בהיר' : 'מצב כהה'}</span></button>`;
    $$('#nav [data-route]').forEach((b) => (b.onclick = () => App.go(b.dataset.route)));
    $('#nav [data-theme-toggle]').onclick = App.toggleTheme;
    const main = $('#main');
    try {
      const view = Views[App.route];
      if (view) view(main, App.params); else main.innerHTML = `<div class="page-head"><h1>בקרוב</h1></div>`;
    } catch (e) { UI.error(e); }
    UI.icons();
  },
};
