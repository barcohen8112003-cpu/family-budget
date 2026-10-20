'use strict';
/* המרת מטבע: שקל ↔ דולר (ואירו) לפי השער היציג של בנק ישראל, דרך שרת האפליקציה */

const FX = {
  API: 'https://family-budget.naorkurtz1.workers.dev/api',
  CODES: { '₪': 'ILS', $: 'USD', '€': 'EUR' },
  NAMES: { '₪': 'שקל', $: 'דולר', '€': 'אירו' },
  data: null, // { rates: {USD, EUR}, updated, source, fetchedAt }
  loading: null,

  // שער אחרון ידוע (גם בלי רשת), ומשיכה של שער חדש כשעבר זמן
  async get(force = false) {
    if (!FX.data && Registry.fx) FX.data = Registry.fx;
    const fresh = FX.data && Date.now() - FX.data.fetchedAt < 30 * 60 * 1000;
    if (fresh && !force) return FX.data;
    if (!FX.loading) {
      FX.loading = (async () => {
        try {
          const r = await fetch(`${FX.API}/rate`, { cache: 'no-store' });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const d = await r.json();
          FX.data = { ...d, fetchedAt: Date.now() };
          Registry.fx = FX.data; await Registry.save();
        } catch (e) {
          if (!FX.data) throw new Error('אין חיבור לשרת השערים, ועדיין לא נשמר שער קודם.');
        } finally { FX.loading = null; }
        return FX.data;
      })();
    }
    return FX.loading;
  },
  // כמה שקלים ביחידה אחת של המטבע
  ils(sym) { return sym === '₪' ? 1 : FX.data && FX.data.rates[FX.CODES[sym]]; },
  convert(amount, from, to) {
    const a = FX.ils(from), b = FX.ils(to);
    return a && b ? U.round((amount * a) / b) : NaN;
  },
  // "1 $ = 3.106 ₪ · בנק ישראל (שער יציג) · 20/10/2026"
  label(sym = '$') {
    if (!FX.data) return '';
    const r = FX.ils(sym); const d = FX.data.updated ? U.il(U.iso(new Date(FX.data.updated))) : '';
    const old = Date.now() - FX.data.fetchedAt > 24 * 3600 * 1000 ? ' · שער שמור, ייתכן שאינו עדכני' : '';
    return `1 ${sym} = ${r ? r.toFixed(3) : '?'} ₪ · ${FX.data.source} · ${d}${old}`;
  },
  // שימוש בשער מחוץ לאפליקציית האנדרואיד הישנה: שם הרשת חסומה לשרת
  blockedHint() {
    return Platform.android() && !(window.AndroidBridge.apiVersion && window.AndroidBridge.apiVersion() >= 2)
      ? 'כדי למשוך שער צריך להתקין את גרסת ה-APK החדשה.' : '';
  },

  // חלון המרה: שני שדות שמתעדכנים זה מזה
  dialog() {
    const other = U.cur === '₪' ? '$' : U.cur;
    const m = UI.modal({
      title: 'המרת מטבע',
      body: `<div class="stack">
        <div class="row" style="flex-wrap:nowrap">
          <label class="field" style="flex:1"><span>${FX.NAMES[other]} (${other})</span><input type="number" inputmode="decimal" step="any" id="fx-a" style="font-size:22px"></label>
          <select id="fx-cur" aria-label="מטבע" style="margin-top:24px">${['$', '€'].map((s) => `<option value="${s}" ${s === other ? 'selected' : ''}>${s}</option>`).join('')}</select>
        </div>
        <label class="field"><span>שקל (₪)</span><input type="number" inputmode="decimal" step="any" id="fx-b" style="font-size:22px"></label>
        <p class="caption" id="fx-info">טוען שער…</p></div>`,
      actions: [
        { label: 'רענון השער', cls: '', onClick: () => load(true) },
        { label: 'סגירה', cls: 'ghost', onClick: (close) => close() },
      ],
    });
    const el = m.el; const a = $('#fx-a', el), b = $('#fx-b', el), cur = $('#fx-cur', el), info = $('#fx-info', el);
    let last = 'a';
    const calc = () => {
      const sym = cur.value; $('span', a.closest('label')).textContent = `${FX.NAMES[sym]} (${sym})`;
      if (last === 'a') b.value = a.value === '' ? '' : FX.convert(+a.value, sym, '₪');
      else a.value = b.value === '' ? '' : FX.convert(+b.value, '₪', sym);
    };
    const load = async (force) => {
      info.textContent = 'טוען שער…';
      try { await FX.get(force); info.textContent = FX.label(cur.value); calc(); }
      catch (e) { info.textContent = FX.blockedHint() || e.message; }
    };
    a.oninput = () => { last = 'a'; calc(); };
    b.oninput = () => { last = 'b'; calc(); };
    cur.onchange = () => { info.textContent = FX.label(cur.value); calc(); };
    load(false); a.focus();
  },
};
